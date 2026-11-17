import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { CloudAdminAuthError, requireCloudAdminPermission } from "./lib/cloud-admin-session.js";

type ApiRequest = IncomingMessage & {
    body?: unknown;
    headers: IncomingHttpHeaders;
    method?: string;
};

type AuthAttemptsPayload = {
    tenant_id?: unknown;
    terminal_id?: unknown;
};

type TenantRecord = {
    id: string;
};

type AuthAttempt = {
    requested_device_id?: string | null;
    authorized_device_id?: string | null;
    device_id?: string | null;
    deviceId?: string | null;
    reason?: string | null;
    message?: string | null;
    status?: string | null;
    resolution_status?: string | null;
    attempted_at?: string | null;
    created_at?: string | null;
    metadata?: Record<string, unknown> | null;
    [key: string]: unknown;
};

const DEFAULT_ERP_BASE_URL = "https://alfa-rms.vercel.app";

const tokenKeys = new Set([
    "syncAuthToken",
    "sync_auth_token",
    "deviceToken",
    "device_token",
    "token",
    "auth_token",
    "access_token",
    "refresh_token",
]);

function setCors(response: ServerResponse) {
    response.setHeader("Access-Control-Allow-Origin", process.env.CLOUD_ADMIN_TAKEOVER_CORS_ORIGIN || "*");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Actor-User-Id, X-Actor-Email, X-Actor-Source",
    );
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
    setCors(response);
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(body));
}

function stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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

function sanitizePayload(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => sanitizePayload(item));
    if (!value || typeof value !== "object") return value;

    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (tokenKeys.has(key)) continue;
        output[key] = sanitizePayload(item);
    }
    return output;
}

function getAttemptsFromPayload(payload: unknown): unknown[] {
    if (Array.isArray(payload)) return payload;
    const record = asRecord(payload);
    if (Array.isArray(record.attempts)) return record.attempts;
    if (Array.isArray(record.data)) return record.data;
    if (Array.isArray(record.items)) return record.items;
    return [];
}

function normalizeAttempt(value: unknown, tenantId: string, terminalId: string): AuthAttempt {
    const sanitized = sanitizePayload(asRecord(value)) as Record<string, unknown>;
    const requestedDeviceId = stringValue(sanitized.requested_device_id)
        || stringValue(sanitized.request_device_id)
        || stringValue(sanitized.device_id)
        || stringValue(sanitized.deviceId)
        || stringValue(sanitized.requestedDeviceId);
    const authorizedDeviceId = stringValue(sanitized.authorized_device_id)
        || stringValue(sanitized.authorizedDeviceId);
    const resolutionStatus = stringValue(sanitized.resolution_status)
        || stringValue(sanitized.resolutionStatus)
        || stringValue(sanitized.status);
    const reason = stringValue(sanitized.reason);
    const legacyPendingInferred = resolutionStatus?.toUpperCase() === "REJECTED"
        && reason?.toUpperCase() === "DEVICE_SUPERSEDED"
        && !stringValue(sanitized.resolved_at)
        && !stringValue(sanitized.resolved_by);
    const attemptedAt = stringValue(sanitized.attempted_at)
        || stringValue(sanitized.created_at)
        || stringValue(sanitized.createdAt);

    return {
        ...sanitized,
        tenant_id: tenantId,
        terminal_id: terminalId,
        requested_device_id: requestedDeviceId,
        authorized_device_id: authorizedDeviceId,
        reason,
        resolution_status: legacyPendingInferred ? "PENDING" : resolutionStatus,
        legacy_pending_inferred: legacyPendingInferred,
        attempted_at: attemptedAt,
    };
}

function dedupePendingAttempts(attempts: AuthAttempt[]) {
    const pendingDevices = new Set<string>();
    let inferredLegacyRequestSeen = false;
    return attempts.filter((attempt) => {
        const status = (attempt.resolution_status || attempt.status || "").toUpperCase();
        const deviceId = attempt.requested_device_id?.trim().toUpperCase() || "";
        if (status !== "PENDING" || !deviceId) return true;
        if (attempt.legacy_pending_inferred === true) {
            if (inferredLegacyRequestSeen) return false;
            inferredLegacyRequestSeen = true;
        }
        if (pendingDevices.has(deviceId)) return false;
        pendingDevices.add(deviceId);
        return true;
    });
}

