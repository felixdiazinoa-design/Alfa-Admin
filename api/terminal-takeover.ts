import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { requireCloudAdminPermission, CloudAdminAuthError } from "./lib/cloud-admin-session.js";

type ApiRequest = IncomingMessage & {
    body?: unknown;
    headers: IncomingHttpHeaders;
    method?: string;
};

type TakeoverPayload = {
    tenant_id?: unknown;
    terminal_id?: unknown;
    registry_id?: unknown;
    device_id?: unknown;
    device_name?: unknown;
    reason?: unknown;
    confirm_takeover?: unknown;
    helpdesk_ticket_id?: unknown;
};

type TenantRecord = {
    id: string;
    name: string;
    slug?: string | null;
    email: string;
    status: string;
    type?: string | null;
    cloud_sync?: boolean | null;
};

type RegistryRecord = {
    id: string;
    tenant_id: string;
    device_id?: string | null;
    terminal_id?: string | null;
    terminal_name?: string | null;
};

type PublicTerminalRecord = {
    id: string;
    tenant_id: string;
    code?: string | null;
    name?: string | null;
    terminal_name?: string | null;
    label?: string | null;
};

type ErpTenantRecord = {
    id: string;
    name?: string | null;
    config?: Record<string, unknown> | null;
};

type ErpTerminalRecord = {
    id: string;
    store_id?: string | null;
    device_id?: string | null;
    name?: string | null;
    config?: Record<string, unknown> | null;
    last_seen?: string | null;
    created_at?: string | null;
};

const tokenKeys = new Set([
    "syncAuthToken",
    "sync_auth_token",
    "token",
    "auth_token",
    "access_token",
    "refresh_token",
]);

