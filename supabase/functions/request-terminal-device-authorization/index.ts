import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';

declare const Deno: {
    env: {
        get(key: string): string | undefined;
    };
    serve(handler: (request: Request) => Response | Promise<Response>): void;
};

type DeviceAction =
    | 'TAKEOVER'
    | 'ROTATE_TOKEN'
    | 'REVOKE_DEVICE'
    | 'SYNC_AUTHORIZED_DEVICE'
    | 'GENERATE_PAIRING_CODE'
    | 'CLEAR_TERMINAL_DEVICES'
    | 'TAKEOVER_AUTHORIZED'
    | 'DEVICE_REVOKED'
    | 'DUPLICATE_PREVENTED'
    | 'CLOUD_ADMIN_REPAIR_REQUESTED'
    | 'CLOUD_ADMIN_ERP_REPAIR_CONFIRMED'
    | 'CLOUD_ADMIN_ERP_REPAIR_FAILED'
    | 'CLOUD_ADMIN_DEVICE_MISMATCH_DETECTED'
    | 'CLOUD_ADMIN_CREDENTIALS_ROTATED';

interface DeviceActionRequest {
    tenant_id?: string;
    terminal_id?: string;
    catalog_terminal_id?: string | null;
    store_id?: string | null;
    registry_id?: string | null;
    terminal_name?: string | null;
    device_name?: string | null;
    device_id?: string;
    request_id?: string | null;
    expected_authorized_device_id?: string | null;
    action?: DeviceAction;
    reason?: string;
    confirm_action?: boolean;
    idempotency_key?: string;
    requested_by?: string;
}

interface TenantRecord {
    id: string;
    name: string;
    slug?: string | null;
    email?: string | null;
    status: string;
    type?: string | null;
    contracted_product?: string | null;
    pos_runtime?: string | null;
}

interface RegistryRecord {
    id: string;
    tenant_id: string;
    device_id?: string | null;
    terminal_id?: string | null;
    terminal_name?: string | null;
    current_device_id?: string | null;
    authorized_device_id?: string | null;
    previous_device_id?: string | null;
    last_rejected_device_id?: string | null;
    is_revoked?: boolean | null;
    auth_status?: string | null;
    status?: string | null;
}

interface PublicTerminalRecord {
    id: string;
    tenant_id: string;
    code?: string | null;
    is_active?: boolean | null;
}

interface ErpTenantRecord {
    id: string;
    config?: Record<string, unknown> | null;
}

interface ErpTerminalRecord {
    id: string;
    name?: string | null;
    store_id?: string | null;
    device_id?: string | null;
    config?: Record<string, unknown> | null;
    last_seen?: string | null;
    created_at?: string | null;
}

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-actor-user-id, x-actor-email, x-actor-source, idempotency-key, x-idempotency-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const tokenKeys = new Set([
    'syncAuthToken',
    'sync_auth_token',
    'deviceToken',
    'device_token',
    'token',
    'auth_token',
    'access_token',
    'refresh_token',
    'code',
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
    if (Array.isArray(value)) return value.map((item) => sanitizePayload(item));
    if (!value || typeof value !== 'object') return value;

    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (tokenKeys.has(key)) continue;
        output[key] = sanitizePayload(item);
    }
    return output;
}

function hasToken(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some((item) => hasToken(item));
    return Object.entries(value as Record<string, unknown>).some(([key, item]) => (
        tokenKeys.has(key) || hasToken(item)
    ));
}

function getTokenPreview(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const record = payload as Record<string, unknown>;
    const candidates = [
        record.tokenPreview,
        record.token_preview,
        record.deviceTokenPreview,
        record.device_token_preview,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    return null;
}

function firstText(...values: unknown[]): string | null {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
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
    const actionableErrors: Record<string, string> = {
        DEVICE_SUPERSEDED: 'El dispositivo seleccionado ya fue reemplazado. Recarga el estado canónico antes de reintentar.',
        DEVICE_NOT_AUTHORIZED: 'El ERP no reconoce este dispositivo como autorizado para la terminal.',
        TAKEOVER_REQUIRED: 'El ERP requiere un takeover explícito para reemplazar el dispositivo actual.',
        TAKEOVER_POLICY_DENIED: 'La política del ERP denegó el takeover. Verifica permisos, tenant y terminal.',
        TERMINAL_NOT_FOUND: 'La terminal canónica no fue encontrada en el ERP.',
        ERP_TERMINAL_NOT_FOUND: 'La terminal canónica no fue encontrada en el ERP.',
        TENANT_NOT_FOUND: 'El tenant no fue encontrado en el ERP.',
        ERP_TENANT_NOT_FOUND: 'El tenant no fue encontrado en el ERP.',
        TENANT_MISMATCH: 'La terminal no pertenece al tenant indicado.',
        ERP_STORE_TENANT_MISMATCH: 'La terminal no pertenece al tenant indicado.',
        CONFLICT: 'Otra reautorización modificó la terminal al mismo tiempo. Se consultará el estado canónico.',
    };
    if (code && actionableErrors[code]) return actionableErrors[code];
    if (status === 409) return 'Conflicto de concurrencia: el estado de la terminal cambió durante la reautorización. Recarga el estado canónico.';
    if (code === 'DEVICE_NOT_AUTHORIZED') {
        return 'Este POS intenta usar una terminal que esta autorizada para otro equipo. Puedes reautorizar este equipo si realmente reemplazaste el dispositivo.';
    }
    if (code === 'PAIRING_CODE_INVALID' || code === 'INVALID_PAIRING_CODE') {
        return 'El ERP rechazo la autorizacion del device.';
    }
    if (code === 'LICENSE_NOT_ALLOWED') {
        return 'La licencia actual no permite reautorizar esta terminal.';
    }
    if (payload && typeof payload === 'object') {
        const record = payload as Record<string, unknown>;
        if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
        if (typeof record.error === 'string' && record.error.trim() && record.error.trim() !== code) {
            return record.error.trim();
        }
    }
    if (status === 401 || status === 403) {
        return `ERP rechazo la autorizacion del device (HTTP ${status}) sin detalle. Verifica el tenant ERP, el token de servicio ERP y que la terminal este activa.`;
    }
    return 'El ERP no pudo completar la accion de autorizacion.';
}

const canonicalTakeoverReason = 'CLOUD_ADMIN_TERMINAL_REAUTHORIZATION';

function getPayloadText(payload: unknown, ...keys: string[]) {
    const record = asRecord(payload);
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

function getCanonicalTakeoverConfirmation(payload: unknown) {
    const record = asRecord(payload);
    const terminal = Object.keys(asRecord(record.terminal)).length > 0 ? asRecord(record.terminal) : record;
    const terminalConfig = asRecord(terminal.config);
    const terminalMetadata = asRecord(terminalConfig.metadata);
    const credentials = asRecord(record.credentials);
    const terminalId = getPayloadText(record, 'terminal_id', 'terminalId', 'id')
        || getPayloadText(terminal, 'id', 'terminal_id', 'terminalId');
    const previousDeviceId = getPayloadText(record, 'previous_device_id', 'previousDeviceId', 'old_device_id', 'oldDeviceId');
    const authorizedDeviceId = getPayloadText(record, 'authorized_device_id', 'authorizedDeviceId', 'new_device_id', 'newDeviceId', 'device_id', 'deviceId')
        || getPayloadText(terminal, 'authorized_device_id', 'authorizedDeviceId', 'device_id', 'deviceId')
        || getPayloadText(terminalMetadata, 'authorized_device_id', 'authorizedDeviceId', 'current_device_id', 'currentDeviceId');
    const takeoverConfirmed = record.takeover === true
        || record.takeover_confirmed === true
        || record.takeoverConfirmed === true
        || record.action === 'terminal_takeover_completed'
        || record.status === 'TAKEOVER_COMPLETED';
    const rotationConfirmed = record.rotate_device_token === true
        || record.device_token_rotated === true
        || record.credentials_rotated === true
        || credentials.rotated === true
        || ['ROTATED', 'REVOKED_AND_ROTATED'].includes(String(record.device_token_status || record.deviceTokenStatus || ''));
    const revocationConfirmed = record.previous_device_revoked === true
        || record.credentials_revoked === true
        || record.previous_credentials_revoked === true
        || credentials.previous_revoked === true
        || record.revocation_confirmed === true;

    return {
        terminalId,
        previousDeviceId,
        authorizedDeviceId,
        takeoverConfirmed,
        rotationConfirmed,
        revocationConfirmed,
    };
}

function validateCanonicalTakeoverConfirmation(
    payload: unknown,
    expectedTerminalId: string,
    expectedDeviceId: string,
) {
    const confirmation = getCanonicalTakeoverConfirmation(payload);
    const errors: string[] = [];
    if (confirmation.terminalId !== expectedTerminalId) errors.push('terminal_id');
    if (!confirmation.previousDeviceId) errors.push('previous_device_id');
    if (confirmation.authorizedDeviceId !== expectedDeviceId) errors.push('authorized_device_id');
    if (!confirmation.takeoverConfirmed) errors.push('takeover');
    if (!confirmation.rotationConfirmed) errors.push('rotate_device_token');
    if (!confirmation.revocationConfirmed) errors.push('previous_credentials_revoked');
    return { confirmed: errors.length === 0, errors, confirmation };
}

async function fetchCanonicalTerminalState(
    erpApiUrl: string,
    erpServiceToken: string,
    erpTenantId: string,
    terminalId: string,
) {
    const response = await fetch(`${erpApiUrl.replace(/\/$/, '')}/api/settings/terminals/${encodeURIComponent(terminalId)}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${erpServiceToken}`,
            'X-Tenant-Id': erpTenantId,
        },
    });
    const payload = await response.json().catch(async () => ({ message: await response.text().catch(() => '') }));
    return { response, payload };
}

function getUnknownErrorMessage(error: unknown) {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error.trim()) return error.trim();
    if (error && typeof error === 'object') {
        const record = error as Record<string, unknown>;
        const candidates = [record.message, record.error, record.details, record.hint, record.code];
        for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
        }
    }
    return 'Error interno ejecutando autorizacion de terminal.';
}

function isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getRecordChild(record: Record<string, unknown>, key: string): Record<string, unknown> {
    return asRecord(record[key]);
}

function isPosTenant(tenant: TenantRecord) {
    if (tenant.contracted_product) {
        return tenant.contracted_product === 'POS_ONLY' || tenant.contracted_product === 'POS_ERP';
    }
    return tenant.type === 'pos_only' || tenant.type === 'full';
}

function isOperationalTenantStatus(status?: string | null) {
    const normalized = (status || '').trim().toUpperCase();
    return normalized === 'ACTIVE' || normalized === 'TRIAL';
}

function sameDeviceId(left?: string | null, right?: string | null) {
    return Boolean(left?.trim() && right?.trim() && left.trim() === right.trim());
}

function getTextCandidate(...values: unknown[]) {
    for (const value of values) {
        const text = typeof value === 'string' && value.trim() ? value.trim() : null;
        if (text) return text;
    }
    return null;
}

function buildCatalogCode(value: string | null, fallback: string) {
    return (value || fallback)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || fallback;
}

function normalizeRequiredDeviceId(value?: string | null) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requiresRequestDeviceId(action: DeviceAction | undefined) {
    return action === 'TAKEOVER'
        || action === 'ROTATE_TOKEN'
        || action === 'SYNC_AUTHORIZED_DEVICE'
        || action === 'GENERATE_PAIRING_CODE';
}

function logCloudAdminDeviceEvent(event: string, metadata: Record<string, unknown>) {
    console.info(event, sanitizePayload(metadata));
}

function getErpTerminalDeviceFields(terminal: ErpTerminalRecord | null) {
    const config = asRecord(terminal?.config);
    const metadata = getRecordChild(config, 'metadata');
    const runtime = getRecordChild(config, 'runtime');
    const security = getRecordChild(config, 'security');
    const pairing = getRecordChild(config, 'pairing');

    return {
        terminalId: firstText(
            metadata.terminal_id,
            metadata.terminalId,
            metadata.pos_terminal_id,
            metadata.posTerminalId,
            terminal?.id,
        ),
        erpTerminalId: terminal?.id || null,
        deviceId: terminal?.device_id || null,
        authorizedDeviceId: firstText(
            metadata.authorizedDeviceId,
            metadata.authorized_device_id,
            config.authorizedDeviceId,
            config.authorized_device_id,
        ),
        currentDeviceId: firstText(
            metadata.currentDeviceId,
            metadata.current_device_id,
            config.currentDeviceId,
            config.current_device_id,
        ),
        canonicalDeviceId: firstText(
            metadata.canonicalDeviceId,
            metadata.canonical_device_id,
            config.canonicalDeviceId,
            config.canonical_device_id,
        ),
        pairingStatus: firstText(
            pairing.status,
            metadata.pairingStatus,
            metadata.pairing_status,
        ),
        tokenFingerprint: firstText(
            security.deviceTokenFingerprint,
            security.device_token_fingerprint,
            metadata.deviceTokenFingerprint,
            metadata.device_token_fingerprint,
        ),
        tokenIssuedAt: firstText(
            security.deviceTokenIssuedAt,
            security.device_token_issued_at,
            metadata.deviceTokenIssuedAt,
            metadata.device_token_issued_at,
        ),
        hasRuntimeToken: Boolean(firstText(
            runtime.syncAuthToken,
            runtime.sync_auth_token,
            runtime.token,
        )),
    };
}

function buildClearedErpTerminalConfig(terminal: ErpTerminalRecord, clearedAt: string) {
    const config = asRecord(terminal.config);
    const metadata = getRecordChild(config, 'metadata');

    return {
        ...config,
        runtime: {},
        security: {},
        pairing: {
            ...getRecordChild(config, 'pairing'),
            status: 'RETRY_READY',
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
            binding_status: 'UNBOUND',
            device_cleared_at: clearedAt,
            device_cleared_by: 'cloud-admin',
        },
        deviceBindingToken: null,
        deviceTokenFingerprint: null,
    };
}

function isArchivedErpTerminal(terminal: ErpTerminalRecord) {
    const config = asRecord(terminal.config);
    const metadata = getRecordChild(config, 'metadata');
    const name = firstText(terminal.name)?.toUpperCase() || '';
    return name.startsWith('ARCHIVED-') || metadata.archived === true || config.active === false || config.is_active === false;
}

function erpTerminalMatchesClearTarget(
    terminal: ErpTerminalRecord,
    terminalId: string,
    terminalName?: string | null,
) {
    if (terminal.id === terminalId) return true;
    const config = asRecord(terminal.config);
    const metadata = getRecordChild(config, 'metadata');
    const normalizedName = firstText(terminalName)?.toUpperCase();
    if (!normalizedName) return false;

    return [
        terminal.name,
        metadata.terminal_name,
        metadata.terminalName,
        metadata.terminal_code,
        metadata.terminalCode,
        metadata.terminal_id,
        metadata.terminalId,
    ]
        .map((value) => firstText(value)?.toUpperCase())
        .some((value) => value === normalizedName);
}