function getAttemptAppVersion(attempt: AuthAttempt | null) {
    if (!attempt) return null;
    const direct = stringValue(attempt.app_version) || stringValue(attempt.apk_version);
    if (direct) return direct;

    const metadata = asRecord(attempt.metadata);
    return stringValue(metadata.app_version)
        || stringValue(metadata.appVersion)
        || stringValue(metadata.apk_version)
        || stringValue(metadata.apkVersion)
        || stringValue(metadata.version);
}

function getAttemptAppVersionCode(attempt: AuthAttempt | null) {
    if (!attempt) return null;
    const metadata = asRecord(attempt.metadata);
    const candidates = [
        metadata.app_version_code,
        metadata.appVersionCode,
        metadata.apk_version_code,
        metadata.apkVersionCode,
        metadata.version_code,
        metadata.versionCode,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
        if (typeof candidate === "string" && candidate.trim()) {
            const parsed = Number(candidate.trim());
            if (Number.isFinite(parsed)) return parsed;
        }
    }

    return null;
}

function getErpAuthAttemptsErrorMessage(status: number, payload: unknown) {
    const record = asRecord(payload);
    const detail = stringValue(record.message) || stringValue(record.error);

    if (status === 404) return "El ERP no encontro intentos para esta terminal.";
    if (status === 401 || status === 403) {
        return detail && !detail.toLowerCase().includes("no tienes permiso")
            ? `ERP rechazo la consulta de intentos (HTTP ${status}): ${detail}`
            : `ERP rechazo la consulta de intentos (HTTP ${status}). Verifica el token de servicio ERP y la configuracion del tenant antes de reautorizar.`;
    }

    return detail || "No se pudieron cargar los intentos rechazados desde el ERP.";
}

