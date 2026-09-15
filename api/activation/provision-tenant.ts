import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

type TenantType = "full" | "pos_only" | "erp_only";

type QueryResponse<T> = Promise<{ data: T | null; error: unknown | null }>;
type MutationResponse = Promise<{ error: unknown | null }>;

type AuthUser = {
    id?: string;
    email?: string | null;
};

type EqFilter<T> = {
    eq(column: string, value: unknown): QueryResponse<T>;
};

type LimitedFilter<T> = {
    limit(count: number): QueryResponse<T>;
};

type SelectFilter<T> = {
    eq(column: string, value: unknown): LimitedFilter<T>;
};

interface SupabaseAdminClient {
    auth: {
        admin: {
            createUser(input: {
                email: string;
                password: string;
                email_confirm: boolean;
                user_metadata: Record<string, unknown>;
            }): Promise<{
                data: { user?: { id?: string } | null } | null;
                error: unknown | null;
            }>;
            updateUserById(userId: string, attributes: { user_metadata: Record<string, unknown> }): MutationResponse;
            deleteUser(userId: string): MutationResponse;
            listUsers(options: { page: number; perPage: number }): Promise<{
                data: { users: AuthUser[] };
                error: unknown | null;
            }>;
        };
    };
    rpc(functionName: string, args: Record<string, unknown>): QueryResponse<unknown>;
    from(tableName: string): {
        insert(values: Record<string, unknown>): MutationResponse;
        update(values: Record<string, unknown>): EqFilter<unknown>;
        delete(): EqFilter<unknown>;
        select(columns: string): SelectFilter<unknown>;
    };
}

interface ProvisionTenantInput {
    name: string;
    slug: string;
    email: string;
    contactName: string;
    contactEmail: string;
    city: string;
    capturedByDistributorId?: string | null;
    servicedByDistributorId?: string | null;
    plan?: string;
    type?: TenantType;
    cloudSync?: boolean;
    maxPosTerminals?: number;
    maxErpUsers?: number;
    initialPassword: string;
}

type ApiRequest = IncomingMessage & {
    body?: unknown;
    headers: IncomingHttpHeaders;
    method?: string;
};

type ProvisionPayload = {
    name?: unknown;
    email?: unknown;
    slug?: unknown;
    password?: unknown;
    contactName?: unknown;
    contactEmail?: unknown;
    city?: unknown;
    taxId?: unknown;
    capturedByDistributorId?: unknown;
    servicedByDistributorId?: unknown;
    type?: unknown;
    cloudSync?: unknown;
    maxPosTerminals?: unknown;
    maxErpUsers?: unknown;
};

type ExistingTenant = {
    id: string;
    name: string;
    slug: string;
    email: string;
};

const allowedTypes = new Set<TenantType>(["full", "pos_only", "erp_only"]);

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

function extractBearerToken(request: ApiRequest) {
    const authorization = getHeader(request.headers, "authorization") ?? "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || null;
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

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function optionalString(value: unknown): string | null {
    return isNonEmptyString(value) ? value.trim() : null;
}

function normalizeTenantLicenseLimit(value: unknown): number {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 1;
    return Math.max(1, Math.trunc(numericValue));
}

function normalizeOptional(value?: string | null): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmail(value: string) {
    return value.trim().toLowerCase();
}

function normalizeSlug(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
}

function validationError(message: string, extra: Record<string, unknown> = {}) {
    return {
        status: "error",
        code: "VALIDATION_ERROR",
        message,
        ...extra,
    };
}

function isDuplicateError(error: unknown) {
    if (!error || typeof error !== "object") return false;
    const payload = error as Record<string, unknown>;
    const code = typeof payload.code === "string" ? payload.code : "";
    const message = typeof payload.message === "string" ? payload.message.toLowerCase() : "";
    const details = typeof payload.details === "string" ? payload.details.toLowerCase() : "";

    return code === "23505"
        || message.includes("duplicate")
        || message.includes("already registered")
        || message.includes("already been registered")
        || details.includes("already exists");
}

async function findAuthUserIdByEmail(supabase: SupabaseAdminClient, email: string) {
    let page = 1;
    const perPage = 1000;

    while (true) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
        if (error) throw error;

        const match = (data.users || []).find((user) => user.email?.trim().toLowerCase() === email);
        if (match) return match.id;
        if ((data.users || []).length < perPage) return null;
        page += 1;
    }
}

async function findExistingTenant(
    supabase: SupabaseAdminClient,
    email: string,
    slug: string,
) {
    const [emailResult, slugResult] = await Promise.all([
        supabase.from("tenants").select("id,name,slug,email").eq("email", email).limit(1),
        supabase.from("tenants").select("id,name,slug,email").eq("slug", slug).limit(1),
    ]);

    if (emailResult.error) throw emailResult.error;
    if (slugResult.error) throw slugResult.error;

    const emailMatch = (emailResult.data as ExistingTenant[] | null)?.[0];
    if (emailMatch) return { field: "email", tenant: emailMatch };

    const slugMatch = (slugResult.data as ExistingTenant[] | null)?.[0];
    if (slugMatch) return { field: "slug", tenant: slugMatch };

    return null;
}

