import {
    createCloudAdminClient,
    isCloudAdminAuthorizationError,
    requireCloudAdminActor,
    type CloudAdminActor,
} from '../_shared/cloud-admin-auth.ts';

declare const Deno: { serve(handler: (request: Request) => Response | Promise<Response>): void };

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type JsonRecord = Record<string, unknown>;

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function text(value: unknown, max = 500) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function email(value: unknown) {
    const normalized = text(value, 254).toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
}

function uuid(value: unknown) {
    const normalized = text(value, 64);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized) ? normalized : '';
}

function stringArray(value: unknown, max = 100) {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map((item) => uuid(item)).filter(Boolean))).slice(0, max);
}

function permissions(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value as JsonRecord).filter(([, enabled]) => typeof enabled === 'boolean'));
}

function randomPassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function requestMeta(request: Request) {
    return {
        request_ip: text(request.headers.get('x-forwarded-for')?.split(',')[0], 120) || null,
        user_agent: text(request.headers.get('user-agent'), 500) || null,
    };
}

async function audit(
    client: ReturnType<typeof createCloudAdminClient>,
    request: Request,
    actor: CloudAdminActor,
    action: string,
    entityType: string,
    entityId: string | null,
    beforeData: unknown,
    afterData: unknown,
) {
    const { error } = await client.from('cloud_admin_audit_log').insert({
        actor_admin_user_id: actor.id,
        actor_auth_user_id: actor.authUserId,
        actor_email: actor.email,
        action,
        entity_type: entityType,
        entity_id: entityId,
        before_data: beforeData ?? null,
        after_data: afterData ?? null,
        ...requestMeta(request),
    });
    if (error) throw error;
}

async function getProfile(client: ReturnType<typeof createCloudAdminClient>, profileId: string) {
    const { data, error } = await client.from('cloud_admin_profiles').select('*').eq('id', profileId).maybeSingle();
    if (error) throw error;
    if (!data || data.is_active !== true) throw new Error('El perfil seleccionado no está disponible.');
    return data as JsonRecord & { id: string; code: string; level: number; permissions?: JsonRecord };
}

function assertAssignableProfile(actor: CloudAdminActor, profile: { code: string; level: number }) {
    if (actor.profileCode === 'owner') return;
    if (profile.code === 'owner' || profile.level >= actor.profileLevel) {
        throw new Error('No puedes asignar un perfil de nivel igual o superior al tuyo.');
    }
}

async function assertTargetBelowActor(client: ReturnType<typeof createCloudAdminClient>, actor: CloudAdminActor, userId: string) {
    const { data, error } = await client
        .from('cloud_admin_users')
        .select('id, auth_user_id, profile_id, status, full_name, phone, helpdesk_all_departments, cloud_admin_profiles(code, level)')
        .eq('id', userId)
        .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Usuario no encontrado.');
    const related = Array.isArray(data.cloud_admin_profiles) ? data.cloud_admin_profiles[0] : data.cloud_admin_profiles;
    const targetLevel = Number(related?.level ?? 0);
    if (actor.profileCode !== 'owner' && targetLevel >= actor.profileLevel) {
        throw new Error('No puedes modificar un usuario de nivel igual o superior al tuyo.');
    }
    return data as JsonRecord & { id: string; auth_user_id?: string | null; profile_id?: string | null; status: string };
}

async function syncDepartments(client: ReturnType<typeof createCloudAdminClient>, userId: string, departmentIds: string[]) {
    const { error: deleteError } = await client.from('support_team_members').delete().eq('admin_user_id', userId);
    if (deleteError) throw deleteError;
    if (!departmentIds.length) return;
    const { error } = await client.from('support_team_members').insert(departmentIds.map((teamId) => ({ admin_user_id: userId, team_id: teamId })));
    if (error) throw error;
}

async function overview(client: ReturnType<typeof createCloudAdminClient>, actor: CloudAdminActor) {
    const [profilesRes, usersRes, departmentsRes, membershipsRes] = await Promise.all([
        client.from('cloud_admin_profiles').select('*').order('level', { ascending: false }).order('name'),
        client.from('cloud_admin_users').select('*').order('created_at', { ascending: false }),
        client.from('support_teams').select('*').order('name'),
        client.from('support_team_members').select('team_id, admin_user_id'),
    ]);
    for (const result of [profilesRes, usersRes, departmentsRes, membershipsRes]) if (result.error) throw result.error;
    const profiles = profilesRes.data ?? [];
    const memberships = membershipsRes.data ?? [];
    const departments = departmentsRes.data ?? [];
    const users = (usersRes.data ?? []).map((user) => ({
        ...user,
        profile: profiles.find((profile) => profile.id === user.profile_id) ?? null,
        departments: memberships
            .filter((membership) => membership.admin_user_id === user.id)
            .map((membership) => departments.find((department) => department.id === membership.team_id))
            .filter(Boolean),
    }));
    return { profiles, users, departments, actor: { id: actor.id, profileCode: actor.profileCode, profileLevel: actor.profileLevel, permissions: actor.permissions } };
}

