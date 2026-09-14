import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';

declare const Deno: { env: { get(key: string): string | undefined } };

export interface CloudAdminActor {
    id: string;
    authUserId: string;
    email: string;
    fullName: string;
    profileCode: string;
    profileLevel: number;
    permissions: Record<string, boolean>;
}

interface ActorRow {
    id: string;
    auth_user_id?: string | null;
    email: string;
    full_name: string;
    status: string;
    cloud_admin_profiles?: Array<{
        code?: string | null;
        level?: number | null;
        is_active?: boolean | null;
        permissions?: Record<string, boolean> | null;
    }> | {
        code?: string | null;
        level?: number | null;
        is_active?: boolean | null;
        permissions?: Record<string, boolean> | null;
    } | null;
}

const legacyFallback: Record<string, string> = {
    dashboard_view: 'dashboard', tenants_view: 'tenants', tenants_manage: 'tenants', tenants_delete: 'kill_switch',
    plans_view: 'plans', plans_manage: 'plans', support_view: 'support', support_manage: 'support',
    knowledge_view: 'support', knowledge_manage: 'support', calendar_view: 'support', calendar_manage: 'support',
    improvements_view: 'improvements', improvements_manage: 'improvements', internal_requests_view: 'improvements',
    internal_requests_manage: 'improvements', apk_view: 'apk', apk_manage: 'apk', observability_view: 'observability',
    billing_view: 'billing', billing_manage: 'billing', settings_view: 'settings', settings_manage: 'settings',
    kill_switch_execute: 'kill_switch', users_view: 'users', users_manage: 'users', profiles_manage: 'users',
    licenses_view: 'plans_view', licenses_manage: 'plans_manage',
};

function requiredEnv(name: string) {
    const value = Deno.env.get(name);
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

function relation<T>(value: T | T[] | null | undefined): T | null {
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export function createCloudAdminClient() {
    return createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
        auth: { autoRefreshToken: false, persistSession: false },
        db: { schema: 'landlord' },
    });
}

export function actorHasPermission(actor: CloudAdminActor, permission: string) {
    if (actor.permissions[permission] === true) return true;
    if (typeof actor.permissions[permission] === 'boolean') return false;
    const fallback = legacyFallback[permission];
    return fallback ? actor.permissions[fallback] === true : false;
}

export async function requireCloudAdminActor(request: Request, permission: string): Promise<CloudAdminActor> {
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new Error('Unauthorized administrative request');

    const client = createCloudAdminClient();
    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData.user?.id) throw new Error('Unauthorized administrative request');

    const { data, error } = await client
        .from('cloud_admin_users')
        .select('id, auth_user_id, email, full_name, status, cloud_admin_profiles(code, level, is_active, permissions)')
        .eq('auth_user_id', authData.user.id)
        .maybeSingle();
    if (error || !data) throw new Error('Unauthorized administrative request');

    const row = data as ActorRow;
    const profile = relation(row.cloud_admin_profiles);
    const actor: CloudAdminActor = {
        id: row.id,
        authUserId: authData.user.id,
        email: row.email,
        fullName: row.full_name,
        profileCode: profile?.code ?? '',
        profileLevel: profile?.level ?? 0,
        permissions: profile?.permissions ?? {},
    };
    if (row.status !== 'active' || profile?.is_active !== true || !actorHasPermission(actor, permission)) {
        throw new Error('Forbidden administrative request');
    }
    return actor;
}

export function isCloudAdminAuthorizationError(error: unknown) {
    return /unauthorized|forbidden/i.test(error instanceof Error ? error.message : String(error ?? ''));
}