async function provisionTenant(
    supabaseAdmin: SupabaseAdminClient,
    {
        name,
        slug,
        email,
        contactName,
        contactEmail,
        city,
        capturedByDistributorId,
        servicedByDistributorId,
        plan = "TRIAL",
        type = "full",
        cloudSync = true,
        maxPosTerminals = 1,
        maxErpUsers = 1,
        initialPassword,
    }: ProvisionTenantInput,
) {
    const accessEmail = email.trim().toLowerCase();
    const contactMail = contactEmail.trim().toLowerCase();
    const tempPassword = initialPassword.trim();
    const normalizedMaxPosTerminals = normalizeTenantLicenseLimit(maxPosTerminals);
    const normalizedMaxErpUsers = normalizeTenantLicenseLimit(maxErpUsers);

    const { error: authError, data: authUser } = await supabaseAdmin.auth.admin.createUser({
        email: accessEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
            name,
            full_name: name,
            slug,
            type,
            cloudSync,
            contact_name: contactName.trim(),
            contact_email: contactMail,
            city: city.trim(),
            captured_by_distributor_id: normalizeOptional(capturedByDistributorId),
            serviced_by_distributor_id: normalizeOptional(servicedByDistributorId),
            is_new_user: true,
        },
    });

    if (authError) {
        console.error("Supabase user creation failed", authError);
        throw authError;
    }

    const authUserId = authUser?.user?.id;
    if (!authUserId) {
        throw new Error("Supabase Auth user ID missing after tenant user creation");
    }

    const { data, error: fnError } = await supabaseAdmin.rpc("create_new_tenant", {
        p_name: name,
        p_slug: slug,
        p_email: accessEmail,
        p_type: type,
        p_cloud_sync: cloudSync,
        p_max_pos_terminals: normalizedMaxPosTerminals,
        p_max_erp_users: normalizedMaxErpUsers,
        p_contact_name: contactName.trim(),
        p_contact_email: contactMail,
        p_city: city.trim(),
        p_captured_by_distributor_id: normalizeOptional(capturedByDistributorId),
        p_serviced_by_distributor_id: normalizeOptional(servicedByDistributorId),
    });

    if (fnError) {
        console.error("Tenant provisioning failed", fnError);
        await supabaseAdmin.auth.admin.deleteUser(authUserId);
        throw fnError;
    }

    const tenantId = data as string;

    const { data: tenantRows, error: licenseVerificationError } = await supabaseAdmin
        .from("tenants")
        .select("id,max_pos_terminals,max_erp_users")
        .eq("id", tenantId)
        .limit(1);
    const createdTenant = (tenantRows as Array<Record<string, unknown>> | null)?.[0];
    const licenseMismatch = licenseVerificationError
        || !createdTenant
        || Number(createdTenant.max_pos_terminals) !== normalizedMaxPosTerminals
        || Number(createdTenant.max_erp_users) !== normalizedMaxErpUsers;

    if (licenseMismatch) {
        await supabaseAdmin.from("tenants").delete().eq("id", tenantId);
        await supabaseAdmin.auth.admin.deleteUser(authUserId);
        throw new Error("No se pudo verificar la cantidad de licencias del tenant recién creado.");
    }

    const { error: metadataError } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
        user_metadata: {
            name,
            full_name: name,
            slug,
            type,
            cloudSync,
            contact_name: contactName.trim(),
            contact_email: contactMail,
            city: city.trim(),
            captured_by_distributor_id: normalizeOptional(capturedByDistributorId),
            serviced_by_distributor_id: normalizeOptional(servicedByDistributorId),
            is_new_user: true,
            tenant_id: tenantId,
        },
        app_metadata: {
            tenant_id: tenantId,
        },
    });

    if (metadataError) {
        console.error("Failed to sync tenant metadata into Supabase Auth", metadataError);
        await supabaseAdmin.from("tenants").delete().eq("id", tenantId);
        await supabaseAdmin.auth.admin.deleteUser(authUserId);
        throw metadataError;
    }

    const { error: subscriptionError } = await supabaseAdmin.from("subscriptions").insert({
        tenant_id: tenantId,
        plan_name: plan,
        is_active: true,
    });

    if (subscriptionError) {
        console.error("Failed to create tenant subscription", subscriptionError);
        await supabaseAdmin.from("tenants").delete().eq("id", tenantId);
        await supabaseAdmin.auth.admin.deleteUser(authUserId);
        throw subscriptionError;
    }

    return { tenantId, tempPassword };
}