async function validateTerminalTenantScope(
    admin: Awaited<ReturnType<typeof requireCloudAdminPermission>>["admin"],
    tenantId: string,
    terminalId: string,
) {
    const { data: terminal, error: terminalError } = await admin
        .schema("public")
        .from("erp_terminals")
        .select("id,store_id")
        .eq("id", terminalId)
        .maybeSingle();
    if (terminalError) throw terminalError;
    const storeId = stringValue((terminal as Record<string, unknown> | null)?.store_id);
    if (!storeId) return false;

    const { data: store, error: storeError } = await admin
        .schema("public")
        .from("erp_stores")
        .select("tenant_id")
        .eq("id", storeId)
        .maybeSingle();
    if (storeError) throw storeError;

    const { data: erpTenant, error: tenantError } = await admin
        .schema("public")
        .from("erp_tenants")
        .select("id")
        .eq("config->>cloudAdminTenantId", tenantId)
        .maybeSingle();
    if (tenantError) throw tenantError;

    return stringValue((store as Record<string, unknown> | null)?.tenant_id)
        === stringValue((erpTenant as Record<string, unknown> | null)?.id);
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
        const { admin } = await requireCloudAdminPermission(request.headers, "terminal_reauthorization");
        const body = await readBody(request) as AuthAttemptsPayload;
        const tenantId = stringValue(body.tenant_id);
        const terminalId = stringValue(body.terminal_id);

        if (!tenantId || !terminalId) {
            sendJson(response, 400, {
                error: "VALIDATION_ERROR",
                message: "Selecciona tenant y terminal para consultar intentos rechazados.",
            });
            return;
        }

        // El endpoint de intentos del ERP responde sin Bearer, así que estas
        // variables son opcionales: sin ERP_API_URL se usa el ERP de producción
        // y sin token se llama sin Authorization. Así el panel no queda muerto
        // por configuración pendiente.
        const erpApiUrl = (
            process.env.ERP_API_URL
            || process.env.CLOUD_ADMIN_ERP_API_URL
            || DEFAULT_ERP_BASE_URL
        ).replace(/\/$/, "");
        const erpServiceToken = (
            process.env.ERP_TAKEOVER_SERVICE_TOKEN
            || process.env.ERP_SERVICE_TOKEN
            || process.env.CLOUD_ADMIN_ERP_SERVICE_TOKEN
            || ""
        ).trim();

        const { data: tenantData, error: tenantError } = await admin
            .from("tenants")
            .select("id")
            .eq("id", tenantId)
            .maybeSingle();
        if (tenantError) throw tenantError;
        const tenant = tenantData as TenantRecord | null;
        if (!tenant) {
            sendJson(response, 404, { error: "TENANT_NOT_FOUND", message: "Tenant no encontrado." });
            return;
        }
        if (!await validateTerminalTenantScope(admin, tenantId, terminalId)) {
            sendJson(response, 403, {
                error: "TERMINAL_TENANT_MISMATCH",
                message: "La terminal y el tenant no pertenecen al mismo contexto ERP.",
            });
            return;
        }

        const erpResponse = await fetch(`${erpApiUrl}/api/sync/terminals/${encodeURIComponent(terminalId)}/auth-attempts`, {
            method: "GET",
            headers: {
                ...(erpServiceToken ? { Authorization: `Bearer ${erpServiceToken}` } : {}),
                "Content-Type": "application/json",
                "X-Tenant-Id": tenantId,
                "X-Cloud-Admin-Tenant-Id": tenantId,
            },
        });

        const payloadText = await erpResponse.text();
        let erpPayload: unknown = null;
        try {
            erpPayload = payloadText ? JSON.parse(payloadText) : null;
        } catch {
            erpPayload = payloadText ? { message: payloadText } : null;
        }

        if (!erpResponse.ok) {
            sendJson(response, erpResponse.status, {
                error: "ERP_AUTH_ATTEMPTS_FAILED",
                message: getErpAuthAttemptsErrorMessage(erpResponse.status, erpPayload),
                erp_status: erpResponse.status,
            });
            return;
        }

        const attempts = dedupePendingAttempts(getAttemptsFromPayload(erpPayload)
            .map((attempt) => normalizeAttempt(attempt, tenantId, terminalId))
            .filter((attempt) => attempt.requested_device_id || attempt.reason || attempt.message));

        const latestRejected = attempts.find((attempt) => {
            const status = (attempt.resolution_status || attempt.status || "").toUpperCase();
            return status === "PENDING" && Boolean(attempt.requested_device_id);
        }) || null;
        const latestWithVersion = attempts.find((attempt) => getAttemptAppVersion(attempt) || getAttemptAppVersionCode(attempt)) || null;

        if (latestRejected?.requested_device_id) {
            const appVersion = getAttemptAppVersion(latestRejected) || getAttemptAppVersion(latestWithVersion);
            const appVersionCode = getAttemptAppVersionCode(latestRejected) || getAttemptAppVersionCode(latestWithVersion);
            const registryUpdate: Record<string, unknown> = {
                last_rejected_device_id: latestRejected.requested_device_id,
                last_auth_error: latestRejected.reason || latestRejected.message || "DEVICE_NOT_AUTHORIZED",
                last_auth_attempt_at: latestRejected.attempted_at || latestRejected.created_at || new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
            if (appVersion) registryUpdate.app_version = appVersion;
            if (appVersionCode) registryUpdate.app_version_code = appVersionCode;

            const { error: updateError } = await admin
                .from("tenant_server_registry")
                .update(registryUpdate)
                .eq("tenant_id", tenantId)
                .eq("terminal_id", terminalId);

            if (updateError) {
                console.warn("terminal-auth-attempts registry update failed", updateError);
            }
        } else if (attempts.length > 0) {
            const { error: updateError } = await admin
                .from("tenant_server_registry")
                .update({
                    last_rejected_device_id: null,
                    last_auth_error: null,
                    updated_at: new Date().toISOString(),
                })
                .eq("tenant_id", tenantId)
                .eq("terminal_id", terminalId);
            if (updateError) console.warn("terminal-auth-attempts stale request cleanup failed", updateError);
        }

        sendJson(response, 200, {
            status: "success",
            attempts,
        });
    } catch (error) {
        if (error instanceof CloudAdminAuthError) {
            sendJson(response, error.status, { error: error.code, message: error.message });
            return;
        }
        console.error("terminal-auth-attempts proxy failed", error);
        sendJson(response, 500, {
            error: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Error interno consultando intentos rechazados.",
        });
    }
}
