import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';

declare const Deno: {
    env: {
        get(key: string): string | undefined;
    };
    serve(handler: (request: Request) => Response | Promise<Response>): void;
};

interface TakeoverRequest {
    tenant_id?: string;
    terminal_id?: string;
    registry_id?: string | null;
    device_id?: string;
    device_name?: string | null;
    reason?: string;
    confirm_takeover?: boolean;
    helpdesk_ticket_id?: string | null;
}

interface TenantRecord {
    id: string;
    name: string;
    email: string;
    status: string;
    type?: string | null;
    cloud_sync?: boolean | null;
    contracted_product?: string | null;
    pos_variant?: string | null;
    offline_mode?: boolean | null;
    explicit_offline?: boolean | null;
    cloud_channel?: string | null;
    pos_runtime?: string | null;
}

interface RegistryRecord {
    id: string;
    tenant_id: string;
    device_id?: string | null;
    terminal_id?: string | null;
    terminal_name?: string | null;
}

interface PublicTerminalRecord {
    id: string;
    tenant_id: string;
    code?: string | null;
    is_active?: boolean | null;
}

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-actor-user-id, x-actor-email, x-actor-source',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const tokenKeys = new Set([
    'syncAuthToken',
    'sync_auth_token',
    'token',
    'auth_token',
    'access_token',
    'refresh_token',
]);

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
        },
    });
}

function getEnv(...names: string[]) {
    for (const name of names) {
        const value = Deno.env.get(name);
        if (value) return value;
    }
    throw new Error(`Missing required environment variable: ${names.join(' or ')}`);
}

function sanitizePayload(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => sanitizePayload(item));
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (tokenKeys.has(key)) continue;
        output[key] = sanitizePayload(item);
    }
    return output;
}

function getErrorCode(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const record = payload as Record<string, unknown>;
    const candidates = [record.code, record.error, record.error_code];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    return null;
}

function getErrorMessage(status: number, payload: unknown) {
    const code = getErrorCode(payload);
    if (status === 403 && code === 'DEVICE_SUPERSEDED') {
        return 'Este dispositivo anterior ya fue reemplazado.';
    }
    if (payload && typeof payload === 'object') {
        const record = payload as Record<string, unknown>;
        if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
        if (typeof record.error === 'string' && record.error.trim() && record.error.trim() !== code) {
            return record.error.trim();
        }
    }
    if (status === 401 || status === 403) {
        return `ERP rechazo la recuperacion de terminal (HTTP ${status}) sin detalle. Verifica el tenant ERP, el token de servicio ERP y que la terminal este activa.`;
    }
    return 'El ERP no pudo completar la recuperacion de terminal.';
}

function isLocalPosTenant(tenant: TenantRecord) {
    if (tenant.contracted_product) {
        return tenant.contracted_product === 'POS_ONLY' && (tenant.pos_runtime || 'LOCAL_SQLITE') !== 'SLAVE';
    }
    return tenant.type === 'pos_only';
}

function isExplicitOfflinePosTenant(tenant: TenantRecord) {
    return tenant.contracted_product === 'POS_ONLY'
        && (
            tenant.pos_variant === 'POS_ONLY_OFFLINE'
            || tenant.offline_mode === true
            || tenant.explicit_offline === true
            || tenant.cloud_channel === 'NONE'
        );
}

