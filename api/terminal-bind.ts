import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * POST /api/terminal-bind
 *
 * Vinculación de terminal en un solo paso ("Vincular esta terminal").
 *
 * Reemplaza el flujo manual del panel (elegir terminal ERP + sucursal, validar
 * dry-run, ejecutar) que quedaba bloqueado cuando el registro de la caja estaba
 * huérfano: sin UUID de catálogo cloud, sin UUID ERP y sin sucursal.
 *
 * Este endpoint:
 *   1. resuelve el destino ERP en el servidor (registro → catálogo → ERP),
 *   2. ejecuta el dry-run del RPC canónico,
 *   3. si el plan es válido y llega `confirm: true`, ejecuta la reconciliación
 *      autorizando el device que reporta el POS.
 *
 * Es idempotente: si la terminal ya está vinculada y el device coincide, el
 * dry-run no produce escrituras y se responde `already_bound`.
 */

type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  on?: (event: string, callback: () => void) => void;
};

type ApiResponse = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

type AdminRow = {
  id: string;
  auth_user_id: string | null;
  email: string;
  status: string;
  cloud_admin_profiles?: { is_active?: boolean; permissions?: Record<string, unknown> } | { is_active?: boolean; permissions?: Record<string, unknown> }[] | null;
};

type BindPayload = {
  tenant_id?: unknown;
  source_registry_id?: unknown;
  device_id?: unknown;
  erp_terminal_id?: unknown;
  erp_store_id?: unknown;
  confirm?: unknown;
  reason?: unknown;
};

/** El cliente de servicio se usa con dos esquemas (landlord y public). */
type AdminClient = SupabaseClient<any, any, any>;

type ResolvedTarget = {
  erp_terminal_uuid: string;
  erp_store_id: string;
  erp_tenant_id: string | null;
  terminal_name: string | null;
  store_name: string | null;
  source: string;
};

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function setCors(response: ApiResponse) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJson(response: ApiResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function requiredEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value;
  }
  throw new Error(`Falta variable de entorno: ${names.join(' o ')}`);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function relation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function headerValue(headers: ApiRequest['headers'], name: string): string {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(raw) ? raw[0] || '' : raw || '';
}

async function readBody(request: ApiRequest): Promise<unknown> {
  if (request.body !== undefined && request.body !== null) {
    if (typeof request.body === 'string') {
      try {
        return JSON.parse(request.body);
      } catch {
        return {};
      }
    }
    return request.body;
  }
  return {};
}

function errorStatus(message: string): number {
  const lowered = message.toLowerCase();
  if (lowered.includes('permission') || lowered.includes('forbidden')) return 403;
  if (lowered.includes('not found') || lowered.includes('does not exist')) return 404;
  if (lowered.includes('required') || lowered.includes('invalid') || lowered.includes('missing')) return 400;
  return 409;
}

/** Candidatos de device dentro de una fila de registro (las columnas varían por versión). */
function deviceCandidates(row: Record<string, unknown>): string[] {
  const keys = [
    'device_id',
    'current_device_id',
    'authorized_device_id',
    'reported_device_id',
    'last_rejected_device_id',
    'previous_device_id',
  ];
  const found: string[] = [];
  for (const key of keys) {
    const value = text(row[key]);
    if (value && !found.includes(value)) found.push(value);
  }
  return found;
}

// ---------------------------------------------------------------- resolución

async function resolveErpTenantId(admin: AdminClient, tenantId: string): Promise<string | null> {
  const { data, error } = await admin
    .schema('public')
    .from('erp_tenants')
    .select('id')
    .eq('config->>cloudAdminTenantId', tenantId)
    .maybeSingle();
  if (!error) {
    const id = text((data as { id?: string } | null)?.id);
    if (id) return id;
  }

  // Fallback: el tenant cloud puede estar referenciado desde otra columna.
  const { data: fallback } = await admin
    .schema('landlord')
    .from('tenants')
    .select('*')
    .eq('id', tenantId)
    .maybeSingle();
  const row = (fallback as Record<string, unknown> | null) || null;
  if (!row) return null;
  for (const key of ['erp_tenant_id', 'erp_id', 'linked_erp_tenant_id']) {
    const value = text(row[key]);
    if (value && UUID_LIKE.test(value)) return value;
  }
  return null;
}

