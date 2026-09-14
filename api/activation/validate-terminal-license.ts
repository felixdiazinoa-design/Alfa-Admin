import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { resolveLandlordTenantForActivation } from "../lib/resolve-landlord-tenant.js";

type ApiRequest = IncomingMessage & {
    body?: unknown;
    headers: IncomingHttpHeaders;
    method?: string;
};

type ValidatePayload = {
    tenantId?: unknown;
    deviceId?: unknown;
    terminalId?: unknown;
    email?: unknown;
};

type LicenseRpcResult = {
    allowed?: boolean;
    reason?: string | null;
    code?: string | null;
    used_seats?: number;
    max_seats?: number;
    license_unit?: string | null;
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function setCors(response: ServerResponse) {
    response.setHeader(
        "Access-Control-Allow-Origin",
        process.env.CLOUD_ADMIN_ACTIVATION_CORS_ORIGIN
            || process.env.CLOUD_ADMIN_PROVISION_CORS_ORIGIN
            || "*",
    );
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, X-Requested-With");
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
    setCors(response);
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(body));
}

function formatUnknownError(error: unknown) {
    if (error instanceof Error) return error.message;

    if (error && typeof error === "object") {
        const payload = error as Record<string, unknown>;
        const parts = [
            payload.message,
            payload.details,
            payload.hint,
            payload.code ? `code: ${payload.code}` : undefined,
        ]
            .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
            .map((part) => part.trim());

        if (parts.length > 0) return parts.join(" · ");
        return JSON.stringify(payload);
    }

    return String(error);
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

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function normalizeEmail(value: string) {
    return value.trim().toLowerCase();
}

function extractBearerToken(request: ApiRequest) {
    const authorization = getHeader(request.headers, "authorization") ?? "";
    const bearerToken = authorization.replace(/^Bearer\s+/i, "").trim();
    return bearerToken || null;
}

function getClientIp(request: ApiRequest) {
    const forwarded = getHeader(request.headers, "x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
    return request.socket.remoteAddress || "unknown";
}

function checkRateLimit(key: string) {
    const now = Date.now();
    const entry = rateLimitStore.get(key);

    if (!entry || now > entry.resetAt) {
        rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return true;
    }

    if (entry.count >= RATE_LIMIT_MAX) return false;
    entry.count += 1;
    return true;
}

function mapLicenseResponse(result: LicenseRpcResult) {
    const allowed = result.allowed === true;
    return {
        allowed,
        licensed: allowed,
        reason: result.reason ?? null,
        code: result.code ?? null,
        used_seats: result.used_seats ?? null,
        max_seats: result.max_seats ?? null,
        license_unit: result.license_unit ?? null,
    };
}

export default async function handler(request: ApiRequest, response: ServerResponse) {
    if (request.method === "OPTIONS") {
        sendJson(response, 200, { ok: true });
        return;
    }

    if (request.method !== "POST") {
        sendJson(response, 405, {
            error: "METHOD_NOT_ALLOWED",
            message: "Use POST para validar licencias de terminal.",
        });
        return;
    }

    try {
        const bearerToken = extractBearerToken(request);
        if (!bearerToken) {
            sendJson(response, 401, {
                error: "UNAUTHORIZED",
                message: "Authorization Bearer token requerido.",
            });
            return;
        }

        const payload = await readBody(request) as ValidatePayload;
        if (!isNonEmptyString(payload.tenantId)) {
            sendJson(response, 400, {
                error: "VALIDATION_ERROR",
                message: "tenantId es requerido.",
                field: "tenantId",
            });
            return;
        }

        const tenantId = payload.tenantId.trim();
        const deviceId = isNonEmptyString(payload.deviceId) ? payload.deviceId.trim() : null;
        const terminalId = isNonEmptyString(payload.terminalId) ? payload.terminalId.trim() : null;
        const bodyEmail = isNonEmptyString(payload.email) ? normalizeEmail(payload.email) : null;

        const rateLimitKey = createHash("sha256")
            .update(`${getClientIp(request)}:${bearerToken.slice(0, 24)}`)
            .digest("hex");

        if (!checkRateLimit(rateLimitKey)) {
            sendJson(response, 429, {
                error: "RATE_LIMITED",
                message: "Demasiadas solicitudes de validacion de licencia.",
            });
            return;
        }

        const supabaseUrl = getEnv("SUPABASE_URL", "VITE_SUPABASE_URL");
        const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

        const supabaseLandlord = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
            db: { schema: "landlord" },
        });
        const supabaseService = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        });

        const { data: authData, error: authError } = await supabaseService.auth.getUser(bearerToken);
        if (authError || !authData.user) {
            sendJson(response, 401, {
                error: "UNAUTHORIZED",
                message: "Token de activacion invalido o expirado.",
            });
            return;
        }

        const resolved = await resolveLandlordTenantForActivation(
            supabaseLandlord,
            supabaseService,
            {
                requestedTenantId: tenantId,
                user: authData.user,
                bodyEmail,
            },
        );

        if (!resolved.tenant || !resolved.effectiveTenantId) {
            console.warn("[validate-terminal-license] tenant resolution failed", {
                requestedTenantId: tenantId,
                userId: authData.user.id,
                reason: resolved.mismatchReason,
            });
            sendJson(response, 403, {
                error: "FORBIDDEN",
                message: "Tenant no encontrado o no autorizado.",
            });
            return;
        }

        const effectiveTenantId = resolved.effectiveTenantId;

        const { data: licenseData, error: licenseError } = await supabaseService.rpc(
            "validate_terminal_activation_license",
            {
                p_tenant_id: effectiveTenantId,
                p_device_id: deviceId,
                p_terminal_id: terminalId,
            },
        );

        if (licenseError) {
            if (formatUnknownError(licenseError).includes("tenant_id is required")) {
                sendJson(response, 400, {
                    error: "VALIDATION_ERROR",
                    message: "tenantId es requerido.",
                    field: "tenantId",
                });
                return;
            }

            throw licenseError;
        }

        const licenseResult = (licenseData ?? {}) as LicenseRpcResult;
        const responseBody = mapLicenseResponse(licenseResult);

        if (!responseBody.allowed) {
            console.warn("[validate-terminal-license] blocked", {
                tenantId: effectiveTenantId,
                requestedTenantId: tenantId,
                metadataRepaired: resolved.metadataRepaired,
                deviceId,
                code: responseBody.code,
                used_seats: responseBody.used_seats,
                max_seats: responseBody.max_seats,
            });
        }

        sendJson(response, 200, responseBody);
    } catch (error) {
        console.error("validate-terminal-license failed", error);

        if (error instanceof SyntaxError) {
            sendJson(response, 400, {
                error: "VALIDATION_ERROR",
                message: "JSON invalido.",
            });
            return;
        }

        if (formatUnknownError(error).includes("validate_terminal_activation_license")) {
            sendJson(response, 501, {
                error: "NOT_IMPLEMENTED",
                message: "Validacion de licencias de terminal no desplegada en este entorno.",
            });
            return;
        }

        sendJson(response, 500, {
            error: "INTERNAL_ERROR",
            message: "No se pudo validar la licencia de terminal.",
            detail: formatUnknownError(error),
        });
    }
}