export default async function handler(request: ApiRequest, response: ServerResponse) {
    if (request.method === "OPTIONS") {
        sendJson(response, 200, { ok: true });
        return;
    }

    if (request.method !== "POST") {
        sendJson(response, 405, {
            status: "error",
            code: "METHOD_NOT_ALLOWED",
            message: "Use POST para aprovisionar tenants.",
        });
        return;
    }

    try {
        let expectedProvisionToken: string;
        try {
            expectedProvisionToken = getEnv("CLOUD_ADMIN_PROVISION_TOKEN");
        } catch {
            sendJson(response, 503, {
                status: "error",
                code: "PROVISIONING_AUTH_NOT_CONFIGURED",
                message: "El acceso servidor-a-servidor para provisioning no está configurado.",
            });
            return;
        }

        const bearerToken = extractBearerToken(request);
        if (!bearerToken || !tokensMatch(bearerToken, expectedProvisionToken)) {
            sendJson(response, 401, {
                status: "error",
                code: "UNAUTHORIZED",
                message: "Credencial de provisioning inválida.",
            });
            return;
        }

        const payload = await readBody(request) as ProvisionPayload;
        const requiredFields = ["name", "email", "slug", "password", "contactName", "contactEmail", "city"] as const;
        const missing = requiredFields.filter((field) => !isNonEmptyString(payload[field]));

        if (missing.length > 0) {
            sendJson(response, 400, validationError("Faltan campos requeridos.", { missing }));
            return;
        }

        const rawName = payload.name as string;
        const rawEmail = payload.email as string;
        const rawSlug = payload.slug as string;
        const rawPassword = payload.password as string;
        const rawContactName = payload.contactName as string;
        const rawContactEmail = payload.contactEmail as string;
        const rawCity = payload.city as string;

        const normalizedSlug = normalizeSlug(rawSlug);
        if (!normalizedSlug) {
            sendJson(response, 400, validationError("El slug no genera un identificador valido.", { field: "slug" }));
            return;
        }

        const type = isNonEmptyString(payload.type) ? payload.type.trim() : "full";
        if (!allowedTypes.has(type as TenantType)) {
            sendJson(response, 400, validationError("Tipo de tenant invalido.", {
                field: "type",
                allowed: Array.from(allowedTypes),
            }));
            return;
        }

        const name = rawName.trim();
        const email = normalizeEmail(rawEmail);
        const contactName = rawContactName.trim();
        const contactEmail = normalizeEmail(rawContactEmail);
        const city = rawCity.trim();
        const password = rawPassword.trim();
        const cloudSync = typeof payload.cloudSync === "boolean" ? payload.cloudSync : true;
        const maxPosTerminals = normalizeTenantLicenseLimit(payload.maxPosTerminals);
        const maxErpUsers = normalizeTenantLicenseLimit(payload.maxErpUsers);

        const supabase = createClient(
            getEnv("SUPABASE_URL", "VITE_SUPABASE_URL"),
            getEnv("SUPABASE_SERVICE_ROLE_KEY"),
            {
                auth: { autoRefreshToken: false, persistSession: false },
                db: { schema: "landlord" },
            },
        ) as unknown as SupabaseAdminClient;

        const existingTenant = await findExistingTenant(supabase, email, normalizedSlug);
        if (existingTenant) {
            sendJson(response, 409, {
                status: "error",
                code: "TENANT_ALREADY_EXISTS",
                message: `Ya existe un tenant con ese ${existingTenant.field}.`,
                field: existingTenant.field,
                tenant: existingTenant.tenant,
            });
            return;
        }

        const existingAuthUserId = await findAuthUserIdByEmail(supabase, email);
        if (existingAuthUserId) {
            sendJson(response, 409, {
                status: "error",
                code: "AUTH_USER_ALREADY_EXISTS",
                message: "Ya existe un usuario Auth con ese email.",
                field: "email",
            });
            return;
        }

        const { tenantId, tempPassword } = await provisionTenant(supabase, {
            name,
            slug: normalizedSlug,
            email,
            contactName,
            contactEmail,
            city,
            capturedByDistributorId: optionalString(payload.capturedByDistributorId),
            servicedByDistributorId: optionalString(payload.servicedByDistributorId),
            type: type as TenantType,
            cloudSync,
            maxPosTerminals,
            maxErpUsers,
            initialPassword: password,
            plan: "TRIAL",
        });

        const taxId = optionalString(payload.taxId);
        if (taxId) {
            const { error: taxError } = await supabase
                .from("tenants")
                .update({ tax_id: taxId })
                .eq("id", tenantId);

            if (taxError) throw taxError;
        }

        sendJson(response, 200, {
            status: "success",
            tenant_id: tenantId,
            id: tenantId,
            name,
            slug: normalizedSlug,
            email,
            tempPassword,
            activation: {
                cloud_admin_tenant_id: tenantId,
                tenant_id: tenantId,
                tenant_name: name,
                company_ref: normalizedSlug,
                erp_enabled: true,
                billing_status: "ACTIVE",
                kill_switch_active: false,
                activation_source: "CLOUD_ADMIN",
            },
        });
    } catch (error) {
        console.error("provision-tenant failed", error);

        if (error instanceof SyntaxError) {
            sendJson(response, 400, validationError("JSON invalido."));
            return;
        }

        if (isDuplicateError(error)) {
            sendJson(response, 409, {
                status: "error",
                code: "DUPLICATE_TENANT",
                message: "Ya existe un tenant o usuario con esos datos.",
                detail: formatUnknownError(error),
            });
            return;
        }

        sendJson(response, 500, {
            status: "error",
            code: "INTERNAL_ERROR",
            message: "No se pudo aprovisionar el tenant.",
            detail: formatUnknownError(error),
        });
    }
}