async function listErpTargets(admin: AdminClient, tenantId: string): Promise<ResolvedTarget[]> {
  const erpTenantId = await resolveErpTenantId(admin, tenantId);
  if (!erpTenantId) return [];

  const { data: stores } = await admin
    .schema('public')
    .from('erp_stores')
    .select('id,name')
    .eq('tenant_id', erpTenantId);
  const storeRows = (stores as Array<{ id?: string; name?: string | null }> | null) || [];
  const storeIds = storeRows.map((store) => text(store.id)).filter((id): id is string => Boolean(id));
  if (!storeIds.length) return [];
  const storeNames = new Map(storeRows.map((store) => [text(store.id) || '', text(store.name) || null]));

  const { data: terminals } = await admin
    .schema('public')
    .from('erp_terminals')
    .select('id,store_id,name,config')
    .in('store_id', storeIds);
  const terminalRows = (terminals as Array<Record<string, unknown>> | null) || [];

  const targets: ResolvedTarget[] = [];
  for (const row of terminalRows) {
    const uuid = text(row.id);
    const storeId = text(row.store_id);
    if (!uuid || !storeId || !UUID_LIKE.test(uuid)) continue;
    targets.push({
      erp_terminal_uuid: uuid,
      erp_store_id: storeId,
      erp_tenant_id: erpTenantId,
      terminal_name: text(row.name),
      store_name: storeNames.get(storeId) || null,
      source: 'erp_terminals',
    });
  }
  return targets;
}

async function resolveFromCatalog(
  admin: AdminClient,
  catalogTerminalId: string | null,
): Promise<ResolvedTarget | null> {
  if (!catalogTerminalId) return null;
  const { data } = await admin
    .schema('public')
    .from('terminals')
    .select('*')
    .eq('id', catalogTerminalId)
    .maybeSingle();
  const row = (data as Record<string, unknown> | null) || null;
  if (!row) return null;

  const config = (row.config as Record<string, unknown> | null) || {};
  const metadata = (row.metadata as Record<string, unknown> | null) || {};
  const candidates = [
    metadata.erp_terminal_id,
    metadata.canonical_erp_terminal_id,
    config.erp_terminal_id,
    config.erp_terminal_uuid,
    row.erp_terminal_id,
  ];
  const uuid = candidates.map(text).find((value) => value && UUID_LIKE.test(value)) || null;
  if (!uuid) return null;

  const storeCandidates = [
    metadata.erp_store_id,
    config.erp_store_id,
    config.store_id,
    row.erp_store_id,
  ];
  let storeId = storeCandidates.map(text).find((value) => value && UUID_LIKE.test(value)) || null;
  let terminalName = text(row.name);
  let storeName: string | null = null;

  // Si el catálogo no guarda la sucursal, se deriva desde el propio ERP: la
  // terminal ERP conoce su store_id. Así el panel no depende de que el vínculo
  // `erp_tenants.config.cloudAdminTenantId` esté bien poblado.
  const { data: erpTerminal } = await admin
    .schema('public')
    .from('erp_terminals')
    .select('id,store_id,name')
    .eq('id', uuid)
    .maybeSingle();
  const erpRow = (erpTerminal as Record<string, unknown> | null) || null;
  if (erpRow) {
    storeId = storeId || text(erpRow.store_id);
    terminalName = terminalName || text(erpRow.name);
    const erpStoreId = text(erpRow.store_id);
    if (erpStoreId) {
      const { data: storeRow } = await admin
        .schema('public')
        .from('erp_stores')
        .select('name')
        .eq('id', erpStoreId)
        .maybeSingle();
      storeName = text((storeRow as { name?: string } | null)?.name);
    }
  }

  if (!storeId) return null;

  return {
    erp_terminal_uuid: uuid,
    erp_store_id: storeId,
    erp_tenant_id: null,
    terminal_name: terminalName,
    store_name: storeName,
    source: 'catalog_metadata',
  };
}

