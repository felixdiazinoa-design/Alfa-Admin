import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { CloudAdminAuthError, requireCloudAdminPermission, type AnySupabaseClient } from "./lib/cloud-admin-session.js";

type ApiRequest = IncomingMessage & {
    body?: unknown;
    headers: IncomingHttpHeaders;
    method?: string;
};

type DeviceActionPayload = {
    tenant_id?: unknown;
    terminal_id?: unknown;
    catalog_terminal_id?: unknown;
    store_id?: unknown;
    registry_id?: unknown;
    terminal_name?: unknown;
    device_name?: unknown;
    device_id?: unknown;
    request_id?: unknown;
    expected_authorized_device_id?: unknown;
    action?: unknown;
    reason?: unknown;
    confirm_action?: unknown;
    idempotency_key?: unknown;
    requested_by?: unknown;
};

type RegistryRecord = {
    id: string;
    terminal_id?: string | null;
    terminal_name?: string | null;
    device_id?: string | null;
    current_device_id?: string | null;
    authorized_device_id?: string | null;
    previous_device_id?: string | null;
    last_rejected_device_id?: string | null;
};

type PublicTerminalRecord = {
    id: string;
    code?: string | null;
};

type TenantRecord = {
    id: string;
    name?: string | null;
    slug?: string | null;
};

type ErpTerminalRecord = {
    id: string;
    name?: string | null;
    store_id?: string | null;
    device_id?: string | null;
    authorized_device_id?: string | null;
    config?: Record<string, unknown> | null;
};

function setCors(response: ServerResponse) {
    response.setHeader("Access-Control-Allow-Origin", process.env.CLOUD_ADMIN_TAKEOVER_CORS_ORIGIN || "*");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Actor-User-Id, X-Actor-Email, X-Actor-Source, Idempotency-Key, X-Idempotency-Key",
    );
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
    setCors(response);
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(body));
}

function getEnv(...names: string[]) {
    for (const name of names) {
        const value = process.env[name];
        if (value) return value;
    }

    throw new Error(`Missing required environment variable: ${names.join(" or ")}`);
}

function getHeader(headers: IncomingHttpHeaders, name: string) {
    const value = headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
}

function stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiresDeviceId(action: unknown) {
    return action === "TAKEOVER"
        || action === "ROTATE_TOKEN"
        || action === "SYNC_AUTHORIZED_DEVICE"
        || action === "GENERATE_PAIRING_CODE";
}

const legacyDeviceAuthorizationPermissionMessage = "No tienes permiso para ejecutar esta accion de autorizacion.";

function isLegacyDeviceAuthorizationPermissionPayload(payload: unknown) {
    const record = asRecord(payload);
    return stringValue(record.message) === legacyDeviceAuthorizationPermissionMessage;
}

function isTenantDeviceUniqueConflict(payload: unknown) {
    if (typeof payload === "string") {
        return payload.includes("23505")
            || payload.includes("idx_tenant_server_registry_tenant_device")
            || payload.includes("tenant_server_registry_tenant_device");
    }

    const record = asRecord(payload);
    const haystack = [
        record.code,
        record.error,
        record.message,
        record.details,
        record.hint,
    ].filter((value) => typeof value === "string").join(" ");

    return haystack.includes("23505")
        || haystack.includes("idx_tenant_server_registry_tenant_device")
        || haystack.includes("tenant_server_registry_tenant_device");
}

function isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function reconcileCanonicalTakeoverOperationId(
    payload: Record<string, unknown> | null,
    body: DeviceActionPayload,
    validatedRequestId: string | null,
    idempotencyKey: string | null,
) {
    if (!payload || body.action !== "TAKEOVER" || !idempotencyKey || stringValue(payload.operation_id)) return payload;
    const terminalId = stringValue(body.terminal_id);
    const deviceId = stringValue(body.device_id);
    const requestMatches = !validatedRequestId
        || (stringValue(payload.request_id) === validatedRequestId
            && stringValue(payload.request_status)?.toUpperCase() === "APPROVED");
    const confirmationComplete = stringValue(payload.terminal_id) === terminalId
        && stringValue(payload.authorized_device_id) === deviceId
        && stringValue(payload.new_device_id) === deviceId
        && Object.prototype.hasOwnProperty.call(payload, "previous_device_id")
        && payload.takeover_confirmed === true
        && payload.previous_device_revoked === true
        && payload.rotate_device_token === true
        && requestMatches;
    if (!confirmationComplete) return payload;
    return { ...payload, operation_id: idempotencyKey, operation_id_reconciled: true };
}

function getRecordChild(record: Record<string, unknown>, key: string): Record<string, unknown> {
    return asRecord(record[key]);
}

