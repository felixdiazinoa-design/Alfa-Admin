import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { createClient } from "@supabase/supabase-js";

type ApiRequest = IncomingMessage & { body?: unknown; headers: IncomingHttpHeaders; method?: string };

type ReconciliationPayload = {
    mode?: unknown;
    tenant_id?: unknown;
    source_registry_id?: unknown;
    target_erp_terminal_id?: unknown;
    target_store_id?: unknown;
    authorized_device_id?: unknown;
    reason?: unknown;
    correlation_id?: unknown;
    expected_plan_hash?: unknown;
    admin_confirmed?: unknown;
};

type AdminRow = {
    id: string;
    auth_user_id: string;
    email: string;
    status: string;
    cloud_admin_profiles?: {
        is_active?: boolean;
        permissions?: Record<string, boolean>;
    } | Array<{
        is_active?: boolean;
        permissions?: Record<string, boolean>;
    }> | null;
};

function setCors(response: ServerResponse) {
    const allowedOrigin = process.env.CLOUD_ADMIN_CORS_ORIGIN;
    if (allowedOrigin) response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
    setCors(response);
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(body));
}

function requiredEnv(...names: string[]) {
    for (const name of names) {
        const value = process.env[name];
        if (value) return value;
    }
    throw new Error(`Missing required environment variable: ${names.join(" or ")}`);
}

function stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function headerValue(headers: IncomingHttpHeaders, name: string) {
    const value = headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
}

function relation<T>(value: T | T[] | null | undefined): T | null {
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

async function readBody(request: ApiRequest) {
    if (request.body) return typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
}

function errorStatus(message: string) {
    if (/UNAUTHORIZED|AUTHORIZED_ADMIN_REQUIRED/i.test(message)) return 401;
    if (/FORBIDDEN|MISMATCH/i.test(message)) return 403;
    if (/NOT_FOUND/i.test(message)) return 404;
    if (/PLAN_CHANGED/i.test(message)) return 409;
    return 400;
}

export default async function handler(request: ApiRequest, response: ServerResponse) {
    if (request.method === "OPTIONS") {
        setCors(response);
        response.statusCode = 204;
        response.end();
        return;
    }
    if (request.method !== "POST") {
        sendJson(response, 405, { error: "METHOD_NOT_ALLOWED", message: "Método no permitido." });
        return;
    }

    try {
        const authorization = headerValue(request.headers, "authorization") || "";
        const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
        if (!accessToken) {
            sendJson(response, 401, { error: "UNAUTHORIZED", message: "Sesión administrativa requerida." });
            return;
        }

        const supabaseUrl = requiredEnv("SUPABASE_URL", "VITE_SUPABASE_URL").replace(/\/$/, "");
        const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
        const admin = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
            db: { schema: "landlord" },
        });
        const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
        if (authError || !authData.user?.id) {
            sendJson(response, 401, { error: "UNAUTHORIZED", message: "Sesión administrativa inválida." });
            return;
        }

        const { data: adminData, error: adminError } = await admin
            .from("cloud_admin_users")
            .select("id,auth_user_id,email,status,cloud_admin_profiles(is_active,permissions)")
            .eq("auth_user_id", authData.user.id)
            .maybeSingle();
        if (adminError) throw adminError;
        const actor = adminData as AdminRow | null;
        const profile = relation(actor?.cloud_admin_profiles);
        // `terminal_reconciliation` no existía en el catálogo de permisos de la UI,
        // así que ningún perfil podía recibirlo salvo sembrándolo en BD. Se acepta
        // `terminal_reauthorization` como equivalente: reconciliar es reautorizar
        // un device contra la identidad canónica.
        const canReconcile = profile?.permissions?.terminal_reconciliation === true
            || profile?.permissions?.terminal_reauthorization === true;
        if (
            !actor
            || actor.status !== "active"
            || profile?.is_active !== true
            || !canReconcile
        ) {
            sendJson(response, 403, {
                error: "FORBIDDEN",
                message: "No tienes permiso para reconciliar identidades de terminales.",
            });
            return;
        }

        const body = await readBody(request) as ReconciliationPayload;
        const mode = stringValue(body.mode)?.toUpperCase();
        const tenantId = stringValue(body.tenant_id);
        const correlationId = stringValue(body.correlation_id);
        const reason = stringValue(body.reason);
        if (!tenantId || !correlationId || !reason || !["DRY_RUN", "EXECUTE", "ROLLBACK"].includes(mode || "")) {
            sendJson(response, 400, { error: "VALIDATION_ERROR", message: "Modo, tenant, correlación y motivo son requeridos." });
            return;
        }
        if ((mode === "EXECUTE" || mode === "ROLLBACK") && body.admin_confirmed !== true) {
            sendJson(response, 400, { error: "CONFIRMATION_REQUIRED", message: "Confirmación administrativa explícita requerida." });
            return;
        }

        const commonActor = {
            p_tenant_id: tenantId,
            p_reason: reason,
            p_actor_admin_user_id: actor.id,
            p_actor_auth_user_id: actor.auth_user_id,
            p_actor_email: actor.email,
            p_correlation_id: correlationId,
        };
        const rpc = mode === "ROLLBACK"
            ? await admin.rpc("rollback_terminal_identity_reconciliation", commonActor)
            : await admin.rpc("reconcile_terminal_identity", {
                ...commonActor,
                p_source_registry_id: stringValue(body.source_registry_id),
                p_target_erp_terminal_id: stringValue(body.target_erp_terminal_id),
                p_target_store_id: stringValue(body.target_store_id),
                p_authorized_device_id: stringValue(body.authorized_device_id),
                p_expected_plan_hash: stringValue(body.expected_plan_hash),
                p_dry_run: mode === "DRY_RUN",
            });
        if (rpc.error) {
            sendJson(response, errorStatus(rpc.error.message), {
                error: rpc.error.code || "RECONCILIATION_FAILED",
                message: rpc.error.message,
            });
            return;
        }
        sendJson(response, 200, rpc.data || { status: "success" });
    } catch (error) {
        console.error("terminal-reconciliation failed", error);
        sendJson(response, 500, {
            error: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Error interno de reconciliación.",
        });
    }
}
