import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

type ApiRequest = IncomingMessage & {
    body?: unknown;
    headers: IncomingHttpHeaders;
    method?: string;
};

type ActivationPayload = {
    tenant_id?: unknown;
    company_ref?: unknown;
    email?: unknown;
};

function setCors(response: ServerResponse) {
    response.setHeader("Access-Control-Allow-Origin", process.env.CLOUD_ADMIN_PROVISION_CORS_ORIGIN || "*");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
    setCors(response);
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(body));
}

function getEnv(...names: string[]) {
    for (const name of names) {
        const value = process.env[name]?.trim();
        if (value) return value;
    }
    throw new Error(`Missing required environment variable: ${names.join(" or ")}`);
}

function getHeader(headers: IncomingHttpHeaders, name: string) {
    const value = headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
}

function extractBearerToken(request: ApiRequest) {
    const authorization = getHeader(request.headers, "authorization") ?? "";
    return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;
}

function tokensMatch(received: string, expected: string) {
    const receivedBuffer = Buffer.from(received, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    return receivedBuffer.length === expectedBuffer.length
        && timingSafeEqual(receivedBuffer, expectedBuffer);
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

function optionalString(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeSlug(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
}

const TENANT_COLUMNS = [
    "id",
    "name",
    "legal_name",
    "tax_id",
    "slug",
    "email",
    "status",
    "type",
    "contracted_product",
    "erp_ui_enabled",
    "customer_erp_access",
    "cloud_channel",
    "max_pos_terminals",
    "max_erp_users",
].join(",");

export default async function handler(request: ApiRequest, response: ServerResponse) {
    if (request.method === "OPTIONS") {
        sendJson(response, 200, { ok: true });
        return;
    }

    if (request.method !== "POST") {
        sendJson(response, 405, {
            status: "error",
            code: "METHOD_NOT_ALLOWED",
            message: "Use POST para validar activaciones.",
        });
        return;
    }

    let expectedToken: string;
    try {
        expectedToken = getEnv("CLOUD_ADMIN_PROVISION_TOKEN");
    } catch {
        sendJson(response, 503, {
            status: "error",
            code: "ACTIVATION_AUTH_NOT_CONFIGURED",
            message: "La validación servidor-a-servidor no está configurada.",
        });
        return;
    }

    const bearerToken = extractBearerToken(request);
    if (!bearerToken || !tokensMatch(bearerToken, expectedToken)) {
        sendJson(response, 401, {
            status: "error",
            code: "UNAUTHORIZED",
            message: "Credencial de validación inválida.",
        });
        return;
    }

    try {
        const payload = await readBody(request) as ActivationPayload;
        const tenantId = optionalString(payload.tenant_id);
        const companyRef = optionalString(payload.company_ref);
        const email = optionalString(payload.email)?.toLowerCase() || null;

        if (!tenantId && !companyRef && !email) {
            sendJson(response, 400, {
                status: "error",
                code: "VALIDATION_ERROR",
                message: "Debe indicar tenant_id, company_ref o email.",
            });
            return;
        }

        const supabase = createClient(
            getEnv("SUPABASE_URL", "VITE_SUPABASE_URL"),
            getEnv("SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_SERVICE_ROLE_KEY"),
            {
                auth: { autoRefreshToken: false, persistSession: false },
                db: { schema: "landlord" },
            },
        );

        const lookups = [
            tenantId ? ["id", tenantId] : null,
            companyRef ? ["slug", normalizeSlug(companyRef)] : null,
            email ? ["email", email] : null,
        ].filter((lookup): lookup is [string, string] => Boolean(lookup?.[1]));

        let tenant: Record<string, unknown> | null = null;
        for (const [column, value] of lookups) {
            const { data, error } = await supabase
                .from("tenants")
                .select(TENANT_COLUMNS)
                .eq(column, value)
                .limit(1)
                .maybeSingle();
            if (error) throw error;
            if (data) {
                tenant = data as Record<string, unknown>;
                break;
            }
        }

        if (!tenant) {
            sendJson(response, 404, {
                status: "error",
                code: "TENANT_NOT_FOUND",
                message: "No se encontró el tenant en ALFA-Admin.",
            });
            return;
        }

        const tenantStatus = String(tenant.status || "ACTIVE").toUpperCase();
        const contractedProduct = String(tenant.contracted_product || "POS_ERP").toUpperCase();
        const erpEnabled = contractedProduct !== "POS_ONLY"
            && tenant.erp_ui_enabled !== false
            && tenant.customer_erp_access !== false;
        const active = tenantStatus === "ACTIVE" || tenantStatus === "TRIAL";

        sendJson(response, 200, {
            status: "success",
            tenant,
            activation: {
                cloud_admin_tenant_id: tenant.id,
                tenant_id: tenant.id,
                tenant_name: tenant.name,
                legal_name: tenant.legal_name,
                company_ref: tenant.slug,
                contracted_product: contractedProduct,
                erp_enabled: erpEnabled,
                erp_ui_enabled: tenant.erp_ui_enabled !== false,
                customer_erp_access: tenant.customer_erp_access !== false,
                billing_status: active ? "ACTIVE" : tenantStatus,
                kill_switch_active: !active,
                tenant_status: tenantStatus,
                activation_source: "CLOUD_ADMIN_HTTP",
            },
        });
    } catch (error) {
        sendJson(response, error instanceof SyntaxError ? 400 : 500, {
            status: "error",
            code: error instanceof SyntaxError ? "INVALID_JSON" : "INTERNAL_ERROR",
            message: error instanceof SyntaxError
                ? "JSON inválido."
                : "No se pudo validar la activación del tenant.",
        });
    }
}