async function readBody(request: ApiRequest) {
    if (request.body) {
        return typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const rawBody = Buffer.concat(chunks).toString("utf8");
    return rawBody ? JSON.parse(rawBody) : {};
}

async function loadCanonicalErpTerminal(
    supabase: AnySupabaseClient,
    terminalId: string,
) {
    const { data, error } = await supabase
        .schema("public")
        .from("erp_terminals")
        .select("id,name,store_id,device_id,authorized_device_id,config")
        .eq("id", terminalId)
        .maybeSingle();
    if (error) throw error;
    return data as ErpTerminalRecord | null;
}

const canonicalIdentityRequiredMessage = "Debe reconciliarse esta identidad con una terminal ERP antes de modificar la autorización.";

async function validateCanonicalErpActionScope(
    supabase: AnySupabaseClient,
    payload: DeviceActionPayload,
) {
    const tenantId = stringValue(payload.tenant_id);
    const terminalId = stringValue(payload.terminal_id);
    const storeId = stringValue(payload.store_id);
    if (!tenantId) return { ok: false as const, status: 400, error: "TENANT_ID_REQUIRED", message: "tenant_id es requerido." };

    const { data: tenant, error: tenantError } = await supabase
        .from("tenants")
        .select("id,contracted_product,cloud_channel,type")
        .eq("id", tenantId)
        .maybeSingle();
    if (tenantError) throw tenantError;
    if (!tenant) return { ok: false as const, status: 404, error: "TENANT_NOT_FOUND", message: "Tenant no encontrado." };
    const tenantRecord = tenant as Record<string, unknown>;
    const requiresErp = tenantRecord.contracted_product === "POS_ERP"
        || tenantRecord.cloud_channel === "ERP_ACTIVE"
        || tenantRecord.type === "full";
    if (!requiresErp) {
        return {
            ok: true as const,
            requiresErp: false as const,
            erpTenantId: null,
            canonicalAuthorizedDeviceId: null,
        };
    }

    if (!terminalId || !isUuid(terminalId) || !storeId || !isUuid(storeId)) {
        return { ok: false as const, status: 409, error: "CANONICAL_ERP_IDENTITY_REQUIRED", message: canonicalIdentityRequiredMessage };
    }
    const terminal = await loadCanonicalErpTerminal(supabase, terminalId);
    if (!terminal?.id || terminal.store_id !== storeId) {
        return { ok: false as const, status: 409, error: "ERP_TERMINAL_SCOPE_MISMATCH", message: canonicalIdentityRequiredMessage };
    }
    const { data: erpTenant, error: erpTenantError } = await supabase
        .schema("public")
        .from("erp_tenants")
        .select("id")
        .eq("config->>cloudAdminTenantId", tenantId)
        .maybeSingle();
    if (erpTenantError) throw erpTenantError;
    const erpTenantId = stringValue((erpTenant as Record<string, unknown> | null)?.id);
    const { data: store, error: storeError } = await supabase
        .schema("public")
        .from("erp_stores")
        .select("id,tenant_id")
        .eq("id", storeId)
        .maybeSingle();
    if (storeError) throw storeError;
    if (!erpTenantId || stringValue((store as Record<string, unknown> | null)?.tenant_id) !== erpTenantId) {
        return { ok: false as const, status: 409, error: "ERP_STORE_TENANT_MISMATCH", message: canonicalIdentityRequiredMessage };
    }
    return {
        ok: true as const,
        requiresErp: true as const,
        erpTenantId,
        canonicalAuthorizedDeviceId: stringValue(terminal.authorized_device_id) || stringValue(terminal.device_id),
    };
}

async function validatePendingDeviceRequest(
    supabase: AnySupabaseClient,
    payload: DeviceActionPayload,
    erpTenantId: string,
    canonicalAuthorizedDeviceId: string | null,
) {
    const requestId = stringValue(payload.request_id);
    if (!requestId) {
        return {
            ok: true as const,
            requestId: null,
            expectedAuthorizedDeviceId: canonicalAuthorizedDeviceId,
        };
    }
    const tenantId = stringValue(payload.tenant_id);
    const terminalId = stringValue(payload.terminal_id);
    const requestedDeviceId = stringValue(payload.device_id);
    if (!tenantId || !terminalId || !requestedDeviceId) {
        return { ok: false as const, status: 400, error: "DEVICE_REQUEST_INVALID", message: "Solicitud, tenant, terminal y dispositivo son requeridos." };
    }

    const { data, error } = await supabase
        .schema("public")
        .from("terminal_auth_attempts")
        .select("id,tenant_id,terminal_id,requested_device_id,authorized_device_id,reason,resolution_status,resolved_at,resolved_by,created_at")
        .eq("tenant_id", erpTenantId)
        .eq("terminal_id", terminalId)
        .order("created_at", { ascending: false })
        .limit(100);
    if (error) throw error;
    const attempts = ((data as Record<string, unknown>[] | null) || []).map(asRecord);
    const isMatchingPendingAttempt = (attempt: Record<string, unknown>) => {
        const status = (stringValue(attempt.resolution_status) || stringValue(attempt.status) || "").toUpperCase();
        const legacyPendingInferred = status === "REJECTED"
            && stringValue(attempt.reason)?.toUpperCase() === "DEVICE_SUPERSEDED"
            && !stringValue(attempt.resolved_at)
            && !stringValue(attempt.resolved_by);
        const attemptDeviceId = stringValue(attempt.requested_device_id) || stringValue(attempt.request_device_id);
        const attemptAuthorizedDeviceId = stringValue(attempt.authorized_device_id);
        return (status === "PENDING" || legacyPendingInferred)
            && attemptDeviceId === requestedDeviceId
            && (!canonicalAuthorizedDeviceId || !attemptAuthorizedDeviceId || attemptAuthorizedDeviceId === canonicalAuthorizedDeviceId);
    };
    const exactAttempt = attempts.find((item) => stringValue(item.id) === requestId);
    const currentAttempt = exactAttempt && isMatchingPendingAttempt(exactAttempt)
        ? exactAttempt
        : attempts.find(isMatchingPendingAttempt);
    if (!currentAttempt) {
        return {
            ok: false as const,
            status: 409,
            error: exactAttempt ? "DEVICE_REQUEST_NOT_PENDING" : "DEVICE_REQUEST_NOT_FOUND",
            message: exactAttempt
                ? "La solicitud seleccionada ya no está pendiente o cambió el dispositivo autorizado. Recarga el estado canónico."
                : "El ERP ya no devuelve una solicitud pendiente para este dispositivo. Recarga las solicitudes.",
        };
    }
    const requestAuthorizedDeviceId = stringValue(currentAttempt.authorized_device_id);
    return {
        ok: true as const,
        requestId: stringValue(currentAttempt.id) || requestId,
        expectedAuthorizedDeviceId: requestAuthorizedDeviceId || canonicalAuthorizedDeviceId,
    };
}

function getTextCandidate(...values: unknown[]) {
    for (const value of values) {
        const text = stringValue(value);
        if (text) return text;
    }
    return null;
}

function buildCatalogCode(value: string | null, fallback: string) {
    return (value || fallback)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64) || fallback;
}