async function insertAudit(
    supabase: ReturnType<typeof createClient>,
    payload: {
        event: 'TERMINAL_TAKEOVER_REQUESTED' | 'TERMINAL_TAKEOVER_COMPLETED';
        tenant_id: string;
        terminal_id: string;
        previous_device_id?: string | null;
        new_device_id?: string | null;
        actor_user_id?: string | null;
        actor_email?: string | null;
        reason?: string | null;
        erp_response_status?: number | null;
        erp_error_code?: string | null;
        metadata?: Record<string, unknown>;
    },
) {
    const { error } = await supabase.from('terminal_takeover_audit').insert({
        event: payload.event,
        tenant_id: payload.tenant_id,
        terminal_id: payload.terminal_id,
        previous_device_id: payload.previous_device_id || null,
        new_device_id: payload.new_device_id || null,
        actor_user_id: payload.actor_user_id || null,
        actor_email: payload.actor_email || null,
        reason: payload.reason || null,
        erp_response_status: payload.erp_response_status || null,
        erp_error_code: payload.erp_error_code || null,
        metadata: payload.metadata || {},
    });

    if (error) {
        console.error('Failed to write terminal takeover audit', error);
    }
}

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
        return json({ error: 'METHOD_NOT_ALLOWED', message: 'Metodo no permitido.' }, 405);
    }

    try {
        const supabaseUrl = getEnv('SUPABASE_URL');
        const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
        const erpApiUrl = getEnv('ERP_API_URL', 'CLOUD_ADMIN_ERP_API_URL');
        const erpServiceToken = getEnv('ERP_TAKEOVER_SERVICE_TOKEN', 'ERP_SERVICE_TOKEN', 'CLOUD_ADMIN_ERP_SERVICE_TOKEN');
        const supabase = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
            db: { schema: 'landlord' },
        });

        const body = await request.json().catch(() => ({})) as TakeoverRequest;
        const tenantId = body.tenant_id?.trim();
        const terminalId = body.terminal_id?.trim();
        const registryId = body.registry_id?.trim() || null;
        const newDeviceId = body.device_id?.trim();
        const deviceName = body.device_name?.trim() || null;
        const reason = body.reason?.trim();
        const actorUserId = request.headers.get('x-actor-user-id') || null;
        const actorEmail = request.headers.get('x-actor-email') || request.headers.get('x-actor-source') || 'cloud-admin';

        if (!tenantId || !terminalId || !newDeviceId || !reason) {
            return json({
                error: 'VALIDATION_ERROR',
                message: 'Selecciona tenant, terminal, nuevo device_id y motivo del cambio.',
            }, 400);
        }

        if (!body.confirm_takeover) {
            return json({
                error: 'CONFIRMATION_REQUIRED',
                message: 'Confirma explicitamente que la tablet anterior quedara revocada.',
            }, 400);
        }

        const { data: tenantData, error: tenantError } = await supabase
            .from('tenants')
            .select('id,name,email,status,type,cloud_sync,contracted_product,pos_variant,offline_mode,explicit_offline,cloud_channel,pos_runtime')
            .eq('id', tenantId)
            .maybeSingle();

        if (tenantError) throw tenantError;
        const tenant = tenantData as TenantRecord | null;
        if (!tenant) {
            return json({ error: 'TENANT_NOT_FOUND', message: 'Tenant no encontrado.' }, 404);
        }
        if (tenant.status !== 'ACTIVE') {
            return json({ error: 'TENANT_NOT_ACTIVE', message: 'No se permite recuperacion si el tenant no esta activo.' }, 400);
        }
        if (!isLocalPosTenant(tenant)) {
            return json({
                error: 'POS_LOCAL_ONLY',
                message: 'La recuperacion de terminal solo aplica a POS configurado como local. POS + ERP mantiene el flujo actual.',
            }, 400);
        }
        if (isExplicitOfflinePosTenant(tenant)) {
            return json({
                error: 'POS_OFFLINE_NO_CLOUD_RECOVERY',
                message: 'Este tenant POS_ONLY está en modo offline/sin Cloud Staging. No tiene recuperación cloud desde ALFA-Admin.',
            }, 400);
        }

        let registry: RegistryRecord | null = null;
        if (registryId) {
            const { data, error } = await supabase
                .from('tenant_server_registry')
                .select('id,tenant_id,device_id,terminal_id,terminal_name')
                .eq('tenant_id', tenantId)
                .eq('id', registryId)
                .maybeSingle();
            if (error) throw error;
            registry = (data as RegistryRecord | null) || null;
        }

        if (!registry) {
            const { data, error } = await supabase
                .from('tenant_server_registry')
                .select('id,tenant_id,device_id,terminal_id,terminal_name')
                .eq('tenant_id', tenantId)
                .eq('terminal_id', terminalId)
                .maybeSingle();
            if (error) throw error;
            registry = (data as RegistryRecord | null) || null;
        }

        const { data: publicTerminalData, error: terminalError } = await supabase
            .schema('public')
            .from('terminals')
            .select('id,tenant_id,code,is_active')
            .eq('tenant_id', tenantId)
            .eq('id', terminalId)
            .maybeSingle();

        if (terminalError) throw terminalError;
        const publicTerminal = publicTerminalData as PublicTerminalRecord | null;

        if (!registry && !publicTerminal) {
            return json({ error: 'TERMINAL_NOT_FOUND', message: 'Terminal no encontrada para este tenant.' }, 404);
        }

        const previousDeviceId = registry?.device_id || null;
        if (previousDeviceId && previousDeviceId === newDeviceId) {
            return json({
                error: 'SAME_DEVICE_ID',
                message: 'El nuevo device_id no puede ser igual al dispositivo anterior.',
            }, 400);
        }

        await insertAudit(supabase, {
            event: 'TERMINAL_TAKEOVER_REQUESTED',
            tenant_id: tenantId,
            terminal_id: terminalId,
            previous_device_id: previousDeviceId,
            new_device_id: newDeviceId,
            actor_user_id: actorUserId,
            actor_email: actorEmail,
            reason,
            metadata: {
                registry_id: registry?.id || null,
                source: 'cloud-admin',
                device_name: deviceName,
            },
        });

        const erpResponse = await fetch(`${erpApiUrl.replace(/\/$/, '')}/api/settings/terminals/${encodeURIComponent(terminalId)}/takeover`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${erpServiceToken}`,
                'Content-Type': 'application/json',
                'X-Tenant-Id': tenantId,
            },
            body: JSON.stringify({
                device_id: newDeviceId,
                device_name: deviceName || undefined,
            }),
        });

        const erpPayload = await erpResponse.json().catch(async () => ({
            message: await erpResponse.text().catch(() => ''),
        }));
        const erpErrorCode = getErrorCode(erpPayload);

        if (!erpResponse.ok) {
            await insertAudit(supabase, {
                event: 'TERMINAL_TAKEOVER_COMPLETED',
                tenant_id: tenantId,
                terminal_id: terminalId,
                previous_device_id: previousDeviceId,
                new_device_id: newDeviceId,
                actor_user_id: actorUserId,
                actor_email: actorEmail,
                reason,
                erp_response_status: erpResponse.status,
                erp_error_code: erpErrorCode,
                metadata: {
                    success: false,
                    erp_payload: sanitizePayload(erpPayload),
                },
            });

            return json({
                error: erpErrorCode || 'ERP_TAKEOVER_FAILED',
                message: getErrorMessage(erpResponse.status, erpPayload),
            }, erpResponse.status);
        }

        let registryUpdateError: string | null = null;
        if (registry?.id) {
            const { error: updateError } = await supabase
                .from('tenant_server_registry')
                .update({
                    device_id: newDeviceId,
                    terminal_name: deviceName || registry.terminal_name,
                    last_takeover_at: new Date().toISOString(),
                    previous_device_id: previousDeviceId,
                    current_device_id: newDeviceId,
                    authorized_device_id: newDeviceId,
                    auth_status: 'AUTHORIZED',
                    revocation_reason: 'TERMINAL_TAKEOVER',
                    requires_pos_reauth: false,
                    is_revoked: false,
                    last_auth_error: null,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', registry.id);

            if (updateError) {
                registryUpdateError = updateError.message;
                console.error('Failed to update tenant server registry after takeover', updateError);
            }
        }

        if (body.helpdesk_ticket_id) {
            const { error: messageError } = await supabase.from('ticket_messages').insert({
                ticket_id: body.helpdesk_ticket_id,
                sender_type: 'System',
                message: `Se ejecuto recuperacion de terminal. Dispositivo anterior: ${previousDeviceId || 'N/D'}. Nuevo dispositivo: ${newDeviceId}.`,
                attachments: {
                    technical_action: {
                        action: 'terminal_takeover',
                        previous_device_id: previousDeviceId,
                        new_device_id: newDeviceId,
                        reason,
                    },
                    notification: {
                        badge: true,
                        increment_unread: true,
                        play_sound: false,
                    },
                },
            });
            if (messageError) console.error('Failed to append helpdesk takeover message', messageError);
        }

        await insertAudit(supabase, {
            event: 'TERMINAL_TAKEOVER_COMPLETED',
            tenant_id: tenantId,
            terminal_id: terminalId,
            previous_device_id: previousDeviceId,
            new_device_id: newDeviceId,
            actor_user_id: actorUserId,
            actor_email: actorEmail,
            reason,
            erp_response_status: erpResponse.status,
            metadata: {
                success: true,
                registry_update_error: registryUpdateError,
                erp_payload: sanitizePayload(erpPayload),
            },
        });

        const sanitizedPayload = sanitizePayload(erpPayload) as Record<string, unknown>;
        return json({
            status: 'success',
            terminal: sanitizedPayload.terminal || null,
            previous_device_id: (sanitizedPayload.previous_device_id as string | undefined) || previousDeviceId,
            new_device_id: (sanitizedPayload.new_device_id as string | undefined) || newDeviceId,
            requires_auth: sanitizedPayload.requires_auth ?? true,
            message: 'Terminal reasignada correctamente. La tablet anterior fue revocada. Inicia sesion/autentica la nueva tablet para continuar.',
        });
    } catch (error) {
        console.error('request-terminal-takeover failed', error);
        return json({
            error: 'INTERNAL_ERROR',
            message: error instanceof Error ? error.message : 'Error interno ejecutando recuperacion de terminal.',
        }, 500);
    }
});