async function loadErpTerminalsForClear(
    supabase: ReturnType<typeof createClient>,
    terminalId: string,
    terminalName?: string | null,
) {
    const direct = await loadCanonicalErpTerminal(supabase, terminalId);
    const matches = new Map<string, ErpTerminalRecord>();
    if (direct?.id) matches.set(direct.id, direct);

    if (terminalName) {
        const { data, error } = await supabase
            .schema('public')
            .from('erp_terminals')
            .select('id,name,device_id,config,last_seen,created_at')
            .in('name', [terminalName, `ARCHIVED-${terminalName}`])
            .order('last_seen', { ascending: false });
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
    const metadata = getRecordChild(config, 'metadata');
    return {
        ...buildClearedErpTerminalConfig(terminal, archivedAt),
        active: false,
        is_active: false,
        pairing: {
            ...getRecordChild(config, 'pairing'),
            status: 'ARCHIVED',
        },
        metadata: {
            ...metadata,
            archived: true,
            archived_at: archivedAt,
            archived_reason: 'DUPLICATE_TERMINAL_CLEARED_BY_CLOUD_ADMIN',
            canonical_erp_terminal_id: canonicalTerminalId,
            terminal_id: null,
            terminalId: null,
            erp_terminal_id: null,
            erpTerminalId: null,
            binding_status: 'ARCHIVED',
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
    supabase: ReturnType<typeof createClient>,
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
            .schema('public')
            .from('erp_terminals')
            .update(isPrimary ? {
                device_id: '',
                config: buildClearedErpTerminalConfig(terminal, clearedAt),
            } : {
                device_id: `ARCHIVED-${terminal.id.slice(0, 8)}`,
                name: `ARCHIVED-${terminal.name || terminal.id.slice(0, 8)}`,
                config: buildArchivedDuplicateErpTerminalConfig(terminal, terminals[0]?.id || terminalId, clearedAt),
            })
            .eq('id', terminal.id);
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

function buildErpBindingConfirmation(input: {
    terminal: ErpTerminalRecord | null;
    expectedTerminalId: string;
    expectedDeviceId: string;
    deviceTokenIssued: boolean;
    deviceTokenStatus: string | null;
    tokenPreview: string | null;
}) {
    const fields = getErpTerminalDeviceFields(input.terminal);
    const terminalMatches = fields.terminalId === input.expectedTerminalId
        || fields.erpTerminalId === input.expectedTerminalId;
    const deviceIdMatches = sameDeviceId(fields.deviceId, input.expectedDeviceId);
    const authorizedMatches = sameDeviceId(fields.authorizedDeviceId, input.expectedDeviceId);
    const currentMatches = sameDeviceId(fields.currentDeviceId, input.expectedDeviceId);
    const canonicalMatches = sameDeviceId(fields.canonicalDeviceId, input.expectedDeviceId);
    const pairingNotRequired = (fields.pairingStatus || '').toUpperCase() === 'NOT_REQUIRED';
    const tokenConfirmed = input.deviceTokenIssued
        || Boolean(input.tokenPreview)
        || Boolean(fields.tokenFingerprint)
        || Boolean(fields.tokenIssuedAt)
        || fields.hasRuntimeToken
        || ['ROTATED', 'ISSUED', 'ACTIVE'].includes((input.deviceTokenStatus || '').toUpperCase());

    const confirmed = Boolean(
        terminalMatches
        && deviceIdMatches
        && authorizedMatches
        && currentMatches
        && canonicalMatches
        && pairingNotRequired
        && tokenConfirmed
    );

    let status = confirmed ? 'REAUTH_COMPLETED' : 'WAITING_ERP_CONFIRMATION';
    if (!input.terminal || !terminalMatches) status = 'ERP_REPAIR_FAILED';
    else if (
        (fields.deviceId && !deviceIdMatches)
        || (fields.authorizedDeviceId && !authorizedMatches)
        || (fields.currentDeviceId && !currentMatches)
        || (fields.canonicalDeviceId && !canonicalMatches)
    ) {
        status = 'BOUND_AUTH_MISMATCH';
    }

    return {
        confirmed,
        status,
        checks: {
            terminalMatches,
            deviceIdMatches,
            authorizedMatches,
            currentMatches,
            canonicalMatches,
            pairingNotRequired,
            tokenConfirmed,
            fields,
        },
    };
}

async function loadCanonicalErpTerminal(
    supabase: ReturnType<typeof createClient>,
    terminalId: string,
) {
    const { data, error } = await supabase
        .schema('public')
        .from('erp_terminals')
        .select('id,name,store_id,device_id,config,last_seen,created_at')
        .eq('id', terminalId)
        .maybeSingle();
    if (error) throw error;
    return data as ErpTerminalRecord | null;
}

async function preservePublicTerminalCatalog(
    supabase: ReturnType<typeof createClient>,
    tenant: TenantRecord,
    terminal: ErpTerminalRecord | null,
    fallbackTerminalName?: string | null,
) {
    if (!terminal?.id || !terminal.store_id) {
        return { preserved: false, reason: terminal?.id ? 'missing_store_id' : 'missing_erp_terminal' };
    }

    const config = asRecord(terminal.config);
    const metadata = getRecordChild(config, 'metadata');
    const runtime = getRecordChild(config, 'runtime');
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
    const tenantName = getTextCandidate(tenant.name, tenant.id) || tenant.id;
    const tenantCode = buildCatalogCode(getTextCandidate(tenant.slug, tenantName), tenant.id.slice(0, 8).toUpperCase());
    const storeName = getTextCandidate(metadata.store_name, metadata.storeName, config.store_name, config.storeName, tenantName) || tenantName;

    const { error: tenantError } = await supabase
        .schema('public')
        .from('tenants')
        .upsert({
            id: tenant.id,
            code: tenantCode,
            name: tenantName,
            is_active: true,
        }, { onConflict: 'id' });
    if (tenantError) throw tenantError;

    const { error: storeError } = await supabase
        .schema('public')
        .from('stores')
        .upsert({
            id: terminal.store_id,
            tenant_id: tenant.id,
            code: 'MAIN',
            name: storeName,
            timezone: 'America/Santo_Domingo',
            is_active: true,
        }, { onConflict: 'id' });
    if (storeError) throw storeError;

    const { error: terminalError } = await supabase
        .schema('public')
        .from('terminals')
        .upsert({
            id: terminal.id,
            tenant_id: tenant.id,
            store_id: terminal.store_id,
            code: terminalCode,
            terminal_type: 'POS',
            platform: 'ANDROID',
            app_version: getTextCandidate(config.app_version, config.appVersion, runtime.appVersion),
            last_heartbeat_at: new Date().toISOString(),
            is_active: true,
        }, { onConflict: 'id' });
    if (terminalError) throw terminalError;

    return { preserved: true, terminal_id: terminal.id, terminal_code: terminalCode, store_id: terminal.store_id };
}

async function reactivatePublicTenantCatalog(
    supabase: ReturnType<typeof createClient>,
    tenant: TenantRecord,
) {
    const tenantName = getTextCandidate(tenant.name, tenant.id) || tenant.id;
    const tenantCode = buildCatalogCode(getTextCandidate(tenant.slug, tenantName), tenant.id.slice(0, 8).toUpperCase());
    const { error } = await supabase
        .schema('public')
        .from('tenants')
        .upsert({
            id: tenant.id,
            code: tenantCode,
            name: tenantName,
            is_active: true,
        }, { onConflict: 'id' });
    if (error) throw error;
}

async function resolveErpTenantId(
    supabase: ReturnType<typeof createClient>,
    cloudTenantId: string,
) {
    const { data: directMatch, error: directError } = await supabase
        .schema('public')
        .from('erp_tenants')
        .select('id')
        .eq('id', cloudTenantId)
        .maybeSingle();
    if (directError) console.error('Failed to resolve ERP tenant by id', directError);
    if (directMatch) return (directMatch as ErpTenantRecord).id;

    for (const key of ['cloudAdminTenantId', 'cloud_admin_tenant_id', 'cloudTenantId', 'cloud_tenant_id']) {
        const { data, error } = await supabase
            .schema('public')
            .from('erp_tenants')
            .select('id')
            .filter(`config->>${key}`, 'eq', cloudTenantId)
            .maybeSingle();
        if (error) {
            console.error(`Failed to resolve ERP tenant by ${key}`, error);
            continue;
        }
        if (data) return (data as ErpTenantRecord).id;
    }

    return cloudTenantId;
}

function getCloudAdminTenantIdFromErpConfig(config: Record<string, unknown> | null | undefined) {
    if (!config) return null;
    for (const key of ['cloudAdminTenantId', 'cloud_admin_tenant_id', 'cloudTenantId', 'cloud_tenant_id']) {
        const value = config[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

async function resolveCloudTenantForDeviceAuthorization(
    supabase: ReturnType<typeof createClient>,
    requestedTenantId: string,
) {
    const { data: directTenant, error: directTenantError } = await supabase
        .from('tenants')
        .select('id')
        .eq('id', requestedTenantId)
        .maybeSingle();
    if (directTenantError) throw directTenantError;
    if (directTenant?.id) {
        return {
            tenantId: requestedTenantId,
            erpTenantId: await resolveErpTenantId(supabase, requestedTenantId),
            source: 'landlord_tenant_id',
        };
    }

    const { data: erpTenantData, error: erpTenantError } = await supabase
        .schema('public')
        .from('erp_tenants')
        .select('id,config')
        .eq('id', requestedTenantId)
        .maybeSingle();
    if (erpTenantError) throw erpTenantError;

    const erpTenant = erpTenantData as ErpTenantRecord | null;
    if (!erpTenant?.id) {
        return {
            tenantId: null,
            erpTenantId: null,
            source: 'not_found',
        };
    }

    const cloudAdminTenantId = getCloudAdminTenantIdFromErpConfig(erpTenant.config);
    if (!cloudAdminTenantId) {
        return {
            tenantId: null,
            erpTenantId: erpTenant.id,
            source: 'erp_tenant_without_cloud_mapping',
        };
    }

    const { data: mappedTenant, error: mappedTenantError } = await supabase
        .from('tenants')
        .select('id')
        .eq('id', cloudAdminTenantId)
        .maybeSingle();
    if (mappedTenantError) throw mappedTenantError;
    if (!mappedTenant?.id) {
        return {
            tenantId: null,
            erpTenantId: erpTenant.id,
            source: 'erp_tenant_cloud_mapping_not_found',
        };
    }

    return {
        tenantId: mappedTenant.id,
        erpTenantId: erpTenant.id,
        source: 'erp_tenant_cloud_mapping',
    };
}

async function insertDeviceAudit(
    supabase: ReturnType<typeof createClient>,
    payload: {
        tenant_id: string;
        terminal_id: string;
        terminal_name?: string | null;
        old_device_id?: string | null;
        new_device_id?: string | null;
        action: DeviceAction;
        performed_by?: string | null;
        reason?: string | null;
        result?: string | null;
        erp_response_status?: number | null;
        erp_error_code?: string | null;
        metadata?: Record<string, unknown>;
    },
) {
    const { error } = await supabase.from('terminal_device_audit').insert({
        tenant_id: payload.tenant_id,
        terminal_id: payload.terminal_id,
        terminal_name: payload.terminal_name || null,
        old_device_id: payload.old_device_id || null,
        new_device_id: payload.new_device_id || null,
        action: payload.action,
        performed_by: payload.performed_by || null,
        reason: payload.reason || null,
        result: payload.result || null,
        erp_response_status: payload.erp_response_status || null,
        erp_error_code: payload.erp_error_code || null,
        metadata: payload.metadata || {},
    });

    if (error) {
        console.error('Failed to write terminal device audit', error);
    }
}

async function loadRegistry(
    supabase: ReturnType<typeof createClient>,
    tenantId: string,
    terminalId: string,
    registryId: string | null,
) {
    if (registryId) {
        const { data, error } = await supabase
            .from('tenant_server_registry')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('id', registryId)
            .maybeSingle();
        if (error) throw error;
        if (data) return data as RegistryRecord;
    }

    const { data, error } = await supabase
        .from('tenant_server_registry')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('terminal_id', terminalId)
        .order('last_seen_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data as RegistryRecord | null;
}

async function archiveDuplicateRegistriesForTerminal(
    supabase: ReturnType<typeof createClient>,
    tenantId: string,
    terminalId: string,
    terminalCode: string | null,
    keepRegistryId: string | null | undefined,
    previousDeviceId: string | null | undefined,
) {
    const { data, error } = await supabase
        .from('tenant_server_registry')
        .select('id,terminal_id,terminal_name,device_id,current_device_id,authorized_device_id')
        .eq('tenant_id', tenantId);
    if (error) throw error;

    const rows = (Array.isArray(data) ? data as RegistryRecord[] : []).filter((row) => {
        if (!row.id || row.id === keepRegistryId) return false;
        const rowTerminalId = row.terminal_id?.trim() || '';
        const rowTerminalName = row.terminal_name?.trim() || '';
        return rowTerminalId === terminalId
            || Boolean(terminalCode && rowTerminalId.toUpperCase() === terminalCode.toUpperCase())
            || Boolean(terminalCode && rowTerminalName.toUpperCase() === terminalCode.toUpperCase());
    });

    const ids = rows.map((row) => row.id).filter(Boolean);
    if (ids.length === 0) return [];

    const archivedAt = new Date().toISOString();
    const { error: updateError } = await supabase
        .from('tenant_server_registry')
        .update({
            status: 'OFFLINE',
            auth_status: 'OLD_DEVICE_REVOKED',
            is_revoked: true,
            revocation_reason: 'POS_ERP_TERMINAL_TAKEOVER_SUPERSEDED',
            requires_pos_reauth: true,
            previous_device_id: previousDeviceId || null,
            updated_at: archivedAt,
        })
        .in('id', ids);
    if (updateError) throw updateError;

    return ids;
}

function isTenantDeviceUniqueConflict(error: unknown) {
    if (!error || typeof error !== 'object') return false;
    const record = error as Record<string, unknown>;
    const haystack = [
        record.code,
        record.message,
        record.details,
        record.hint,
    ].filter((value) => typeof value === 'string').join(' ');
    return haystack.includes('23505')
        || haystack.includes('idx_tenant_server_registry_tenant_device')
        || haystack.includes('tenant_server_registry_tenant_device');
}

async function persistAuthorizedRegistry(
    supabase: ReturnType<typeof createClient>,
    input: {
        tenantId: string;
        registryId?: string | null;
        terminalId: string;
        terminalCode: string | null;
        deviceId: string;
        update: Record<string, unknown>;
    },
) {
    if (input.registryId) {
        const { error } = await supabase
            .from('tenant_server_registry')
            .update(input.update)
            .eq('id', input.registryId);
        if (!error) {
            return { registryId: input.registryId, result: 'updated_existing' };
        }
        if (!isTenantDeviceUniqueConflict(error)) throw error;
    }

    const { data: existingRegistry, error: existingError } = await supabase
        .from('tenant_server_registry')
        .select('id')
        .eq('tenant_id', input.tenantId)
        .eq('device_id', input.deviceId)
        .maybeSingle();
    if (existingError) throw existingError;

    if (existingRegistry?.id) {
        const { error: updateExistingError } = await supabase
            .from('tenant_server_registry')
            .update(input.update)
            .eq('id', existingRegistry.id);
        if (updateExistingError) throw updateExistingError;

        if (input.registryId && input.registryId !== existingRegistry.id) {
            await archiveDuplicateRegistriesForTerminal(
                supabase,
                input.tenantId,
                input.terminalId,
                input.terminalCode,
                existingRegistry.id,
                input.deviceId,
            );
        }

        return {
            registryId: existingRegistry.id,
            result: input.registryId ? 'merged_existing_device_registry' : 'updated_existing_after_heartbeat_race',
        };
    }

    return { registryId: null, result: 'erp_confirmed_waiting_terminal_heartbeat' };
}

async function erpTerminalHasDependencies(
    supabase: ReturnType<typeof createClient>,
    terminalId: string,
) {
    const dependencyTables = [
        'erp_terminal_profiles',
        'erp_terminal_fiscal_allocations',
        'erp_sync_inbox',
        'erp_sync_outbox',
        'sync_inbox',
        'sync_dead_letter',
        'terminal_auth_attempts',
    ];

    for (const table of dependencyTables) {
        const { count, error } = await supabase
            .schema('public')
            .from(table)
            .select('id', { count: 'exact', head: true })
            .eq('terminal_id', terminalId);
        if (error) {
            console.error(`Failed to check terminal dependency table ${table}`, error);
            return true;
        }
        if ((count || 0) > 0) return true;
    }

    return false;
}

async function archiveOrDeleteErpTerminal(
    supabase: ReturnType<typeof createClient>,
    duplicate: ErpTerminalRecord,
    canonicalTerminalId: string,
) {
    const hasDependencies = await erpTerminalHasDependencies(supabase, duplicate.id);
    if (!hasDependencies) {
        const { error: deleteError } = await supabase
            .schema('public')
            .from('erp_terminals')
            .delete()
            .eq('id', duplicate.id);
        if (deleteError) throw deleteError;
        return { mode: 'deleted', id: duplicate.id };
    }

    const archivedDeviceId = `ARCHIVED-${duplicate.id.slice(0, 8)}`;
    const duplicateConfig = asRecord(duplicate.config);
    const duplicateMetadata = getRecordChild(duplicateConfig, 'metadata');
    const archivedConfig = {
        ...duplicateConfig,
        active: false,
        is_active: false,
        runtime: {},
        pairing: {
            ...getRecordChild(duplicateConfig, 'pairing'),
            status: 'ARCHIVED',
        },
        metadata: {
            ...duplicateMetadata,
            archived: true,
            archived_at: new Date().toISOString(),
            archived_reason: 'DUPLICATE_TERMINAL_MERGED_TO_CANONICAL',
            terminal_id: null,
            terminalId: null,
            pos_terminal_id: null,
            posTerminalId: null,
            erp_terminal_id: null,
            canonical_erp_terminal_id: canonicalTerminalId,
        },
    };
    const { error: updateError } = await supabase
        .schema('public')
        .from('erp_terminals')
        .update({
            device_id: archivedDeviceId,
            name: `ARCHIVED-${duplicate.name || 'terminal'}-${duplicate.id.slice(0, 8)}`,
            last_seen: null,
            config: archivedConfig,
        })
        .eq('id', duplicate.id);
    if (updateError) throw updateError;

    return { mode: 'archived', id: duplicate.id };
}

// Conservado solo para acciones legacy no-takeover; el flujo canónico no lo invoca.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function consolidateErpTerminalDeviceDuplicates(
    supabase: ReturnType<typeof createClient>,
    input: {
        tenantId: string;
        erpTenantId: string;
        terminalId: string;
        terminalName: string | null;
        deviceId: string;
        copyAuthToCanonical: boolean;
    },
) {
    const { data: canonicalData, error: canonicalError } = await supabase
        .schema('public')
        .from('erp_terminals')
        .select('id,name,device_id,config,last_seen,created_at')
        .eq('id', input.terminalId)
        .maybeSingle();
    if (canonicalError) throw canonicalError;
    const canonical = canonicalData as ErpTerminalRecord | null;
    if (!canonical) return { archived: [], deleted: [], copied_auth: false };

    const { data: deviceMatches, error: deviceError } = await supabase
        .schema('public')
        .from('erp_terminals')
        .select('id,name,device_id,config,last_seen,created_at')
        .eq('device_id', input.deviceId);
    if (deviceError) throw deviceError;

    const expectedTerminalName = input.terminalName || canonical.name || '';
    const { data: nameMatches, error: nameError } = expectedTerminalName
        ? await supabase
            .schema('public')
            .from('erp_terminals')
            .select('id,name,device_id,config,last_seen,created_at')
            .eq('name', expectedTerminalName)
        : { data: [], error: null };
    if (nameError) throw nameError;

    const candidates = new Map<string, ErpTerminalRecord>();
    for (const row of [...(deviceMatches || []), ...(nameMatches || [])] as ErpTerminalRecord[]) {
        if (!row.id || row.id === input.terminalId) continue;
        const config = asRecord(row.config);
        const metadata = getRecordChild(config, 'metadata');
        const rowCanonicalId = String(metadata.erp_terminal_id || metadata.canonical_erp_terminal_id || '');
        const rowCloudTenantId = String(metadata.cloud_admin_tenant_id || metadata.cloudAdminTenantId || '');
        const rowName = (row.name || '').trim().toUpperCase();
        const expectedName = (input.terminalName || canonical.name || '').trim().toUpperCase();
        const isSameDevice = row.device_id === input.deviceId;
        const pointsToCanonical = rowCanonicalId === input.terminalId;
        const sameTenantAndName = Boolean(expectedName && rowName === expectedName && (rowCloudTenantId === input.tenantId || rowCloudTenantId === input.erpTenantId));
        const isArchived = rowName.startsWith('ARCHIVED-') || metadata.archived === true || config.active === false || config.is_active === false;
        if (isSameDevice || pointsToCanonical || sameTenantAndName || isArchived) candidates.set(row.id, row);
    }

    const duplicateRows = Array.from(candidates.values());
    const authSource = duplicateRows.find((row) => row.device_id === input.deviceId);
    const archived: string[] = [];
    const deleted: string[] = [];

    for (const duplicate of duplicateRows) {
        const result = await archiveOrDeleteErpTerminal(supabase, duplicate, input.terminalId);
        if (result.mode === 'deleted') deleted.push(result.id);
        else archived.push(result.id);
    }

    let copiedAuth = false;
    if (input.copyAuthToCanonical) {
        const sourceConfig = asRecord(authSource?.config);
        const sourceRuntime = getRecordChild(sourceConfig, 'runtime');
        const sourceSecurity = getRecordChild(sourceConfig, 'security');
        const canonicalConfig = asRecord(canonical.config);
        const canonicalMetadata = getRecordChild(canonicalConfig, 'metadata');
        const updatedConfig = {
            ...canonicalConfig,
            pairing: {
                ...getRecordChild(canonicalConfig, 'pairing'),
                status: 'NOT_REQUIRED',
            },
            metadata: {
                ...canonicalMetadata,
                erp_terminal_id: input.terminalId,
                canonical_erp_terminal_id: input.terminalId,
                cloud_admin_tenant_id: input.tenantId,
                authorizedDeviceId: input.deviceId,
                authorized_device_id: input.deviceId,
                currentDeviceId: input.deviceId,
                current_device_id: input.deviceId,
                canonicalDeviceId: input.deviceId,
                canonical_device_id: input.deviceId,
                binding_status: 'BOUND',
                ...(sourceSecurity.deviceTokenFingerprint ? { deviceTokenFingerprint: sourceSecurity.deviceTokenFingerprint } : {}),
            },
            runtime: {
                ...getRecordChild(canonicalConfig, 'runtime'),
                ...(sourceRuntime.syncAuthToken ? { syncAuthToken: sourceRuntime.syncAuthToken } : {}),
                ...(sourceRuntime.tokenExpiresAt ? { tokenExpiresAt: sourceRuntime.tokenExpiresAt } : {}),
                syncStatus: 'online',
            },
            security: {
                ...getRecordChild(canonicalConfig, 'security'),
                ...(sourceSecurity.deviceTokenFingerprint ? { deviceTokenFingerprint: sourceSecurity.deviceTokenFingerprint } : {}),
                ...(sourceSecurity.deviceTokenIssuedAt ? { deviceTokenIssuedAt: sourceSecurity.deviceTokenIssuedAt } : {}),
                ...(sourceSecurity.deviceBindingToken ? { deviceBindingToken: sourceSecurity.deviceBindingToken } : {}),
            },
        };

        const { error: canonicalUpdateError } = await supabase
            .schema('public')
            .from('erp_terminals')
            .update({
                device_id: input.deviceId,
                last_seen: new Date().toISOString(),
                config: updatedConfig,
            })
            .eq('id', input.terminalId);
        if (canonicalUpdateError) throw canonicalUpdateError;
        copiedAuth = true;
    }

    return { archived, deleted, copied_auth: copiedAuth };
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
        const supabase = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
            db: { schema: 'landlord' },
        });

        const body = await request.json().catch(() => ({})) as DeviceActionRequest;
        const requestedTenantId = body.tenant_id?.trim();
        const terminalId = body.terminal_id?.trim();
        const catalogTerminalId = body.catalog_terminal_id?.trim() || null;
        const requestedStoreId = body.store_id?.trim() || null;
        const registryId = body.registry_id?.trim() || null;
        const terminalName = body.terminal_name?.trim() || null;
        const deviceName = body.device_name?.trim() || null;
        const requestId = body.request_id?.trim() || null;
        const expectedAuthorizedDeviceId = body.expected_authorized_device_id?.trim() || null;
        const deviceId = normalizeRequiredDeviceId(body.device_id);
        const requestedAction = body.action;
        const action = requestedAction === 'GENERATE_PAIRING_CODE' ? 'TAKEOVER' : requestedAction;
        const reason = action === 'TAKEOVER'
            ? canonicalTakeoverReason
            : body.reason?.trim() || 'DEVICE_REINSTALL_OR_REPLACEMENT';
        const idempotencyKey = body.idempotency_key?.trim()
            || request.headers.get('idempotency-key')?.trim()
            || request.headers.get('x-idempotency-key')?.trim()
            || null;
        const performedBy = request.headers.get('x-actor-email')
            || request.headers.get('x-actor-user-id')
            || body.requested_by?.trim()
            || request.headers.get('x-actor-source')
            || 'cloud-admin';

        if (!requestedTenantId || !terminalId || !requestedAction) {
            return json({
                error: 'VALIDATION_ERROR',
                message: 'Selecciona tenant, terminal y accion.',
            }, 400);
        }
        if (action === 'TAKEOVER' && !idempotencyKey) {
            return json({
                error: 'IDEMPOTENCY_KEY_REQUIRED',
                message: 'La reautorización requiere una clave de idempotencia.',
            }, 400);
        }
        if (action === 'TAKEOVER' && !isUuid(terminalId)) {
            return json({
                error: 'CANONICAL_ERP_IDENTITY_REQUIRED',
                message: 'La reautorización requiere el terminal_id UUID canónico del ERP.',
            }, 409);
        }

        const tenantResolution = await resolveCloudTenantForDeviceAuthorization(supabase, requestedTenantId);
        if (!tenantResolution.tenantId) {
            logCloudAdminDeviceEvent('cloud_admin_device_authorization_tenant_rejected', {
                requested_tenant_id: requestedTenantId,
                erp_tenant_id: tenantResolution.erpTenantId,
                reason: tenantResolution.source,
                source: 'request-terminal-device-authorization',
            });
            return json({
                error: tenantResolution.source === 'not_found' ? 'TENANT_NOT_FOUND' : 'TENANT_NOT_AUTHORIZED',
                message: 'Tenant no encontrado o no autorizado para esta activacion.',
            }, tenantResolution.source === 'not_found' ? 404 : 403);
        }

        const tenantId = tenantResolution.tenantId;
        const resolvedErpTenantId = tenantResolution.erpTenantId;

        if (!['TAKEOVER', 'ROTATE_TOKEN', 'REVOKE_DEVICE', 'SYNC_AUTHORIZED_DEVICE', 'GENERATE_PAIRING_CODE', 'CLEAR_TERMINAL_DEVICES'].includes(requestedAction)) {
            return json({ error: 'INVALID_ACTION', message: 'Accion de autorizacion no soportada.' }, 400);
        }

        if (requiresRequestDeviceId(requestedAction) && !deviceId) {
            logCloudAdminDeviceEvent('cloud_admin_device_id_missing', {
                tenant_id: tenantId,
                requested_tenant_id: requestedTenantId,
                terminal_id: terminalId,
                registry_id: registryId,
                terminal_name: terminalName,
                requested_action: requestedAction,
                normalized_action: action,
                source: 'request-terminal-device-authorization',
            });
            logCloudAdminDeviceEvent('cloud_admin_erp_repair_skipped_missing_device', {
                tenant_id: tenantId,
                requested_tenant_id: requestedTenantId,
                terminal_id: terminalId,
                requested_action: requestedAction,
                reason: 'missing_request_device_id',
            });
            return json({
                error: 'DEVICE_ID_REQUIRED',
                message: 'DEVICE_ID_REQUIRED: ALFA-Admin necesita un device_id autorizado antes de llamar ALFA-RMS.',
            }, 400);
        }

        if (!body.confirm_action) {
            return json({ error: 'CONFIRMATION_REQUIRED', message: 'Confirma explicitamente la accion antes de continuar.' }, 400);
        }

        const { data: tenantData, error: tenantError } = await supabase
            .from('tenants')
            .select('id,name,slug,email,status,type,contracted_product,pos_runtime')
            .eq('id', tenantId)
            .maybeSingle();

        if (tenantError) throw tenantError;
        const tenant = tenantData as TenantRecord | null;
        if (!tenant) return json({ error: 'TENANT_NOT_FOUND', message: 'Tenant no encontrado.' }, 404);
        if (!isOperationalTenantStatus(tenant.status)) {
            return json({
                error: 'TENANT_NOT_ACTIVE',
                message: 'No se permite reautorizar si el tenant esta suspendido o inactivo.',
            }, 400);
        }
        if (!isPosTenant(tenant)) {
            return json({ error: 'LICENSE_NOT_ALLOWED', message: 'La licencia actual no permite reautorizar esta terminal.' }, 403);
        }

        const requiresCanonicalErp = tenant.contracted_product === 'POS_ERP' || tenant.type === 'full';
        let canonicalErpTerminal: ErpTerminalRecord | null = null;
        if (requiresCanonicalErp) {
            const blocked = !isUuid(terminalId)
                || !requestedStoreId
                || !isUuid(requestedStoreId);
            if (blocked) {
                return json({
                    error: 'CANONICAL_ERP_IDENTITY_REQUIRED',
                    message: 'Debe reconciliarse esta identidad con una terminal ERP antes de modificar la autorización.',
                }, 409);
            }
            canonicalErpTerminal = await loadCanonicalErpTerminal(supabase, terminalId);
            if (!canonicalErpTerminal || canonicalErpTerminal.store_id !== requestedStoreId) {
                return json({
                    error: 'ERP_TERMINAL_SCOPE_MISMATCH',
                    message: 'Debe reconciliarse esta identidad con una terminal ERP antes de modificar la autorización.',
                }, 409);
            }
            const erpTenantId = resolvedErpTenantId || await resolveErpTenantId(supabase, tenantId);
            const { data: store, error: storeError } = await supabase
                .schema('public')
                .from('erp_stores')
                .select('id,tenant_id')
                .eq('id', requestedStoreId)
                .maybeSingle();
            if (storeError) throw storeError;
            if (!erpTenantId || (store as { tenant_id?: string } | null)?.tenant_id !== erpTenantId) {
                return json({
                    error: 'ERP_STORE_TENANT_MISMATCH',
                    message: 'Debe reconciliarse esta identidad con una terminal ERP antes de modificar la autorización.',
                }, 409);
            }
        }

        await reactivatePublicTenantCatalog(supabase, tenant);

        const registry = await loadRegistry(supabase, tenantId, terminalId, registryId);
        let terminalQuery = supabase
            .schema('public')
            .from('terminals')
            .select('id,tenant_id,code,is_active')
            .eq('tenant_id', tenantId);
        terminalQuery = catalogTerminalId && isUuid(catalogTerminalId)
            ? terminalQuery.eq('id', catalogTerminalId)
            : terminalQuery.eq('code', terminalName || registry?.terminal_name || terminalId);
        const { data: terminalData, error: terminalError } = await terminalQuery
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (terminalError) throw terminalError;
        const publicTerminal = terminalData as PublicTerminalRecord | null;
        const terminalDisplayCode = publicTerminal?.code || canonicalErpTerminal?.name || terminalName || registry?.terminal_name || null;

        if (!registry && !publicTerminal && !canonicalErpTerminal) {
            return json({ error: 'TERMINAL_NOT_FOUND', message: 'Terminal no encontrada para este tenant.' }, 404);
        }

        if (action === 'CLEAR_TERMINAL_DEVICES') {
            const { data: registryRows, error: registryRowsError } = await supabase
                .from('tenant_server_registry')
                .select('id,terminal_id,device_id,current_device_id,authorized_device_id,previous_device_id,last_rejected_device_id,terminal_name,status,auth_status')
                .eq('tenant_id', tenantId)
                .order('last_seen_at', { ascending: false });
            if (registryRowsError) throw registryRowsError;

            const rows = (Array.isArray(registryRows) ? registryRows as RegistryRecord[] : []).filter((row) => {
                const rowTerminalId = row.terminal_id?.trim() || '';
                return row.id === registryId
                    || rowTerminalId === terminalId
                    || Boolean(catalogTerminalId && rowTerminalId === catalogTerminalId);
            });
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
                    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
            ));

            let count = 0;
            if (registryIds.length > 0) {
                const { error: deleteError, count: deletedCount } = await supabase
                    .from('tenant_server_registry')
                    .delete({ count: 'exact' })
                    .eq('tenant_id', tenantId)
                    .in('id', registryIds);
                if (deleteError) throw deleteError;
                count = deletedCount || 0;
            }

            const canonicalErpTerminal = await loadCanonicalErpTerminal(supabase, terminalId);
            const catalogPreserveResult = await preservePublicTerminalCatalog(
                supabase,
                tenant,
                canonicalErpTerminal,
                terminalDisplayCode,
            );
            const erpClearResult = await clearErpTerminalDeviceBindings(supabase, terminalId, null);
            const uniqueClearedDeviceIds = Array.from(new Set([
                ...clearedDeviceIds,
                ...erpClearResult.previousDeviceIds,
            ]));

            await insertDeviceAudit(supabase, {
                tenant_id: tenantId,
                terminal_id: terminalId,
                terminal_name: terminalDisplayCode,
                old_device_id: uniqueClearedDeviceIds.join(', ') || null,
                new_device_id: null,
                action: 'CLEAR_TERMINAL_DEVICES',
                performed_by: performedBy,
                reason,
                result: 'SUCCESS',
                metadata: {
                    registry_ids: registryIds,
                    cleared_registry_count: count || 0,
                    cleared_device_ids: uniqueClearedDeviceIds,
                    erp_terminal_cleared: erpClearResult.cleared,
                    erp_terminal_ids: erpClearResult.erpTerminalIds,
                    public_terminal_preserved: Boolean(publicTerminal?.id) || catalogPreserveResult.preserved,
                    public_catalog_preserve_result: catalogPreserveResult,
                    action_result: 'duplicate_ignored',
                    preserved: [
                        'public.terminals row',
                        'sales',
                        'items',
                        'customers',
                        'taxes',
                        'fiscal config',
                        'document sequences',
                    ],
                },
            });

            return json({
                status: 'success',
                success: true,
                action: 'terminal_devices_cleared',
                cleared_registry_count: count || 0,
                cleared_device_ids: uniqueClearedDeviceIds,
                erp_terminal_cleared: erpClearResult.cleared,
                message: 'Devices de la terminal limpiados. La terminal conserva su configuracion y puede vincularse nuevamente.',
            });
        }

        if (publicTerminal && publicTerminal.is_active === false) {
            return json({ error: 'TERMINAL_DISABLED', message: 'No se permite takeover si la terminal esta desactivada.' }, 400);
        }

        const persistedAuthorizedDeviceId = registry?.authorized_device_id?.trim() || null;
        const effectiveAuthorizedDeviceId = persistedAuthorizedDeviceId
            || registry?.current_device_id?.trim()
            || registry?.device_id?.trim()
            || null;
        const effectiveDeviceId = deviceId || (action === 'REVOKE_DEVICE' ? effectiveAuthorizedDeviceId : null);
        if (!effectiveDeviceId) {
            logCloudAdminDeviceEvent('cloud_admin_device_id_missing', {
                tenant_id: tenantId,
                terminal_id: terminalId,
                registry_id: registry?.id || registryId,
                terminal_name: terminalDisplayCode,
                requested_action: requestedAction,
                normalized_action: action,
                persisted_authorized_device_id: persistedAuthorizedDeviceId,
                registry_device_id: registry?.device_id || null,
                registry_current_device_id: registry?.current_device_id || null,
            });
            logCloudAdminDeviceEvent('cloud_admin_erp_repair_skipped_missing_device', {
                tenant_id: tenantId,
                terminal_id: terminalId,
                registry_id: registry?.id || registryId,
                requested_action: requestedAction,
                reason: 'missing_effective_device_id',
            });
            await insertDeviceAudit(supabase, {
                tenant_id: tenantId,
                terminal_id: terminalId,
                terminal_name: terminalDisplayCode,
                old_device_id: effectiveAuthorizedDeviceId,
                new_device_id: null,
                action,
                performed_by: performedBy,
                reason,
                result: 'FAILED',
                erp_error_code: 'DEVICE_ID_REQUIRED',
                metadata: {
                    log: 'cloud_admin_erp_repair_skipped_missing_device',
                    requested_action: requestedAction,
                    registry_id: registry?.id || registryId,
                    missing: 'effective_device_id',
                    no_erp_call: true,
                },
            });
            return json({
                error: 'DEVICE_ID_REQUIRED',
                message: 'DEVICE_ID_REQUIRED: La terminal no tiene device_id autorizado para ejecutar esta accion.',
            }, 400);
        }

        const alreadyAuthorizedDevice = action === 'TAKEOVER' && sameDeviceId(effectiveAuthorizedDeviceId, effectiveDeviceId);
        const previousDeviceId = action === 'TAKEOVER'
            ? effectiveAuthorizedDeviceId
            : registry?.previous_device_id || effectiveAuthorizedDeviceId;

        if (action === 'SYNC_AUTHORIZED_DEVICE') {
            if (tenant.contracted_product !== 'POS_ONLY') {
                return json({
                    error: 'INVALID_ACTION',
                    message: 'Sincronizar device autorizado solo aplica a tenants POS_ONLY.',
                }, 400);
            }
            if (!registry?.id) {
                return json({ error: 'REGISTRY_NOT_FOUND', message: 'No hay registro de servidor para sincronizar.' }, 404);
            }
            const registryDeviceId = registry.device_id?.trim() || registry.current_device_id?.trim() || null;
            if (!registryDeviceId || registryDeviceId !== deviceId) {
                return json({
                    error: 'DEVICE_MISMATCH',
                    message: 'El device solicitado no coincide con el registro online de la terminal.',
                }, 409);
            }
            if (persistedAuthorizedDeviceId === deviceId) {
                return json({
                    status: 'success',
                    success: true,
                    action: 'authorized_device_already_synced',
                    authorized_device_id: deviceId,
                    message: 'El device autorizado ya estaba persistido en ALFA-Admin.',
                });
            }

            const completedAt = new Date().toISOString();
            const { error: syncError } = await supabase
                .from('tenant_server_registry')
                .update({
                    authorized_device_id: deviceId,
                    current_device_id: deviceId,
                    auth_status: 'AUTHORIZED',
                    last_auth_error: null,
                    last_auth_attempt_at: completedAt,
                    requires_pos_reauth: false,
                    updated_at: completedAt,
                })
                .eq('id', registry.id);
            if (syncError) throw syncError;

            logCloudAdminDeviceEvent('cloud_admin_authorized_device_persisted', {
                tenant_id: tenantId,
                terminal_id: terminalId,
                registry_id: registry.id,
                device_id: deviceId,
                action: 'SYNC_AUTHORIZED_DEVICE',
            });

            await insertDeviceAudit(supabase, {
                tenant_id: tenantId,
                terminal_id: terminalId,
                terminal_name: terminalName || registry.terminal_name || publicTerminal?.code || null,
                old_device_id: persistedAuthorizedDeviceId,
                new_device_id: deviceId,
                action: 'SYNC_AUTHORIZED_DEVICE',
                performed_by: performedBy,
                reason,
                result: 'SUCCESS',
                metadata: {
                    registry_id: registry.id,
                    local_registry_only: true,
                },
            });

            return json({
                status: 'success',
                success: true,
                action: 'authorized_device_synced',
                authorized_device_id: deviceId,
                message: 'Device autorizado persistido en ALFA-Admin. El POS puede reintentar conexión.',
            });
        }

        if (action === 'ROTATE_TOKEN' && effectiveAuthorizedDeviceId && effectiveAuthorizedDeviceId !== effectiveDeviceId) {
            return json({
                error: 'DEVICE_NOT_AUTHORIZED',
                message: 'Solo puedes rotar credenciales del device autorizado actual.',
            }, 409);
        }

        const erpTenantId = action === 'TAKEOVER' || action === 'ROTATE_TOKEN'
            ? resolvedErpTenantId || await resolveErpTenantId(supabase, tenantId)
            : null;
        // El takeover pertenece exclusivamente al ERP. ALFA-Admin no corrige ni
        // reasigna filas de erp_terminals antes de recibir una confirmación canónica.
        const preErpConsolidation = { archived: [], deleted: [], copied_auth: false };

        await insertDeviceAudit(supabase, {
            tenant_id: tenantId,
            terminal_id: terminalId,
            terminal_name: terminalName || registry?.terminal_name || publicTerminal?.code || null,
            old_device_id: previousDeviceId,
            new_device_id: action === 'REVOKE_DEVICE' ? effectiveAuthorizedDeviceId : effectiveDeviceId,
            action,
            performed_by: performedBy,
            reason,
            result: 'REQUESTED',
            metadata: {
                registry_id: registry?.id || null,
                source: 'cloud-admin',
                codeless_authorization: true,
                requested_action: requestedAction,
                pre_erp_consolidation: preErpConsolidation,
                already_authorized_device: alreadyAuthorizedDevice,
                operation_id: idempotencyKey,
            },
        });
        if (action === 'TAKEOVER') {
            await insertDeviceAudit(supabase, {
                tenant_id: tenantId,
                terminal_id: terminalId,
                terminal_name: terminalName || registry?.terminal_name || publicTerminal?.code || null,
                old_device_id: previousDeviceId,
                new_device_id: deviceId,
                action: 'CLOUD_ADMIN_REPAIR_REQUESTED',
                performed_by: performedBy,
                reason,
                result: 'REQUESTED',
                metadata: {
                    registry_id: registry?.id || null,
                    canonical_erp_terminal_id: terminalId,
                    already_authorized_device: alreadyAuthorizedDevice,
                    requested_action: requestedAction,
                    operation_id: idempotencyKey,
                },
            });
        }

        if (action === 'REVOKE_DEVICE') {
            const revokedAt = new Date().toISOString();
            if (registry?.id && sameDeviceId(registry.device_id || registry.current_device_id || registry.authorized_device_id, effectiveDeviceId)) {
                const { error: revokeError } = await supabase
                    .from('tenant_server_registry')
                    .update({
                        auth_status: 'OLD_DEVICE_REVOKED',
                        is_revoked: true,
                        revocation_reason: 'MANUAL_REVOKE_DEVICE',
                        requires_pos_reauth: true,
                        updated_at: revokedAt,
                    })
                    .eq('id', registry.id);
                if (revokeError) throw revokeError;
            }

            await insertDeviceAudit(supabase, {
                tenant_id: tenantId,
                terminal_id: terminalId,
                terminal_name: terminalName || registry?.terminal_name || publicTerminal?.code || null,
                old_device_id: effectiveDeviceId,
                new_device_id: effectiveAuthorizedDeviceId,
                action,
                performed_by: performedBy,
                reason,
                result: 'SUCCESS',
                metadata: {
                    registry_id: registry?.id || null,
                    local_registry_only: true,
                },
            });

            return json({
                status: 'success',
                success: true,
                action: 'device_revoked',
                revoked_device_id: effectiveDeviceId,
                authorized_device_id: effectiveAuthorizedDeviceId,
                message: 'Equipo anterior marcado como revocado en ALFA-Admin.',
            });
        }

        const canonicalErpTerminalId = terminalId;
        const cloudAdminTenantId = tenantId;
        const erpPayloadBody: Record<string, unknown> = {
            terminalId,
            terminal_id: terminalId,
            erpTerminalId: canonicalErpTerminalId,
            erp_terminal_id: canonicalErpTerminalId,
            terminalName: terminalName || registry?.terminal_name || publicTerminal?.code || null,
            terminal_name: terminalName || registry?.terminal_name || publicTerminal?.code || null,
            deviceName,
            device_name: deviceName,
            deviceId: effectiveDeviceId,
            device_id: effectiveDeviceId,
            requestId,
            request_id: requestId,
            expectedAuthorizedDeviceId,
            expected_authorized_device_id: expectedAuthorizedDeviceId,
            tenantId: erpTenantId || tenantId,
            tenant_id: erpTenantId || tenantId,
            erpTenantId,
            erp_tenant_id: erpTenantId,
            cloudAdminTenantId,
            cloud_admin_tenant_id: cloudAdminTenantId,
            rotateDeviceToken: true,
            rotate_device_token: true,
            takeover: action === 'TAKEOVER',
            reason: action === 'ROTATE_TOKEN'
                ? 'TOKEN_ROTATION_REQUIRED'
                : reason,
            performedBy,
            requested_by: performedBy,
            idempotency_key: idempotencyKey,
        };

        logCloudAdminDeviceEvent('cloud_admin_device_authorization_started', {
            tenant_id: tenantId,
            erp_tenant_id: erpTenantId,
            cloud_admin_tenant_id: cloudAdminTenantId,
            terminal_id: terminalId,
            erp_terminal_id: canonicalErpTerminalId,
            device_id: effectiveDeviceId,
            registry_id: registry?.id || null,
            action,
            requested_action: requestedAction,
        });
        logCloudAdminDeviceEvent('cloud_admin_erp_repair_payload', {
            tenant_id: tenantId,
            erp_tenant_id: erpTenantId,
            cloud_admin_tenant_id: cloudAdminTenantId,
            terminal_id: terminalId,
            erp_terminal_id: canonicalErpTerminalId,
            device_id: effectiveDeviceId,
            action,
            has_device_id: Boolean(effectiveDeviceId),
        });

        const erpApiUrl = getEnv('ERP_API_URL', 'CLOUD_ADMIN_ERP_API_URL');
        const erpServiceToken = getEnv('ERP_TAKEOVER_SERVICE_TOKEN', 'ERP_SERVICE_TOKEN', 'CLOUD_ADMIN_ERP_SERVICE_TOKEN');
        const terminalPathId = encodeURIComponent(terminalId);
        const canonicalErpPath = `/api/settings/terminals/${terminalPathId}/takeover`;
        const erpRequestInit = {
            method: 'POST',
            signal: AbortSignal.timeout(15_000),
            headers: {
                Authorization: `Bearer ${erpServiceToken}`,
                'Content-Type': 'application/json',
                'X-Tenant-Id': erpTenantId || tenantId,
                'X-Cloud-Admin-Tenant-Id': tenantId,
                'Idempotency-Key': idempotencyKey || '',
            },
            body: JSON.stringify({
                ...erpPayloadBody,
                cloudAdminTenantId,
                cloud_admin_tenant_id: cloudAdminTenantId,
                erpTenantId,
                erp_tenant_id: erpTenantId,
            }),
        };
        let erpResponse: Response;
        try {
            erpResponse = await fetch(`${erpApiUrl.replace(/\/$/, '')}${canonicalErpPath}`, erpRequestInit);
        } catch (error) {
            let reconciliation: Record<string, unknown> = { checked: false };
            try {
                const state = await fetchCanonicalTerminalState(
                    erpApiUrl,
                    erpServiceToken,
                    erpTenantId || tenantId,
                    terminalId,
                );
                reconciliation = {
                    checked: true,
                    status: state.response.status,
                    payload: sanitizePayload(state.payload),
                };
            } catch (reconciliationError) {
                reconciliation = { checked: false, error: getUnknownErrorMessage(reconciliationError) };
            }
            await insertDeviceAudit(supabase, {
                tenant_id: tenantId,
                terminal_id: terminalId,
                terminal_name: terminalDisplayCode,
                old_device_id: previousDeviceId,
                new_device_id: effectiveDeviceId,
                action,
                performed_by: performedBy,
                reason,
                result: 'AMBIGUOUS',
                erp_error_code: 'TAKEOVER_RESPONSE_AMBIGUOUS',
                metadata: {
                    operation_id: idempotencyKey,
                    error: getUnknownErrorMessage(error),
                    canonical_reconciliation: reconciliation,
                },
            });
            return json({
                error: 'TAKEOVER_RESPONSE_AMBIGUOUS',
                message: 'ALFA-RMS no confirmó la reautorización. Se consultó el estado canónico, pero ALFA-Admin no mostrará éxito sin confirmación completa.',
                operation_id: idempotencyKey,
                canonical_reconciliation: reconciliation,
            }, 504);
        }

        const erpPayload = await erpResponse.json().catch(async () => ({
            message: await erpResponse.text().catch(() => ''),
        }));
        const erpErrorCode = getErrorCode(erpPayload);
        // Los conflictos se devuelven al cliente; ALFA-Admin nunca libera o
        // reasigna directamente un device_id en las tablas ERP.

        if (!erpResponse.ok) {
            await insertDeviceAudit(supabase, {
                tenant_id: tenantId,
                terminal_id: terminalId,
                terminal_name: terminalName || registry?.terminal_name || publicTerminal?.code || null,
                old_device_id: previousDeviceId,
                new_device_id: effectiveDeviceId,
                action,
                performed_by: performedBy,
                reason,
                result: 'FAILED',
                erp_response_status: erpResponse.status,
                erp_error_code: erpErrorCode,
                metadata: {
                    erp_payload: sanitizePayload(erpPayload),
                },
            });

            return json({
                error: erpErrorCode || 'ERP_DEVICE_ACTION_FAILED',
                message: getErrorMessage(erpResponse.status, erpPayload),
                erp_status: erpResponse.status,
                erp_error_code: erpErrorCode,
                erp_payload: sanitizePayload(erpPayload),
            }, erpResponse.status);
        }

        const sanitizedPayload = sanitizePayload(erpPayload) as Record<string, unknown>;
        const deviceTokenIssued = hasToken(erpPayload);
        const deviceTokenStatus = typeof sanitizedPayload.deviceTokenStatus === 'string'
            ? sanitizedPayload.deviceTokenStatus
            : typeof sanitizedPayload.device_token_status === 'string'
                ? sanitizedPayload.device_token_status
                : action === 'ROTATE_TOKEN'
                    ? 'ROTATED'
                    : null;
        const tokenPreview = getTokenPreview(sanitizedPayload);
        const completedAt = new Date().toISOString();
        const newAuthorizedDeviceId = action === 'ROTATE_TOKEN' ? effectiveAuthorizedDeviceId || effectiveDeviceId : effectiveDeviceId;
        const postErpConsolidation = { archived: [], deleted: [], copied_auth: false };
        const responseConfirmation = action === 'TAKEOVER'
            ? validateCanonicalTakeoverConfirmation(sanitizedPayload, terminalId, newAuthorizedDeviceId || '')
            : null;
        let canonicalStatePayload: unknown = null;
        let canonicalStateStatus: number | null = null;
        let canonicalStateError: string | null = null;
        if (action === 'TAKEOVER') {
            try {
                const canonicalState = await fetchCanonicalTerminalState(
                    erpApiUrl,
                    erpServiceToken,
                    erpTenantId || tenantId,
                    terminalId,
                );
                canonicalStateStatus = canonicalState.response.status;
                canonicalStatePayload = sanitizePayload(canonicalState.payload);
                if (!canonicalState.response.ok) canonicalStateError = getErrorMessage(canonicalState.response.status, canonicalState.payload);
            } catch (error) {
                canonicalStateError = getUnknownErrorMessage(error);
            }
        }
        const canonicalStateFields = action === 'TAKEOVER'
            ? getCanonicalTakeoverConfirmation(canonicalStatePayload)
            : null;
        const canonicalStateConfirmed = action !== 'TAKEOVER' || Boolean(
            canonicalStateStatus
            && canonicalStateStatus >= 200
            && canonicalStateStatus < 300
            && canonicalStateFields?.terminalId === terminalId
            && canonicalStateFields.authorizedDeviceId === newAuthorizedDeviceId
        );
        const confirmedErpTerminal = action === 'ROTATE_TOKEN'
            ? await loadCanonicalErpTerminal(supabase, terminalId)
            : null;
        const erpBindingConfirmation = action === 'TAKEOVER'
            ? {
                confirmed: Boolean(responseConfirmation?.confirmed && canonicalStateConfirmed),
                status: responseConfirmation?.confirmation.authorizedDeviceId
                    && responseConfirmation.confirmation.authorizedDeviceId !== newAuthorizedDeviceId
                    ? 'BOUND_AUTH_MISMATCH'
                    : 'ERP_CONFIRMATION_AMBIGUOUS',
                checks: {
                    response: responseConfirmation,
                    canonical_state_confirmed: canonicalStateConfirmed,
                    canonical_state: canonicalStatePayload,
                    canonical_state_status: canonicalStateStatus,
                    canonical_state_error: canonicalStateError,
                },
            }
            : action === 'ROTATE_TOKEN'
                ? buildErpBindingConfirmation({
                    terminal: confirmedErpTerminal,
                    expectedTerminalId: terminalId,
                    expectedDeviceId: newAuthorizedDeviceId || '',
                    deviceTokenIssued,
                    deviceTokenStatus,
                    tokenPreview,
                })
                : { confirmed: true, status: 'AUTHORIZED', checks: {} };

        if (!erpBindingConfirmation.confirmed) {
            const failedAt = new Date().toISOString();
            if (registry?.id) {
                const { error: updateError } = await supabase
                    .from('tenant_server_registry')
                    .update({
                        terminal_id: terminalId,
                        terminal_name: terminalDisplayCode,
                        device_id: registry.device_id || newAuthorizedDeviceId,
                        current_device_id: registry.current_device_id || null,
                        authorized_device_id: registry.authorized_device_id || newAuthorizedDeviceId,
                        auth_status: erpBindingConfirmation.status,
                        last_auth_error: erpBindingConfirmation.status,
                        last_auth_attempt_at: failedAt,
                        device_token_status: deviceTokenStatus,
                        token_preview: tokenPreview,
                        requires_pos_reauth: true,
                        revocation_reason: erpBindingConfirmation.status,
                        updated_at: failedAt,
                    })
                    .eq('id', registry.id);
                if (updateError) throw updateError;
            }

            if (erpBindingConfirmation.status === 'BOUND_AUTH_MISMATCH') {
                await insertDeviceAudit(supabase, {
                    tenant_id: tenantId,
                    terminal_id: terminalId,
                    terminal_name: terminalDisplayCode,
                    old_device_id: previousDeviceId,
                    new_device_id: newAuthorizedDeviceId,
                    action: 'CLOUD_ADMIN_DEVICE_MISMATCH_DETECTED',
                    performed_by: performedBy,
                    reason: 'ERP persisted binding does not match the device requested by ALFA-Admin.',
                    result: 'FAILED',
                    erp_response_status: erpResponse.status,
                    metadata: {
                        erp_payload: sanitizedPayload,
                        erp_binding_confirmation: erpBindingConfirmation,
                    },
                });
            }

            await insertDeviceAudit(supabase, {
                tenant_id: tenantId,
                terminal_id: terminalId,
                terminal_name: terminalDisplayCode,
                old_device_id: previousDeviceId,
                new_device_id: newAuthorizedDeviceId,
                action: 'CLOUD_ADMIN_ERP_REPAIR_FAILED',
                performed_by: performedBy,
                reason: 'ERP did not confirm canonical terminal binding after the ALFA-Admin request.',
                result: 'FAILED',
                erp_response_status: erpResponse.status,
                erp_error_code: erpBindingConfirmation.status,
                metadata: {
                    erp_payload: sanitizedPayload,
                    deviceTokenIssued,
                    deviceTokenStatus,
                    tokenPreview,
                    pre_erp_consolidation: preErpConsolidation,
                    post_erp_consolidation: postErpConsolidation,
                    erp_binding_confirmation: erpBindingConfirmation,
                },
            });

            return json({
                error: erpBindingConfirmation.status,
                status: erpBindingConfirmation.status,
                success: false,
                action: action === 'ROTATE_TOKEN' ? 'terminal_token_rotation_pending' : 'terminal_erp_repair_pending',
                authorized_device_id: newAuthorizedDeviceId,
                deviceTokenIssued,
                deviceTokenStatus,
                tokenPreview,
                erp_confirmation: erpBindingConfirmation.checks,
                message: 'ALFA-RMS no confirmó que el device quedara autorizado en la terminal canónica. ALFA-Admin no marcará el takeover como completado hasta recibir confirmación.',
            }, 409);
        }
        const registryUpdate: Record<string, unknown> = {
            terminal_id: terminalId,
            terminal_name: terminalDisplayCode,
            device_id: newAuthorizedDeviceId,
            current_device_id: newAuthorizedDeviceId,
            authorized_device_id: newAuthorizedDeviceId,
            previous_device_id: action === 'TAKEOVER' && !alreadyAuthorizedDevice ? previousDeviceId : registry?.previous_device_id || null,
            last_rejected_device_id: null,
            auth_status: 'AUTHORIZED',
            last_auth_error: null,
            last_auth_attempt_at: completedAt,
            device_token_status: deviceTokenStatus,
            token_preview: tokenPreview,
            revocation_reason: action === 'TAKEOVER'
                ? alreadyAuthorizedDevice
                    ? 'ERP_DEVICE_MAPPING_REPAIR'
                    : 'DEVICE_REINSTALL_OR_REPLACEMENT'
                : null,
            requires_pos_reauth: false,
            is_revoked: false,
            status: 'ONLINE',
            updated_at: completedAt,
        };
        if (action === 'TAKEOVER') registryUpdate.last_takeover_at = completedAt;

        let registryActionResult = 'updated_existing_no_local_registry';
        let confirmedRegistryId = registry?.id || null;
        const persistedRegistry = await persistAuthorizedRegistry(supabase, {
            tenantId,
            registryId: registry?.id || null,
            terminalId,
            terminalCode: terminalDisplayCode,
            deviceId: newAuthorizedDeviceId,
            update: registryUpdate,
        });
        confirmedRegistryId = persistedRegistry.registryId;
        registryActionResult = persistedRegistry.result;
        if (confirmedRegistryId) {
            logCloudAdminDeviceEvent('cloud_admin_authorized_device_persisted', {
                tenant_id: tenantId,
                terminal_id: terminalId,
                registry_id: confirmedRegistryId,
                device_id: newAuthorizedDeviceId,
                action,
                result: registryActionResult,
            });
        }

        logCloudAdminDeviceEvent('cloud_admin_terminal_device_synced_to_erp', {
            tenant_id: tenantId,
            erp_tenant_id: erpTenantId,
            cloud_admin_tenant_id: tenantId,
            terminal_id: terminalId,
            erp_terminal_id: terminalId,
            registry_id: confirmedRegistryId,
            device_id: newAuthorizedDeviceId,
            action,
            erp_response_status: erpResponse.status,
            erp_confirmation_status: erpBindingConfirmation.status,
        });

        const archivedDuplicateRegistryIds = action === 'TAKEOVER'
            ? await archiveDuplicateRegistriesForTerminal(
                supabase,
                tenantId,
                terminalId,
                terminalDisplayCode,
                registry?.id,
                previousDeviceId,
            )
            : [];

        await insertDeviceAudit(supabase, {
            tenant_id: tenantId,
            terminal_id: terminalId,
            terminal_name: terminalDisplayCode,
            old_device_id: previousDeviceId,
            new_device_id: newAuthorizedDeviceId,
            action,
            performed_by: performedBy,
            reason,
            result: 'SUCCESS',
            erp_response_status: erpResponse.status,
            metadata: {
                erp_payload: sanitizedPayload,
                deviceTokenIssued,
                deviceTokenStatus,
                tokenPreview,
                action_result: registryActionResult,
                registry_id: confirmedRegistryId,
                codeless_authorization: true,
                pre_erp_consolidation: preErpConsolidation,
                post_erp_consolidation: postErpConsolidation,
                archived_duplicate_registry_ids: archivedDuplicateRegistryIds,
                alreadyAuthorizedDevice,
                erp_binding_confirmation: erpBindingConfirmation,
                operation_id: idempotencyKey,
                idempotency_key: idempotencyKey,
            },
        });

        await insertDeviceAudit(supabase, {
            tenant_id: tenantId,
            terminal_id: terminalId,
            terminal_name: terminalDisplayCode,
            old_device_id: previousDeviceId,
            new_device_id: newAuthorizedDeviceId,
            action: action === 'ROTATE_TOKEN' ? 'CLOUD_ADMIN_CREDENTIALS_ROTATED' : 'CLOUD_ADMIN_ERP_REPAIR_CONFIRMED',
            performed_by: performedBy,
            reason: action === 'ROTATE_TOKEN'
                ? 'ERP confirmed token rotation on canonical terminal.'
                : 'ERP confirmed canonical terminal binding after the ALFA-Admin repair.',
            result: 'SUCCESS',
            erp_response_status: erpResponse.status,
            metadata: {
                deviceTokenIssued,
                deviceTokenStatus,
                tokenPreview,
                erp_binding_confirmation: erpBindingConfirmation,
                operation_id: idempotencyKey,
            },
        });

        if (archivedDuplicateRegistryIds.length > 0) {
            await insertDeviceAudit(supabase, {
                tenant_id: tenantId,
                terminal_id: terminalId,
                terminal_name: terminalDisplayCode,
                old_device_id: previousDeviceId,
                new_device_id: newAuthorizedDeviceId,
                action: 'DUPLICATE_PREVENTED',
                performed_by: performedBy,
                reason: 'Archive duplicate registry rows after POS+ERP terminal takeover.',
                result: 'SUCCESS',
                erp_response_status: erpResponse.status,
                metadata: {
                    archived_duplicate_registry_ids: archivedDuplicateRegistryIds,
                    post_erp_consolidation: postErpConsolidation,
                    canonical_erp_terminal_id: terminalId,
                    authorized_device_id: newAuthorizedDeviceId,
                },
            });
        }

        return json({
            status: 'success',
            success: true,
            operation_id: idempotencyKey,
            request_id: getPayloadText(sanitizedPayload, 'request_id', 'requestId') || requestId,
            request_status: getPayloadText(sanitizedPayload, 'request_status', 'requestStatus', 'resolution_status', 'resolutionStatus'),
            terminal_id: terminalId,
            action: action === 'TAKEOVER'
                ? alreadyAuthorizedDevice
                    ? 'terminal_authorization_refreshed'
                    : 'terminal_takeover_completed'
                : 'terminal_token_rotated',
            previous_device_id: responseConfirmation?.confirmation.previousDeviceId || previousDeviceId,
            old_device_id: responseConfirmation?.confirmation.previousDeviceId || previousDeviceId,
            new_device_id: newAuthorizedDeviceId,
            authorized_device_id: newAuthorizedDeviceId,
            takeover_confirmed: action === 'TAKEOVER' ? true : undefined,
            previous_device_revoked: action === 'TAKEOVER' ? true : undefined,
            rotate_device_token: action === 'TAKEOVER' ? true : undefined,
            deviceTokenIssued,
            deviceTokenStatus,
            tokenPreview,
            message: action === 'TAKEOVER'
                ? alreadyAuthorizedDevice
                    ? 'Terminal revalidada correctamente en Cloud y ERP. El POS debe reintentar conexion.'
                    : 'Terminal reautorizada correctamente. El POS debe reintentar autenticacion para recibir un nuevo syncToken.'
                : 'Credenciales rotadas correctamente. El POS debe reintentar autenticacion para recibir un nuevo syncToken.',
        });
    } catch (error) {
        const message = getUnknownErrorMessage(error);
        console.error('request-terminal-device-authorization failed', {
            message,
            error: sanitizePayload(error),
        });
        return json({
            error: 'INTERNAL_ERROR',
            message,
        }, 500);
    }
});