async function loadTenantForCatalog(
    supabase: AnySupabaseClient,
    tenantId: string,
) {
    const { data, error } = await supabase
        .from("tenants")
        .select("id,name,slug")
        .eq("id", tenantId)
        .maybeSingle();
    if (error) throw error;
    return data as TenantRecord | null;
}

async function preservePublicTerminalCatalog(
    supabase: AnySupabaseClient,
    tenant: TenantRecord,
    terminal: ErpTerminalRecord | null,
    fallbackTerminalName?: string | null,
) {
    if (!terminal?.id || !terminal.store_id) {
        return { preserved: false, reason: terminal?.id ? "missing_store_id" : "missing_erp_terminal" };
    }

    const config = asRecord(terminal.config);
    const metadata = getRecordChild(config, "metadata");
    const terminalCode = getTextCandidate(
        metadata.terminal_code,
        metadata.terminalCode,
        metadata.station_number,
        metadata.stationNumber,
        config.station_number,
        config.stationNumber,
        fallbackTerminalName,
        terminal.name,
        terminal.id,
    ) || terminal.id;
    const tenantName = stringValue(tenant.name) || tenant.id;
    const tenantCode = buildCatalogCode(stringValue(tenant.slug) || tenantName, tenant.id.slice(0, 8).toUpperCase());
    const storeName = getTextCandidate(metadata.store_name, metadata.storeName, config.store_name, config.storeName, tenantName) || tenantName;

    const { error: tenantError } = await supabase
        .schema("public")
        .from("tenants")
        .upsert({
            id: tenant.id,
            code: tenantCode,
            name: tenantName,
            is_active: true,
        }, { onConflict: "id" });
    if (tenantError) throw tenantError;

    const { error: storeError } = await supabase
        .schema("public")
        .from("stores")
        .upsert({
            id: terminal.store_id,
            tenant_id: tenant.id,
            code: "MAIN",
            name: storeName,
            timezone: "America/Santo_Domingo",
            is_active: true,
        }, { onConflict: "id" });
    if (storeError) throw storeError;

    const { error: terminalError } = await supabase
        .schema("public")
        .from("terminals")
        .upsert({
            id: terminal.id,
            tenant_id: tenant.id,
            store_id: terminal.store_id,
            code: terminalCode,
            terminal_type: "POS",
            platform: "ANDROID",
            app_version: getTextCandidate(config.app_version, config.appVersion, getRecordChild(config, "runtime").appVersion),
            last_heartbeat_at: new Date().toISOString(),
            is_active: true,
        }, { onConflict: "id" });
    if (terminalError) throw terminalError;

    return { preserved: true, terminal_id: terminal.id, terminal_code: terminalCode, store_id: terminal.store_id };
}

async function reactivatePublicTenantCatalog(
    supabase: AnySupabaseClient,
    tenantId: string,
) {
    const tenant = await loadTenantForCatalog(supabase, tenantId);
    if (!tenant) return { reactivated: false, reason: "missing_landlord_tenant" };

    const tenantName = stringValue(tenant.name) || tenant.id;
    const tenantCode = buildCatalogCode(stringValue(tenant.slug) || tenantName, tenant.id.slice(0, 8).toUpperCase());
    const { error } = await supabase
        .schema("public")
        .from("tenants")
        .upsert({
            id: tenant.id,
            code: tenantCode,
            name: tenantName,
            is_active: true,
        }, { onConflict: "id" });
    if (error) throw error;

    return { reactivated: true };
}