function setCors(response: ServerResponse) {
    response.setHeader("Access-Control-Allow-Origin", process.env.CLOUD_ADMIN_TAKEOVER_CORS_ORIGIN || "*");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Actor-User-Id, X-Actor-Email, X-Actor-Source");
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

function stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectValue(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizedText(value: unknown) {
    return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function sanitizePayload(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => sanitizePayload(item));
    }

    if (!value || typeof value !== "object") {
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
    if (!payload || typeof payload !== "object") return null;
    const record = payload as Record<string, unknown>;
    const candidates = [record.code, record.error, record.error_code];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    return null;
}

function getErpErrorMessage(status: number, payload: unknown) {
    const code = getErrorCode(payload);
    if (status === 403 && code === "DEVICE_SUPERSEDED") {
        return "Este dispositivo anterior ya fue reemplazado.";
    }
    if (payload && typeof payload === "object") {
        const record = payload as Record<string, unknown>;
        if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
        if (typeof record.error === "string" && record.error.trim() && record.error.trim() !== code) {
            return record.error.trim();
        }
    }
    if (status === 401 || status === 403) {
        return `ERP rechazo la recuperacion de terminal (HTTP ${status}) sin detalle. Verifica el tenant ERP, el token de servicio ERP y que la terminal este activa.`;
    }
    return "El ERP no pudo completar la recuperacion de terminal.";
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

function isLocalPosTenant(tenant: TenantRecord) {
    return tenant.type === "pos_only" && tenant.cloud_sync === false;
}

function isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getTerminalMatchScore(
    terminal: ErpTerminalRecord,
    candidates: Set<string>,
    terminalName: string | null,
) {
    const config = objectValue(terminal.config);
    const metadata = objectValue(config.metadata);
    const values = [
        terminal.id,
        terminal.device_id,
        terminal.name,
        metadata.terminal_id,
        metadata.erp_terminal_id,
        metadata.terminal_name,
        metadata.station_number,
        config.station_number,
    ].map(normalizedText).filter(Boolean);

    if (values.some((value) => candidates.has(value) && value === normalizedText(terminal.id))) return 100;
    if (values.some((value) => candidates.has(value) && value === normalizedText(terminal.device_id))) return 90;
    if (normalizedText(metadata.terminal_id) && candidates.has(normalizedText(metadata.terminal_id))) return 80;
    if (normalizedText(metadata.erp_terminal_id) && candidates.has(normalizedText(metadata.erp_terminal_id))) return 80;
    if (terminalName && normalizedText(terminal.name) === normalizedText(terminalName)) return 60;
    if (terminalName && normalizedText(metadata.terminal_name) === normalizedText(terminalName)) return 60;
    return values.some((value) => candidates.has(value)) ? 50 : 0;
}

async function resolveErpTenant(
    supabase: ReturnType<typeof createClient>,
    tenant: TenantRecord,
): Promise<ErpTenantRecord | null> {
    const publicClient = supabase.schema("public");

    const lookups = [
        publicClient.from("erp_tenants").select("id,name,config").eq("config->>cloudAdminTenantId", tenant.id).maybeSingle(),
        publicClient.from("erp_tenants").select("id,name,config").eq("id", tenant.id).maybeSingle(),
    ];

    if (tenant.slug) {
        lookups.push(publicClient.from("erp_tenants").select("id,name,config").eq("name", tenant.slug).maybeSingle());
    }

    for (const lookup of lookups) {
        const { data, error } = await lookup;
        if (error && error.code !== "PGRST116") throw error;
        if (data) return data as ErpTenantRecord;
    }

    const { data, error } = await publicClient
        .from("erp_tenants")
        .select("id,name,config");

    if (error) throw error;

    const tenantSlug = normalizedText(tenant.slug);
    const tenantEmail = normalizedText(tenant.email);

    return ((data as ErpTenantRecord[] | null) || []).find((erpTenant) => {
        const config = objectValue(erpTenant.config);
        const contact = objectValue(config.contact);
        return normalizedText(config.cloudAdminTenantId) === normalizedText(tenant.id)
            || (tenantSlug && normalizedText(config.cloudAdminCompanyId) === tenantSlug)
            || (tenantSlug && normalizedText(erpTenant.name) === tenantSlug)
            || (tenantEmail && normalizedText(contact.email) === tenantEmail)
            || (tenantEmail && normalizedText(contact.contactEmail) === tenantEmail);
    }) || null;
}

async function resolveErpTerminal(
    supabase: ReturnType<typeof createClient>,
    params: {
        erpTenantId: string;
        terminalId: string;
        registry: RegistryRecord | null;
        publicTerminal: PublicTerminalRecord | null;
    },
): Promise<ErpTerminalRecord | null> {
    const publicClient = supabase.schema("public");

    if (isUuid(params.terminalId)) {
        const { data, error } = await publicClient
            .from("erp_terminals")
            .select("id,store_id,device_id,name,config,last_seen,created_at")
            .eq("id", params.terminalId)
            .maybeSingle();

        if (error && error.code !== "PGRST116") throw error;
        if (data) return data as ErpTerminalRecord;
    }

    const { data: stores, error: storesError } = await publicClient
        .from("erp_stores")
        .select("id")
        .eq("tenant_id", params.erpTenantId);

    if (storesError) throw storesError;

    const storeIds = ((stores as Array<{ id: string }> | null) || []).map((store) => store.id).filter(Boolean);
    if (storeIds.length === 0) return null;

    const { data: terminals, error: terminalsError } = await publicClient
        .from("erp_terminals")
        .select("id,store_id,device_id,name,config,last_seen,created_at")
        .in("store_id", storeIds);

    if (terminalsError) throw terminalsError;

    const candidates = new Set([
        params.terminalId,
        params.registry?.terminal_id,
        params.registry?.device_id,
        params.publicTerminal?.id,
        params.publicTerminal?.code,
    ].map(normalizedText).filter(Boolean));

    const terminalName = params.registry?.terminal_name
        || params.publicTerminal?.name
        || params.publicTerminal?.terminal_name
        || params.publicTerminal?.label
        || null;

    return ((terminals as ErpTerminalRecord[] | null) || [])
        .map((terminal) => ({
            terminal,
            score: getTerminalMatchScore(terminal, candidates, terminalName),
            ts: new Date(terminal.last_seen || terminal.created_at || 0).getTime() || 0,
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || b.ts - a.ts)[0]?.terminal || null;
}

async function insertAudit(
    supabase: ReturnType<typeof createClient>,
    payload: {
        event: "TERMINAL_TAKEOVER_REQUESTED" | "TERMINAL_TAKEOVER_COMPLETED";
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
    const { error } = await supabase.from("terminal_takeover_audit").insert({
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
        console.error("Failed to write terminal takeover audit", error);
    }
}

export default async function handler(request: ApiRequest, response: ServerResponse) {
    if (request.method === "OPTIONS") {
        sendJson(response, 200, { ok: true });
        return;
    }

    if (request.method !== "POST") {
        sendJson(response, 405, { error: "METHOD_NOT_ALLOWED", message: "Metodo no permitido." });
        return;
    }

    try {
        const session = await requireCloudAdminPermission(request.headers, "terminal_reauthorization");

        const body = await readBody(request) as TakeoverPayload;
        const tenantId = stringValue(body.tenant_id);
        const terminalId = stringValue(body.terminal_id);
        const registryId = stringValue(body.registry_id);
        const newDeviceId = stringValue(body.device_id);
        const deviceName = stringValue(body.device_name);
        const reason = stringValue(body.reason);
        const helpdeskTicketId = stringValue(body.helpdesk_ticket_id);
        const actorUserId = session.actor.authUserId;
        const actorEmail = session.actor.email;

        if (!tenantId || !terminalId || !newDeviceId || !reason) {
            sendJson(response, 400, {
                error: "VALIDATION_ERROR",
                message: "Selecciona tenant, terminal, nuevo device_id y motivo del cambio.",
            });
            return;
        }

        if (body.confirm_takeover !== true) {
            sendJson(response, 400, {
                error: "CONFIRMATION_REQUIRED",
                message: "Confirma explicitamente que la tablet anterior quedara revocada.",
            });
            return;
        }

        const supabase = createClient(
            getEnv("SUPABASE_URL"),
            getEnv("SUPABASE_SERVICE_ROLE_KEY"),
            {
                auth: { autoRefreshToken: false, persistSession: false },
                db: { schema: "landlord" },
            },
        );

        const { data: tenantData, error: tenantError } = await supabase
            .from("tenants")
            .select("id,name,slug,email,status,type,cloud_sync")
            .eq("id", tenantId)
            .maybeSingle();

        if (tenantError) throw tenantError;
        const tenant = tenantData as TenantRecord | null;
        if (!tenant) {
            sendJson(response, 404, { error: "TENANT_NOT_FOUND", message: "Tenant no encontrado." });
            return;
        }
        if (tenant.status !== "ACTIVE") {
            sendJson(response, 400, { error: "TENANT_NOT_ACTIVE", message: "No se permite recuperacion si el tenant no esta activo." });
            return;
        }
        if (!isLocalPosTenant(tenant)) {
            sendJson(response, 400, {
                error: "POS_LOCAL_ONLY",
                message: "La recuperacion de terminal solo aplica a POS configurado como local. POS + ERP mantiene el flujo actual.",
            });
            return;
        }

        let registry: RegistryRecord | null = null;
        if (registryId) {
            const { data, error } = await supabase
                .from("tenant_server_registry")
                .select("id,tenant_id,device_id,terminal_id,terminal_name")
                .eq("tenant_id", tenantId)
                .eq("id", registryId)
                .maybeSingle();
            if (error) throw error;
            registry = (data as RegistryRecord | null) || null;
        }

        if (!registry) {
            const { data, error } = await supabase
                .from("tenant_server_registry")
                .select("id,tenant_id,device_id,terminal_id,terminal_name")
                .eq("tenant_id", tenantId)
                .eq("terminal_id", terminalId)
                .maybeSingle();
            if (error) throw error;
            registry = (data as RegistryRecord | null) || null;
        }

        let publicTerminal: PublicTerminalRecord | null = null;
        if (isUuid(terminalId)) {
            const { data: publicTerminalData, error: terminalError } = await supabase
                .schema("public")
                .from("terminals")
                .select("*")
                .eq("tenant_id", tenantId)
                .eq("id", terminalId)
                .maybeSingle();

            if (terminalError) throw terminalError;
            publicTerminal = publicTerminalData as PublicTerminalRecord | null;
        }

        if (!registry && !publicTerminal) {
            sendJson(response, 404, { error: "TERMINAL_NOT_FOUND", message: "Terminal no encontrada para este tenant." });
            return;
        }

        const erpTenant = await resolveErpTenant(supabase, tenant);
        if (!erpTenant) {
            sendJson(response, 404, {
                error: "ERP_TENANT_NOT_FOUND",
                message: "Tenant no encontrado en ALFA-RMS para este tenant de ALFA-Admin.",
            });
            return;
        }

        const erpTerminal = await resolveErpTerminal(supabase, {
            erpTenantId: erpTenant.id,
            terminalId,
            registry,
            publicTerminal,
        });

        if (!erpTerminal) {
            sendJson(response, 404, {
                error: "ERP_TERMINAL_NOT_FOUND",
                message: "Terminal no encontrada en ERP para este tenant.",
            });
            return;
        }

        const erpTerminalId = erpTerminal.id;
        const previousDeviceId = erpTerminal.device_id || registry?.device_id || null;
        if (previousDeviceId && previousDeviceId === newDeviceId) {
            sendJson(response, 400, {
                error: "SAME_DEVICE_ID",
                message: "El nuevo device_id no puede ser igual al dispositivo anterior.",
            });
            return;
        }

        await insertAudit(supabase, {
            event: "TERMINAL_TAKEOVER_REQUESTED",
            tenant_id: tenantId,
            terminal_id: terminalId,
            previous_device_id: previousDeviceId,
            new_device_id: newDeviceId,
            actor_user_id: actorUserId,
            actor_email: actorEmail,
            reason,
            metadata: {
                registry_id: registry?.id || null,
                source: "cloud-admin-vercel",
                device_name: deviceName,
                erp_tenant_id: erpTenant.id,
                erp_terminal_id: erpTerminalId,
            },
        });

        const erpResponse = await fetch(`${getEnv("ERP_API_URL", "CLOUD_ADMIN_ERP_API_URL").replace(/\/$/, "")}/api/settings/terminals/${encodeURIComponent(erpTerminalId)}/takeover`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${getEnv("ERP_TAKEOVER_SERVICE_TOKEN", "ERP_SERVICE_TOKEN", "CLOUD_ADMIN_ERP_SERVICE_TOKEN")}`,
                "Content-Type": "application/json",
                "X-Tenant-Id": erpTenant.id,
                "X-Cloud-Admin-Tenant-Id": tenantId,
                "X-Actor-User-Id": actorUserId || "",
                "X-Actor-Email": actorEmail || "",
            },
            body: JSON.stringify({
                device_id: newDeviceId,
                device_name: deviceName || undefined,
                takeover_scope: "LOCAL_POS",
            }),
        });

        const erpPayload = await erpResponse.json().catch(async () => ({
            message: await erpResponse.text().catch(() => ""),
        }));
        const erpErrorCode = getErrorCode(erpPayload);

        if (!erpResponse.ok) {
            await insertAudit(supabase, {
                event: "TERMINAL_TAKEOVER_COMPLETED",
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
                    erp_tenant_id: erpTenant.id,
                    erp_terminal_id: erpTerminalId,
                    erp_payload: sanitizePayload(erpPayload),
                },
            });

            sendJson(response, erpResponse.status, {
                error: erpErrorCode || "ERP_TAKEOVER_FAILED",
                message: getErpErrorMessage(erpResponse.status, erpPayload),
            });
            return;
        }

        let registryUpdateError: string | null = null;
        if (registry?.id) {
            const { error: updateError } = await supabase
                .from("tenant_server_registry")
                .update({
                    device_id: newDeviceId,
                    terminal_name: deviceName || registry.terminal_name,
                    last_takeover_at: new Date().toISOString(),
                    previous_device_id: previousDeviceId,
                    current_device_id: newDeviceId,
                    authorized_device_id: newDeviceId,
                    auth_status: "AUTHORIZED",
                    revocation_reason: "TERMINAL_TAKEOVER",
                    requires_pos_reauth: false,
                    is_revoked: false,
                    last_auth_error: null,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", registry.id);

            if (updateError) {
                registryUpdateError = updateError.message;
                console.error("Failed to update tenant server registry after takeover", updateError);
            }
        }

        if (helpdeskTicketId) {
            const { error: messageError } = await supabase.from("ticket_messages").insert({
                ticket_id: helpdeskTicketId,
                sender_type: "System",
                message: `Se ejecuto recuperacion de terminal. Dispositivo anterior: ${previousDeviceId || "N/D"}. Nuevo dispositivo: ${newDeviceId}.`,
                attachments: {
                    technical_action: {
                        action: "terminal_takeover",
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
            if (messageError) console.error("Failed to append helpdesk takeover message", messageError);
        }

        await insertAudit(supabase, {
            event: "TERMINAL_TAKEOVER_COMPLETED",
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
                erp_tenant_id: erpTenant.id,
                erp_terminal_id: erpTerminalId,
                erp_payload: sanitizePayload(erpPayload),
            },
        });

        const sanitizedPayload = sanitizePayload(erpPayload) as Record<string, unknown>;
        sendJson(response, 200, {
            status: "success",
            terminal: sanitizedPayload.terminal || null,
            previous_device_id: (sanitizedPayload.previous_device_id as string | undefined) || previousDeviceId,
            new_device_id: (sanitizedPayload.new_device_id as string | undefined) || newDeviceId,
            requires_auth: sanitizedPayload.requires_auth ?? true,
            message: "Terminal reasignada correctamente. La tablet anterior fue revocada. Inicia sesion/autentica la nueva tablet para continuar.",
        });
    } catch (error) {
        if (error instanceof CloudAdminAuthError) {
            sendJson(response, error.status, { error: error.code, message: error.message });
            return;
        }
        console.error("terminal-takeover failed", error);
        sendJson(response, error instanceof SyntaxError ? 400 : 500, {
            error: error instanceof SyntaxError ? "INVALID_JSON" : "INTERNAL_ERROR",
            message: error instanceof SyntaxError ? "JSON invalido." : formatUnknownError(error),
        });
    }
}