// ------------------------------------------------------------------ endpoint

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method === 'OPTIONS') {
    setCors(response);
    response.statusCode = 204;
    response.end();
    return;
  }
  setCors(response);
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Método no permitido.' });
    return;
  }

  try {
    const accessToken = headerValue(request.headers, 'authorization').replace(/^Bearer\s+/i, '').trim();
    if (!accessToken) {
      sendJson(response, 401, { error: 'UNAUTHORIZED', message: 'Sesión administrativa requerida.' });
      return;
    }

    const supabaseUrl = requiredEnv('SUPABASE_URL', 'VITE_SUPABASE_URL').replace(/\/$/, '');
    const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      db: { schema: 'landlord' },
    });

    const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
    if (authError || !authData.user?.id) {
      sendJson(response, 401, { error: 'UNAUTHORIZED', message: 'Sesión administrativa inválida.' });
      return;
    }

    const { data: adminData, error: adminLookupError } = await admin
      .from('cloud_admin_users')
      .select('id,auth_user_id,email,status,cloud_admin_profiles(is_active,permissions)')
      .eq('auth_user_id', authData.user.id)
      .maybeSingle();
    if (adminLookupError) throw adminLookupError;

    const actor = adminData as AdminRow | null;
    const profile = relation(actor?.cloud_admin_profiles);
    const permissions = profile?.permissions || {};
    if (!actor || actor.status !== 'active' || profile?.is_active !== true) {
      sendJson(response, 403, { error: 'FORBIDDEN', message: 'Perfil administrativo inactivo.' });
      return;
    }
    // `terminal_reconciliation` no existe en el catálogo de permisos de la UI
    // (solo `terminal_reauthorization` es otorgable), así que se acepta
    // cualquiera de los dos: vincular es, en la práctica, autorizar un device.
    const canBind = permissions.terminal_reauthorization === true
      || permissions.terminal_reconciliation === true;
    if (!canBind) {
      sendJson(response, 403, {
        error: 'FORBIDDEN',
        message: 'No tienes permiso para vincular terminales. Pide el permiso “Reautorizar dispositivos” (Terminales) a un administrador.',
      });
      return;
    }

    const body = (await readBody(request)) as BindPayload;
    const tenantId = text(body.tenant_id);
    const sourceRegistryId = text(body.source_registry_id);
    if (!tenantId || !sourceRegistryId) {
      sendJson(response, 400, {
        error: 'VALIDATION_ERROR',
        message: 'tenant_id y source_registry_id son requeridos.',
      });
      return;
    }

    // El registro de sincronización vive en `landlord`, no en `public`.
    const { data: registryData, error: registryError } = await admin
      .from('tenant_server_registry')
      .select('*')
      .eq('id', sourceRegistryId)
      .maybeSingle();
    if (registryError) throw registryError;
    const registry = (registryData as Record<string, unknown> | null) || null;
    if (!registry) {
      sendJson(response, 404, {
        error: 'REGISTRY_NOT_FOUND',
        message: 'No existe el registro de terminal indicado.',
      });
      return;
    }
    if (text(registry.tenant_id) && text(registry.tenant_id) !== tenantId) {
      sendJson(response, 403, {
        error: 'TENANT_MISMATCH',
        message: 'El registro de terminal no pertenece al tenant indicado.',
      });
      return;
    }

    const devices = deviceCandidates(registry);
    const deviceId = text(body.device_id) || devices[0] || null;
    if (!deviceId) {
      sendJson(response, 400, {
        error: 'DEVICE_ID_REQUIRED',
        message: 'El registro no reporta device; abre la caja y pulsa Reintentar conexión antes de vincular.',
      });
      return;
    }

    // El RPC canónico solo autoriza un device que el registro considere "actual"
    // (coalesce(current_device_id, device_id)). Tras reinstalar la APK ese campo
    // queda apuntando al equipo anterior y la reconciliación es imposible, así
    // que el desfase se adopta aquí, auditado y antes del RPC.
    const effectiveCurrentDevice = text(registry.current_device_id) || text(registry.device_id);
    const needsDeviceAdoption = !effectiveCurrentDevice
      || effectiveCurrentDevice.toUpperCase() !== deviceId.toUpperCase();

    // 1. Destino ERP: explícito > catálogo > ERP del tenant.
    let target: ResolvedTarget | null = null;
    const explicitTerminal = text(body.erp_terminal_id);
    const explicitStore = text(body.erp_store_id);
    if (explicitTerminal && explicitStore && UUID_LIKE.test(explicitTerminal)) {
      target = {
        erp_terminal_uuid: explicitTerminal,
        erp_store_id: explicitStore,
        erp_tenant_id: null,
        terminal_name: null,
        store_name: null,
        source: 'explicit',
      };
    }

    if (!target) {
      target = await resolveFromCatalog(admin, text(registry.terminal_id));
    }

    if (!target) {
      const erpTargets = await listErpTargets(admin, tenantId);
      if (erpTargets.length === 1) {
        target = erpTargets[0];
      } else if (erpTargets.length > 1) {
        const byDevice = erpTargets.find((candidate) => devices.some((device) => candidate.terminal_name?.includes(device)));
        if (byDevice) {
          target = byDevice;
        } else {
          sendJson(response, 409, {
            error: 'ERP_TARGET_AMBIGUOUS',
            message: 'Hay varias terminales ERP; indica cuál vincular.',
            candidates: erpTargets,
          });
          return;
        }
      }
    }

    if (!target) {
      sendJson(response, 409, {
        error: 'ERP_TARGET_NOT_FOUND',
        message: 'El tenant no expone terminales ERP para vincular. Revisa el vínculo ERP del tenant (erp_tenants → erp_stores → erp_terminals) o indica erp_terminal_id y erp_store_id.',
        diagnostics: {
          tenant_id: tenantId,
          registry_id: sourceRegistryId,
          registry_terminal_id: text(registry.terminal_id),
          devices,
        },
      });
      return;
    }

    const reason = text(body.reason)
      || `Vinculación automática desde el panel: ${sourceRegistryId} → ${target.erp_terminal_uuid} (device ${deviceId}).`;
    // p_correlation_id es uuid en el RPC: un id compuesto revienta con 22P02.
    const correlationId = randomUUID();
    const rpcCommon = {
      p_tenant_id: tenantId,
      p_reason: reason,
      p_actor_admin_user_id: actor.id,
      p_actor_auth_user_id: actor.auth_user_id,
      p_actor_email: actor.email,
      p_correlation_id: correlationId,
    };
    const rpcTarget = {
      p_source_registry_id: sourceRegistryId,
      p_target_erp_terminal_id: target.erp_terminal_uuid,
      p_target_store_id: target.erp_store_id,
      p_authorized_device_id: deviceId,
    };

    // 2. Dry-run obligatorio: el plan debe ser válido antes de escribir nada.
    const dryRun = await admin.rpc('reconcile_terminal_identity', {
      ...rpcCommon,
      ...rpcTarget,
      p_expected_plan_hash: null,
      p_dry_run: true,
    });
    if (dryRun.error) {
      sendJson(response, errorStatus(dryRun.error.message), {
        error: dryRun.error.code || 'DRY_RUN_FAILED',
        message: dryRun.error.message,
        target,
      });
      return;
    }

    // El RPC devuelve el detalle dentro de `plan` (el plan_hash va fuera).
    const dryRunData = (dryRun.data || {}) as Record<string, unknown>;
    const planHash = text(dryRunData.plan_hash);
    const plan = (dryRunData.plan as Record<string, unknown> | null) || {};
    const destructive = Array.isArray(plan.destructive_operations) ? plan.destructive_operations : [];
    const orphanRegistryIds = Array.isArray(plan.orphan_registry_ids) ? plan.orphan_registry_ids : [];
    const previousDevice = text(plan.previous_authorized_device_id);
    const alreadyBound = previousDevice?.toUpperCase() === deviceId.toUpperCase() && orphanRegistryIds.length === 0;

    if (alreadyBound) {
      sendJson(response, 200, {
        status: 'already_bound',
        message: 'La terminal ya estaba vinculada con este device; no se escribió nada.',
        target,
        device_id: deviceId,
        plan_hash: planHash,
        plan,
      });
      return;
    }

    if (body.confirm !== true) {
      sendJson(response, 200, {
        status: 'dry_run',
        message: 'Plan válido. Envía confirm=true para ejecutar la vinculación.',
        target,
        device_id: deviceId,
        plan_hash: planHash,
        destructive_operations: destructive,
        device_mismatch: {
          current_device_id: effectiveCurrentDevice,
          reported_device_id: deviceId,
          will_adopt: needsDeviceAdoption,
        },
        plan,
      });
      return;
    }

    if (destructive.length) {
      sendJson(response, 409, {
        error: 'PLAN_BLOCKED',
        message: 'El plan incluye escrituras destructivas; no se ejecutó.',
        destructive_operations: destructive,
        target,
        plan,
      });
      return;
    }

    // 3. Adoptar el device reportado si el registro quedó desfasado.
    if (needsDeviceAdoption) {
      const { error: adoptError } = await admin
        .from('tenant_server_registry')
        .update({ current_device_id: deviceId })
        .eq('id', sourceRegistryId);
      if (adoptError) {
        sendJson(response, 500, {
          error: 'DEVICE_ADOPTION_FAILED',
          message: `No se pudo actualizar el device actual del registro: ${adoptError.message}`,
          target,
        });
        return;
      }
      const { error: auditError } = await admin.from('terminal_device_audit').insert({
        tenant_id: tenantId,
        terminal_id: target.erp_terminal_uuid,
        terminal_name: target.terminal_name || null,
        old_device_id: effectiveCurrentDevice,
        new_device_id: deviceId,
        action: 'CLOUD_ADMIN_DEVICE_MISMATCH_DETECTED',
        performed_by: actor.email,
        reason,
        result: 'SUCCESS',
        metadata: {
          source_registry_id: sourceRegistryId,
          correlation_id: correlationId,
          adopted_before_reconciliation: true,
        },
      });
      if (auditError) {
        console.error('terminal-bind: no se pudo auditar la adopción del device', auditError);
      }
    }

    // 4. Ejecución real.
    const execute = await admin.rpc('reconcile_terminal_identity', {
      ...rpcCommon,
      ...rpcTarget,
      p_expected_plan_hash: planHash,
      p_dry_run: false,
    });
    if (execute.error) {
      const scopeBlocked = execute.error.message.includes('AUTHORIZED_DEVICE_NOT_IN_RECONCILIATION_SCOPE');
      sendJson(response, errorStatus(execute.error.message), {
        error: execute.error.code || 'BIND_FAILED',
        message: scopeBlocked
          ? 'El registro de la terminal no reconoce este device como actual. Abre la caja, pulsa “Reintentar conexión” y vuelve a vincular.'
          : execute.error.message,
        target,
        plan_hash: planHash,
      });
      return;
    }

    sendJson(response, 200, {
      status: 'bound',
      message: 'Terminal vinculada. El POS puede pulsar “Reintentar conexión”.',
      target,
      device_id: deviceId,
      plan_hash: planHash,
      result: execute.data || { status: 'success' },
    });
  } catch (error) {
    console.error('terminal-bind failed', error);
    sendJson(response, 500, {
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Error interno al vincular la terminal.',
    });
  }
}