function buildClearedErpTerminalConfig(terminal: ErpTerminalRecord, clearedAt: string) {
    const config = asRecord(terminal.config);
    const metadata = getRecordChild(config, "metadata");

    return {
        ...config,
        runtime: {},
        security: {},
        pairing: {
            ...getRecordChild(config, "pairing"),
            status: "RETRY_READY",
        },
        metadata: {
            ...metadata,
            device_id: null,
            deviceId: null,
            currentDeviceId: null,
            current_device_id: null,
            authorizedDeviceId: null,
            authorized_device_id: null,
            canonicalDeviceId: null,
            canonical_device_id: null,
            deviceBindingToken: null,
            deviceTokenFingerprint: null,
            deviceTokenIssuedAt: null,
            syncAuthToken: null,
            tokenExpiresAt: null,
            binding_status: "UNBOUND",
            device_cleared_at: clearedAt,
            device_cleared_by: "cloud-admin",
        },
        deviceBindingToken: null,
        deviceTokenFingerprint: null,
    };
}

function isArchivedErpTerminal(terminal: ErpTerminalRecord) {
    const config = asRecord(terminal.config);
    const metadata = getRecordChild(config, "metadata");
    const name = stringValue(terminal.name)?.toUpperCase() || "";
    return name.startsWith("ARCHIVED-") || metadata.archived === true || config.active === false || config.is_active === false;
}

function erpTerminalMatchesClearTarget(
    terminal: ErpTerminalRecord,
    terminalId: string,
    terminalName?: string | null,
) {
    if (terminal.id === terminalId) return true;
    const normalizedName = stringValue(terminalName)?.toUpperCase();
    if (!normalizedName) return false;

    const config = asRecord(terminal.config);
    const metadata = getRecordChild(config, "metadata");
    return [
        terminal.name,
        metadata.terminal_name,
        metadata.terminalName,
        metadata.terminal_code,
        metadata.terminalCode,
        metadata.terminal_id,
        metadata.terminalId,
    ]
        .map((value) => stringValue(value)?.toUpperCase())
        .some((value) => value === normalizedName);
}

async function loadErpTerminalsForClear(
    supabase: AnySupabaseClient,
    terminalId: string,
    terminalName?: string | null,
) {
    const direct = await loadCanonicalErpTerminal(supabase, terminalId);
    const matches = new Map<string, ErpTerminalRecord>();
    if (direct?.id) matches.set(direct.id, direct);

    if (terminalName) {
        const { data, error } = await supabase
            .schema("public")
            .from("erp_terminals")
            .select("id,name,device_id,config")
            .in("name", [terminalName, `ARCHIVED-${terminalName}`]);
        if (error) throw error;
        for (const row of ((data as ErpTerminalRecord[] | null) || [])) {
            if (erpTerminalMatchesClearTarget(row, terminalId, terminalName)) {
                matches.set(row.id, row);
            }
        }
    }

    return Array.from(matches.values()).sort((left, right) => {
        if (left.id === terminalId) return -1;
        if (right.id === terminalId) return 1;
        if (!isArchivedErpTerminal(left) && isArchivedErpTerminal(right)) return -1;
        if (isArchivedErpTerminal(left) && !isArchivedErpTerminal(right)) return 1;
        return 0;
    });
}

function buildArchivedDuplicateErpTerminalConfig(terminal: ErpTerminalRecord, canonicalTerminalId: string, archivedAt: string) {
    const config = asRecord(terminal.config);
    const metadata = getRecordChild(config, "metadata");
    return {
        ...buildClearedErpTerminalConfig(terminal, archivedAt),
        active: false,
        is_active: false,
        pairing: {
            ...getRecordChild(config, "pairing"),
            status: "ARCHIVED",
        },
        metadata: {
            ...metadata,
            archived: true,
            archived_at: archivedAt,
            archived_reason: "DUPLICATE_TERMINAL_CLEARED_BY_CLOUD_ADMIN",
            canonical_erp_terminal_id: canonicalTerminalId,
            terminal_id: null,
            terminalId: null,
            erp_terminal_id: null,
            erpTerminalId: null,
            binding_status: "ARCHIVED",
            device_id: null,
            deviceId: null,
            currentDeviceId: null,
            current_device_id: null,
            authorizedDeviceId: null,
            authorized_device_id: null,
            canonicalDeviceId: null,
            canonical_device_id: null,
            deviceBindingToken: null,
            deviceTokenFingerprint: null,
            deviceTokenIssuedAt: null,
            syncAuthToken: null,
            tokenExpiresAt: null,
        },
    };
}

