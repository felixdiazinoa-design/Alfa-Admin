import type { IncomingHttpHeaders } from "node:http";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type UntypedTable = {
    Row: Record<string, unknown>;
    Insert: Record<string, unknown>;
    Update: Record<string, unknown>;
    Relationships: [];
};

type UntypedSchema = {
    Tables: Record<string, UntypedTable>;
    Views: Record<string, UntypedTable>;
    Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }>;
    Enums: Record<string, string>;
    CompositeTypes: Record<string, unknown>;
};

type CloudAdminDatabase = {
    public: UntypedSchema;
    landlord: UntypedSchema;
};

export type AnySupabaseClient = SupabaseClient<CloudAdminDatabase, "landlord">;

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

export type CloudAdminActor = {
    id: string;
    authUserId: string;
    email: string;
    permissions: Record<string, boolean>;
};

export type CloudAdminSession = {
    admin: AnySupabaseClient;
    actor: CloudAdminActor;
};

export class CloudAdminAuthError extends Error {
    status: number;
    code: string;

    constructor(status: number, code: string, message: string) {
        super(message);
        this.name = "CloudAdminAuthError";
        this.status = status;
        this.code = code;
    }
}

const legacyPermissionFallback: Record<string, string> = {
    dashboard_view: "dashboard",
    tenants_view: "tenants",
    tenants_manage: "tenants",
    tenants_delete: "kill_switch",
    observability_view: "observability",
    settings_view: "settings",
    settings_manage: "settings",
    licenses_view: "plans_view",
    licenses_manage: "plans_manage",
};

function requiredEnv(...names: string[]) {
    for (const name of names) {
        const value = process.env[name];
        if (value) return value;
    }
    throw new Error(`Missing required environment variable: ${names.join(" or ")}`);
}

function headerValue(headers: IncomingHttpHeaders, name: string) {
    const value = headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
}

function relation<T>(value: T | T[] | null | undefined): T | null {
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export async function requireCloudAdminPermission(
    headers: IncomingHttpHeaders,
    permission: string,
): Promise<CloudAdminSession> {
    const session = await requireCloudAdminSession(headers);
    const explicitPermission = session.actor.permissions[permission];
    const fallback = legacyPermissionFallback[permission];
    const allowed = explicitPermission === true
        || (typeof explicitPermission !== "boolean" && Boolean(fallback) && session.actor.permissions[fallback] === true);
    if (!allowed) {
        throw new CloudAdminAuthError(
            403,
            "FORBIDDEN",
            "No tienes permiso para ejecutar esta operación administrativa.",
        );
    }

    return session;
}

export async function requireCloudAdminSession(
    headers: IncomingHttpHeaders,
): Promise<CloudAdminSession> {
    const authorization = headerValue(headers, "authorization") || "";
    const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) {
        throw new CloudAdminAuthError(401, "UNAUTHORIZED", "Sesión administrativa requerida.");
    }

    const supabaseUrl = requiredEnv("SUPABASE_URL", "VITE_SUPABASE_URL").replace(/\/$/, "");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient<CloudAdminDatabase, "landlord">(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        db: { schema: "landlord" },
    });
    const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
    if (authError || !authData.user?.id) {
        throw new CloudAdminAuthError(401, "UNAUTHORIZED", "Sesión administrativa inválida.");
    }

    const { data: adminData, error: adminError } = await admin
        .from("cloud_admin_users")
        .select("id,auth_user_id,email,status,cloud_admin_profiles(is_active,permissions)")
        .eq("auth_user_id", authData.user.id)
        .maybeSingle();
    if (adminError) throw adminError;

    const actor = adminData as AdminRow | null;
    const profile = relation(actor?.cloud_admin_profiles);
    if (
        !actor
        || actor.status !== "active"
        || profile?.is_active !== true
    ) {
        throw new CloudAdminAuthError(
            403,
            "FORBIDDEN",
            "Tu usuario no tiene acceso administrativo activo.",
        );
    }

    return {
        admin,
        actor: {
            id: actor.id,
            authUserId: actor.auth_user_id,
            email: actor.email || authData.user.email || actor.auth_user_id,
            permissions: profile.permissions || {},
        },
    };
}