async function findAuthUser(client: ReturnType<typeof createCloudAdminClient>, targetEmail: string) {
    for (let page = 1; page <= 20; page += 1) {
        const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
        if (error) throw error;
        const match = (data.users ?? []).find((user) => user.email?.toLowerCase() === targetEmail);
        if (match) return match;
        if ((data.users ?? []).length < 100) return null;
    }
    return null;
}

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    try {
        const payload = await request.json().catch(() => ({})) as JsonRecord;
        const action = text(payload.action, 80);
        const requiredPermission = action === 'list_audit' ? 'audit_view'
            : ['create_profile', 'update_profile', 'delete_profile'].includes(action) ? 'profiles_manage'
                : action === 'overview' ? 'users_view' : 'users_manage';
        const actor = await requireCloudAdminActor(request, requiredPermission);
        const client = createCloudAdminClient();

        if (action === 'overview') return json(await overview(client, actor));

        if (action === 'list_audit') {
            const { data, error } = await client.from('cloud_admin_audit_log').select('*').order('created_at', { ascending: false }).limit(300);
            if (error) throw error;
            return json({ events: data ?? [] });
        }

        if (action === 'create_profile') {
            const fields = (payload.fields ?? {}) as JsonRecord;
            const level = Math.max(0, Math.min(100, Number(fields.level ?? 0)));
            if (actor.profileCode !== 'owner' && level >= actor.profileLevel) throw new Error('El perfil debe tener un nivel inferior al tuyo.');
            const record = {
                code: text(fields.code, 80).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, ''),
                name: text(fields.name, 120), description: text(fields.description, 500) || null,
                level, permissions: permissions(fields.permissions), is_system: false, is_active: true,
            };
            if (!record.code || !record.name) throw new Error('Código y nombre son requeridos.');
            const { data, error } = await client.from('cloud_admin_profiles').insert(record).select('*').single();
            if (error) throw error;
            await audit(client, request, actor, 'profile.create', 'cloud_admin_profile', data.id, null, data);
            return json({ profile: data });
        }

        if (action === 'update_profile') {
            const profileId = uuid(payload.profile_id);
            const before = await getProfile(client, profileId);
            if (before.code === 'owner' && actor.profileCode !== 'owner') throw new Error('Solo Propietario puede modificar ese perfil.');
            const fields = (payload.fields ?? {}) as JsonRecord;
            const level = Math.max(0, Math.min(100, Number(fields.level ?? before.level)));
            if (actor.profileCode !== 'owner' && level >= actor.profileLevel) throw new Error('El perfil debe tener un nivel inferior al tuyo.');
            const update = { name: text(fields.name, 120), description: text(fields.description, 500) || null, level, permissions: permissions(fields.permissions), is_active: fields.is_active !== false };
            const { data, error } = await client.from('cloud_admin_profiles').update(update).eq('id', profileId).select('*').single();
            if (error) throw error;
            await audit(client, request, actor, 'profile.update', 'cloud_admin_profile', profileId, before, data);
            return json({ profile: data });
        }

        if (action === 'delete_profile') {
            const profileId = uuid(payload.profile_id);
            const before = await getProfile(client, profileId);
            if (before.is_system === true) throw new Error('Los perfiles del sistema no se eliminan.');
            const { count, error: countError } = await client.from('cloud_admin_users').select('id', { count: 'exact', head: true }).eq('profile_id', profileId);
            if (countError) throw countError;
            if ((count ?? 0) > 0) throw new Error('No se puede eliminar un perfil asignado a usuarios.');
            const { error } = await client.from('cloud_admin_profiles').delete().eq('id', profileId).eq('is_system', false);
            if (error) throw error;
            await audit(client, request, actor, 'profile.delete', 'cloud_admin_profile', profileId, before, null);
            return json({ ok: true });
        }

        if (action === 'create_user') {
            const fields = (payload.fields ?? {}) as JsonRecord;
            const targetEmail = email(fields.email);
            const profile = await getProfile(client, uuid(fields.profile_id));
            assertAssignableProfile(actor, profile);
            if (!targetEmail || !text(fields.full_name, 120)) throw new Error('Email y nombre son requeridos.');
            const existing = await client.from('cloud_admin_users').select('id').ilike('email', targetEmail).maybeSingle();
            if (existing.error) throw existing.error;
            if (existing.data) throw new Error('Este usuario ya está registrado en ALFA-Admin.');
            const tempPassword = randomPassword();
            let authUser = await findAuthUser(client, targetEmail);
            let authLinkType: 'created' | 'linked_existing' = 'linked_existing';
            if (!authUser) {
                const created = await client.auth.admin.createUser({ email: targetEmail, password: tempPassword, email_confirm: true });
                if (created.error || !created.data.user) throw created.error ?? new Error('No se pudo crear el usuario Auth.');
                authUser = created.data.user;
                authLinkType = 'created';
            }
            const status = ['active', 'invited', 'suspended'].includes(text(fields.status, 20)) ? text(fields.status, 20) : 'active';
            const { data, error } = await client.from('cloud_admin_users').insert({
                auth_user_id: authUser.id, email: targetEmail, full_name: text(fields.full_name, 120), phone: text(fields.phone, 40) || null,
                profile_id: profile.id, status, helpdesk_all_departments: fields.helpdesk_all_departments === true,
                metadata: { created_from: 'cloud_admin', auth_link_type: authLinkType, profile_code: profile.code },
            }).select('*').single();
            if (error) {
                if (authLinkType === 'created') await client.auth.admin.deleteUser(authUser.id);
                throw error;
            }
            try {
                await syncDepartments(client, data.id, stringArray(fields.department_ids));
                const authUpdate = await client.auth.admin.updateUserById(authUser.id, { app_metadata: { ...authUser.app_metadata, cloud_admin: true, cloud_admin_profile_id: profile.id, cloud_admin_profile_code: profile.code, cloud_admin_level: profile.level, cloud_admin_permissions: profile.permissions ?? {}, cloud_admin_status: status } });
                if (authUpdate.error) throw authUpdate.error;
            } catch (postCreateError) {
                await client.from('support_team_members').delete().eq('admin_user_id', data.id);
                await client.from('cloud_admin_users').delete().eq('id', data.id);
                if (authLinkType === 'created') await client.auth.admin.deleteUser(authUser.id);
                throw postCreateError;
            }
            await audit(client, request, actor, 'user.create', 'cloud_admin_user', data.id, null, { ...data, temp_password: undefined });
            return json({ user: data, auth_link_type: authLinkType, temp_password: authLinkType === 'created' ? tempPassword : null });
        }

        if (action === 'update_user') {
            const userId = uuid(payload.user_id);
            const before = await assertTargetBelowActor(client, actor, userId);
            const fields = (payload.fields ?? {}) as JsonRecord;
            const profile = await getProfile(client, uuid(fields.profile_id));
            assertAssignableProfile(actor, profile);
            const requestedStatus = ['active', 'invited', 'suspended'].includes(text(fields.status, 20)) ? text(fields.status, 20) : before.status;
            if (userId === actor.id && (profile.id !== before.profile_id || requestedStatus !== before.status)) {
                throw new Error('No puedes cambiar tu propio perfil ni estado.');
            }
            const update = { full_name: text(fields.full_name, 120), phone: text(fields.phone, 40) || null, profile_id: profile.id, status: requestedStatus, helpdesk_all_departments: fields.helpdesk_all_departments === true };
            const { data, error } = await client.from('cloud_admin_users').update(update).eq('id', userId).select('*').single();
            if (error) throw error;
            await syncDepartments(client, userId, stringArray(fields.department_ids));
            if (before.auth_user_id) {
                const authResult = await client.auth.admin.getUserById(before.auth_user_id);
                if (authResult.error) throw authResult.error;
                const authUpdate = await client.auth.admin.updateUserById(before.auth_user_id, { app_metadata: { ...authResult.data.user.app_metadata, cloud_admin: true, cloud_admin_profile_id: profile.id, cloud_admin_profile_code: profile.code, cloud_admin_level: profile.level, cloud_admin_permissions: profile.permissions ?? {}, cloud_admin_status: requestedStatus } });
                if (authUpdate.error) throw authUpdate.error;
            }
            await audit(client, request, actor, requestedStatus === 'suspended' && before.status !== 'suspended' ? 'user.suspend' : 'user.update', 'cloud_admin_user', userId, before, data);
            return json({ user: data });
        }

        if (action === 'create_department' || action === 'update_department') {
            const fields = (payload.fields ?? {}) as JsonRecord;
            const departmentId = action === 'update_department' ? uuid(payload.department_id) : null;
            const before = departmentId ? (await client.from('support_teams').select('*').eq('id', departmentId).single()).data : null;
            const record = { name: text(fields.name, 120), description: text(fields.description, 500) || null, is_active: fields.is_active !== false } as JsonRecord;
            if (!record.name) throw new Error('El nombre es requerido.');
            if (!departmentId) record.code = text(fields.code, 80).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
            const query = departmentId ? client.from('support_teams').update(record).eq('id', departmentId) : client.from('support_teams').insert(record);
            const { data, error } = await query.select('*').single();
            if (error) throw error;
            await audit(client, request, actor, departmentId ? 'department.update' : 'department.create', 'support_department', data.id, before, data);
            return json({ department: data });
        }

        return json({ error: 'Unknown action' }, 400);
    } catch (error) {
        console.error('access-management-api', error);
        const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
        return json({ error: message }, isCloudAdminAuthorizationError(error) ? (/forbidden/i.test(message) ? 403 : 401) : 400);
    }
});