async function clearErpTerminalDeviceBindings(
    supabase: AnySupabaseClient,
    terminalId: string,
    terminalName?: string | null,
) {
    const terminals = await loadErpTerminalsForClear(supabase, terminalId, terminalName);
    if (terminals.length === 0) return { cleared: false, erpTerminalIds: [], previousDeviceIds: [] };

    const clearedAt = new Date().toISOString();
    const erpTerminalIds: string[] = [];
    const previousDeviceIds: string[] = [];

    for (const [index, terminal] of terminals.entries()) {
        const isPrimary = index === 0 || terminal.id === terminalId;
        const { error } = await supabase
            .schema("public")
            .from("erp_terminals")
            .update(isPrimary ? {
                device_id: "",
                config: buildClearedErpTerminalConfig(terminal, clearedAt),
            } : {
                device_id: `ARCHIVED-${terminal.id.slice(0, 8)}`,
                name: `ARCHIVED-${terminal.name || terminal.id.slice(0, 8)}`,
                config: buildArchivedDuplicateErpTerminalConfig(terminal, terminals[0]?.id || terminalId, clearedAt),
            })
            .eq("id", terminal.id);
        if (error) throw error;
        erpTerminalIds.push(terminal.id);
        if (terminal.device_id) previousDeviceIds.push(terminal.device_id);
    }

    return {
        cleared: true,
        erpTerminalIds,
        previousDeviceIds,
    };
}

async function fallbackClearTerminalDevices(
    payload: DeviceActionPayload,
    headers: IncomingHttpHeaders,
    supabaseUrl: string,
    serviceRoleKey: string,
) {
    const tenantId = stringValue(payload.tenant_id);
    const requestedTerminalId = stringValue(payload.terminal_id);
    const terminalName = stringValue(payload.terminal_name);
    const reason = stringValue(payload.reason) || "LAB_DEVICE_BINDING_RESET";
    const performedBy = getHeader(headers, "x-actor-email")
        || getHeader(headers, "x-actor-user-id")
        || getHeader(headers, "x-actor-source")
        || "cloud-admin-api";

    if (!tenantId || !requestedTerminalId) {
        return {
            statusCode: 400,
            body: { error: "VALIDATION_ERROR", message: "Selecciona tenant, terminal y accion." },
        };
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        db: { schema: "landlord" },
    });
    const tenant = await loadTenantForCatalog(supabase, tenantId);
    if (!tenant) {
        return {
            statusCode: 404,
            body: { error: "TENANT_NOT_FOUND", message: "Tenant no encontrado." },
        };
    }

    let terminalQuery = supabase
        .schema("public")
        .from("terminals")
        .select("id,code")
        .eq("tenant_id", tenantId);

    const catalogTerminalId = stringValue(payload.catalog_terminal_id);
    terminalQuery = catalogTerminalId && isUuid(catalogTerminalId)
        ? terminalQuery.eq("id", catalogTerminalId)
        : terminalQuery.eq("id", "00000000-0000-0000-0000-000000000000");

    const { data: terminalData, error: terminalError } = await terminalQuery
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (terminalError) throw terminalError;

    const publicTerminal = (terminalData as PublicTerminalRecord | null) || null;
    const terminalDisplayCode = publicTerminal?.code || terminalName || requestedTerminalId;

    const { data: registryRows, error: registryRowsError } = await supabase
        .from("tenant_server_registry")
        .select("id,terminal_id,terminal_name,device_id,current_device_id,authorized_device_id,previous_device_id,last_rejected_device_id")
        .eq("tenant_id", tenantId)
        .order("last_seen_at", { ascending: false });
    if (registryRowsError) throw registryRowsError;

    const rows = ((Array.isArray(registryRows) ? registryRows : []) as RegistryRecord[]).filter((row) => {
        const rowTerminalId = row.terminal_id?.trim() || "";
        return row.id === stringValue(payload.registry_id)
            || rowTerminalId === requestedTerminalId
            || Boolean(catalogTerminalId && rowTerminalId === catalogTerminalId);
    });

    if (!publicTerminal && rows.length === 0) {
        return {
            statusCode: 404,
            body: { error: "TERMINAL_NOT_FOUND", message: "Terminal no encontrada para este tenant." },
        };
    }

    const registryIds = rows.map((row) => row.id).filter(Boolean);
    const clearedDeviceIds = Array.from(new Set(
        rows
            .flatMap((row) => [
                row.device_id,
                row.current_device_id,
                row.authorized_device_id,
                row.previous_device_id,
                row.last_rejected_device_id,
            ])
            .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
    ));

    let count = 0;
    if (registryIds.length > 0) {
        const { error: deleteError, count: deletedCount } = await supabase
            .from("tenant_server_registry")
            .delete({ count: "exact" })
            .eq("tenant_id", tenantId)
            .in("id", registryIds);
        if (deleteError) throw deleteError;
        count = deletedCount || 0;
    }

    const canonicalErpTerminal = await loadCanonicalErpTerminal(supabase, requestedTerminalId);
    const catalogPreserveResult = await preservePublicTerminalCatalog(
        supabase,
        tenant,
        canonicalErpTerminal,
        terminalDisplayCode,
    );
    const erpClearResult = await clearErpTerminalDeviceBindings(supabase, requestedTerminalId, null);
    const uniqueClearedDeviceIds = Array.from(new Set([
        ...clearedDeviceIds,
        ...erpClearResult.previousDeviceIds,
    ]));

    const { error: auditError } = await supabase
        .from("terminal_device_audit")
        .insert({
            tenant_id: tenantId,
            terminal_id: requestedTerminalId,
            terminal_name: terminalDisplayCode,
            old_device_id: uniqueClearedDeviceIds.join(", ") || null,
            new_device_id: null,
            action: "CLEAR_TERMINAL_DEVICES",
            performed_by: performedBy,
            reason,
            result: "SUCCESS",
            metadata: {
                fallback_source: "vercel-api",
                registry_ids: registryIds,
                cleared_registry_count: count,
                cleared_device_ids: uniqueClearedDeviceIds,
                erp_terminal_cleared: erpClearResult.cleared,
                erp_terminal_ids: erpClearResult.erpTerminalIds,
                first_activation_noop: registryIds.length === 0,
                public_terminal_preserved: Boolean(publicTerminal?.id) || catalogPreserveResult.preserved,
                public_catalog_preserve_result: catalogPreserveResult,
            },
        });
    if (auditError) {
        console.warn("terminal-device-action fallback audit failed", auditError);
    }

    return {
        statusCode: 200,
        body: {
            status: "success",
            success: true,
            action: "terminal_devices_cleared",
            cleared_registry_count: count,
            cleared_device_ids: uniqueClearedDeviceIds,
            erp_terminal_cleared: erpClearResult.cleared,
            first_activation_noop: registryIds.length === 0,
            message: registryIds.length === 0
                ? "La terminal no tenia devices previos. Queda disponible para primera activacion."
                : "Devices de la terminal limpiados. La terminal conserva su configuracion y puede vincularse nuevamente.",
        },
    };
}

async function repairDuplicateTenantDeviceRegistry(
    payload: DeviceActionPayload,
    headers: IncomingHttpHeaders,
    supabaseUrl: string,
    serviceRoleKey: string,
) {
    const tenantId = stringValue(payload.tenant_id);
    const requestedTerminalId = stringValue(payload.terminal_id);
    const registryId = stringValue(payload.registry_id);
    const terminalName = stringValue(payload.terminal_name);
    const deviceId = stringValue(payload.device_id);
    const action = stringValue(payload.action) || "TAKEOVER";
    const reason = stringValue(payload.reason) || "TENANT_DEVICE_UNIQUE_CONFLICT_REPAIR";
    const performedBy = getHeader(headers, "x-actor-email")
        || getHeader(headers, "x-actor-user-id")
        || getHeader(headers, "x-actor-source")
        || "cloud-admin-api";

    if (!tenantId || !requestedTerminalId || !deviceId) {
        return {
            statusCode: 400,
            body: { error: "DEVICE_ID_REQUIRED", message: "DEVICE_ID_REQUIRED: tenant, terminal y device_id son requeridos para reparar el enlace." },
        };
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        db: { schema: "landlord" },
    });

    let terminalId = requestedTerminalId;
    let terminalDisplayCode = terminalName || requestedTerminalId;
    let previousDeviceId: string | null = null;

    const { data: selectedRegistry, error: selectedRegistryError } = registryId
        ? await supabase
            .from("tenant_server_registry")
            .select("id,terminal_id,terminal_name,device_id,current_device_id,authorized_device_id,previous_device_id,last_rejected_device_id")
            .eq("tenant_id", tenantId)
            .eq("id", registryId)
            .maybeSingle()
        : { data: null, error: null };
    if (selectedRegistryError) throw selectedRegistryError;

    const selected = (selectedRegistry as RegistryRecord | null) || null;
    if (selected?.terminal_id) terminalId = selected.terminal_id;
    if (selected?.terminal_name) terminalDisplayCode = selected.terminal_name;
    previousDeviceId = selected?.device_id || selected?.current_device_id || selected?.authorized_device_id || null;

    let publicTerminalQuery = supabase
        .schema("public")
        .from("terminals")
        .select("id,code")
        .eq("tenant_id", tenantId);
    publicTerminalQuery = isUuid(requestedTerminalId)
        ? publicTerminalQuery.eq("id", requestedTerminalId)
        : publicTerminalQuery.eq("code", terminalName || requestedTerminalId);

    const { data: publicTerminalData, error: publicTerminalError } = await publicTerminalQuery
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (publicTerminalError) throw publicTerminalError;

    const publicTerminal = (publicTerminalData as PublicTerminalRecord | null) || null;
    if (publicTerminal?.id) terminalId = publicTerminal.id;
    if (publicTerminal?.code) terminalDisplayCode = publicTerminal.code;

    const { data: existingRegistry, error: existingRegistryError } = await supabase
        .from("tenant_server_registry")
        .select("id,terminal_id,terminal_name,device_id,current_device_id,authorized_device_id,previous_device_id,last_rejected_device_id")
        .eq("tenant_id", tenantId)
        .eq("device_id", deviceId)
        .maybeSingle();
    if (existingRegistryError) throw existingRegistryError;

    const existing = (existingRegistry as RegistryRecord | null) || null;
    if (!existing?.id) {
        return {
            statusCode: 409,
            body: {
                error: "TENANT_DEVICE_CONFLICT_NOT_REPAIRABLE",
                message: "ALFA-Admin detectó un conflicto de device, pero no encontró el registro existente para repararlo.",
            },
        };
    }

    const repairedAt = new Date().toISOString();
    const registryUpdate = {
        terminal_id: terminalId,
        terminal_name: terminalDisplayCode,
        device_id: deviceId,
        current_device_id: deviceId,
        authorized_device_id: deviceId,
        previous_device_id: previousDeviceId && previousDeviceId !== deviceId ? previousDeviceId : existing.previous_device_id || null,
        last_rejected_device_id: null,
        status: "ONLINE",
        auth_status: "AUTHORIZED",
        is_revoked: false,
        requires_pos_reauth: false,
        last_auth_error: null,
        last_auth_attempt_at: repairedAt,
        updated_at: repairedAt,
    };

    const { error: updateExistingError } = await supabase
        .from("tenant_server_registry")
        .update(registryUpdate)
        .eq("id", existing.id);
    if (updateExistingError) throw updateExistingError;

    const { data: registryRows, error: registryRowsError } = await supabase
        .from("tenant_server_registry")
        .select("id,terminal_id,terminal_name")
        .eq("tenant_id", tenantId);
    if (registryRowsError) throw registryRowsError;

    const duplicateIds = ((Array.isArray(registryRows) ? registryRows : []) as RegistryRecord[])
        .filter((row) => {
            if (!row.id || row.id === existing.id) return false;
            const rowTerminalId = row.terminal_id?.trim() || "";
            const rowTerminalName = row.terminal_name?.trim() || "";
            return rowTerminalId === terminalId
                || rowTerminalId === requestedTerminalId
                || Boolean(terminalDisplayCode && rowTerminalId.toUpperCase() === terminalDisplayCode.toUpperCase())
                || Boolean(terminalDisplayCode && rowTerminalName.toUpperCase() === terminalDisplayCode.toUpperCase());
        })
        .map((row) => row.id);

    if (duplicateIds.length > 0) {
        const { error: archiveError } = await supabase
            .from("tenant_server_registry")
            .update({
                status: "OFFLINE",
                auth_status: "OLD_DEVICE_REVOKED",
                is_revoked: true,
                revocation_reason: "POS_ERP_TERMINAL_TAKEOVER_SUPERSEDED",
                requires_pos_reauth: true,
                previous_device_id: deviceId,
                updated_at: repairedAt,
            })
            .in("id", duplicateIds);
        if (archiveError) throw archiveError;
    }

    const { error: auditError } = await supabase
        .from("terminal_device_audit")
        .insert({
            tenant_id: tenantId,
            terminal_id: terminalId,
            terminal_name: terminalDisplayCode,
            old_device_id: previousDeviceId,
            new_device_id: deviceId,
            action,
            performed_by: performedBy,
            reason,
            result: "SUCCESS",
            metadata: {
                fallback_source: "vercel-api",
                action_result: "terminal_device_registry_merged_after_conflict",
                edge_error: "idx_tenant_server_registry_tenant_device",
                registry_id: existing.id,
                requested_registry_id: registryId,
                archived_duplicate_registry_ids: duplicateIds,
            },
        });
    if (auditError) {
        console.warn("terminal-device-action duplicate registry repair audit failed", auditError);
    }

    return {
        statusCode: 200,
        body: {
            status: "success",
            success: true,
            action: "terminal_device_registry_merged_after_conflict",
            registry_id: existing.id,
            requested_registry_id: registryId,
            authorized_device_id: deviceId,
            archived_duplicate_registry_ids: duplicateIds,
            message: "Device autorizado; ALFA-Admin reparó el registro duplicado. Reintenta conexión desde el POS.",
        },
    };
}

export default async function handler(request: ApiRequest, response: ServerResponse) {
    if (request.method === "OPTIONS") {
        setCors(response);
        response.statusCode = 204;
        response.end();
        return;
    }

    if (request.method !== "POST") {
        sendJson(response, 405, { error: "METHOD_NOT_ALLOWED", message: "Metodo no permitido." });
        return;
    }

    try {
        const { admin, actor } = await requireCloudAdminPermission(request.headers, "terminal_reauthorization");
        const body = await readBody(request) as DeviceActionPayload;
        const supabaseUrl = getEnv("SUPABASE_URL", "VITE_SUPABASE_URL").replace(/\/$/, "");
        const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
        const tenantId = stringValue(body.tenant_id);

        if (requiresDeviceId(body.action) && !stringValue(body.device_id)) {
            console.warn("cloud_admin_device_id_missing", {
                action: body.action,
                tenant_id: stringValue(body.tenant_id),
                terminal_id: stringValue(body.terminal_id),
                terminal_name: stringValue(body.terminal_name),
                source: "terminal-device-action-proxy",
            });
            console.warn("cloud_admin_erp_repair_skipped_missing_device", {
                action: body.action,
                tenant_id: stringValue(body.tenant_id),
                terminal_id: stringValue(body.terminal_id),
                source: "terminal-device-action-proxy",
            });
            sendJson(response, 400, {
                error: "DEVICE_ID_REQUIRED",
                message: "DEVICE_ID_REQUIRED: ALFA-Admin necesita un device_id autorizado antes de llamar ALFA-RMS.",
            });
            return;
        }

        let validatedRequestId = stringValue(body.request_id);
        let canonicalExpectedAuthorizedDeviceId = stringValue(body.expected_authorized_device_id);
        if (tenantId) {
            const scopeValidation = await validateCanonicalErpActionScope(admin, body);
            if (!scopeValidation.ok) {
                sendJson(response, scopeValidation.status, {
                    error: scopeValidation.error,
                    message: scopeValidation.message,
                });
                return;
            }
            if (body.action === "TAKEOVER" && scopeValidation.requiresErp && scopeValidation.erpTenantId) {
                const requestValidation = await validatePendingDeviceRequest(
                    admin,
                    body,
                    scopeValidation.erpTenantId,
                    scopeValidation.canonicalAuthorizedDeviceId,
                );
                if (!requestValidation.ok) {
                    sendJson(response, requestValidation.status, {
                        error: requestValidation.error,
                        message: requestValidation.message,
                    });
                    return;
                }
                validatedRequestId = requestValidation.requestId || validatedRequestId;
                canonicalExpectedAuthorizedDeviceId = requestValidation.expectedAuthorizedDeviceId
                    || scopeValidation.canonicalAuthorizedDeviceId
                    || canonicalExpectedAuthorizedDeviceId;
            }
            await reactivatePublicTenantCatalog(admin, tenantId);
        }

        const verifiedBody = {
            ...body,
            request_id: validatedRequestId,
            expected_authorized_device_id: canonicalExpectedAuthorizedDeviceId,
            requested_by: actor.email,
            actor_user_id: actor.authUserId,
        };

        const idempotencyKey = stringValue(getHeader(request.headers, "idempotency-key"))
            || stringValue(body.idempotency_key);
        const edgeResponse = await fetch(`${supabaseUrl}/functions/v1/request-terminal-device-authorization`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${serviceRoleKey}`,
                "Content-Type": "application/json",
                "X-Actor-Source": "cloud-admin-api",
                "X-Actor-Email": actor.email,
                "X-Actor-User-Id": actor.authUserId,
                "Idempotency-Key": idempotencyKey || "",
            },
            body: JSON.stringify(verifiedBody),
        });

        let payloadText = await edgeResponse.text();
        let edgePayload: Record<string, unknown> | null = null;
        try {
            edgePayload = payloadText ? JSON.parse(payloadText) as Record<string, unknown> : null;
        } catch {
            edgePayload = null;
        }
        if (edgeResponse.ok) {
            edgePayload = reconcileCanonicalTakeoverOperationId(
                edgePayload,
                body,
                validatedRequestId,
                idempotencyKey,
            );
            if (edgePayload) payloadText = JSON.stringify(edgePayload);
        }

        if (
            !edgeResponse.ok
            && body.action === "CLEAR_TERMINAL_DEVICES"
            && edgePayload?.error === "INVALID_ACTION"
        ) {
            const fallback = await fallbackClearTerminalDevices(body, request.headers, supabaseUrl, serviceRoleKey);
            sendJson(response, fallback.statusCode, fallback.body);
            return;
        }

        if (!edgeResponse.ok && isLegacyDeviceAuthorizationPermissionPayload(edgePayload)) {
            sendJson(response, edgeResponse.status, {
                ...(edgePayload || {}),
                error: stringValue(edgePayload?.error) || "ERP_DEVICE_ACTION_FAILED",
                message: `ERP rechazo la autorizacion del device (HTTP ${edgeResponse.status}) sin detalle. Verifica el tenant ERP, el token de servicio ERP y que la terminal este activa.`,
                erp_status: edgeResponse.status,
                legacy_message_rewritten: true,
            });
            return;
        }

        if (
            !edgeResponse.ok
            && body.action !== "TAKEOVER"
            && isTenantDeviceUniqueConflict(edgePayload || payloadText)
        ) {
            const fallback = await repairDuplicateTenantDeviceRegistry(body, request.headers, supabaseUrl, serviceRoleKey);
            sendJson(response, fallback.statusCode, fallback.body);
            return;
        }

        setCors(response);
        response.statusCode = edgeResponse.status;
        response.setHeader("Content-Type", edgeResponse.headers.get("content-type") || "application/json");
        response.end(payloadText || "{}");
    } catch (error) {
        if (error instanceof CloudAdminAuthError) {
            sendJson(response, error.status, { error: error.code, message: error.message });
            return;
        }
        console.error("terminal-device-action proxy failed", error);
        sendJson(response, 500, {
            error: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Error interno ejecutando accion de terminal.",
        });
    }
}
