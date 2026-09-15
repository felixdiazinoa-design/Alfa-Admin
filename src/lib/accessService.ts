import { supabaseAdmin } from './supabase';
import type { User } from '@supabase/supabase-js';
import type {
    CloudAdminPermissionKey,
    CloudAdminPermissions,
    CloudAdminProfile,
    CloudAdminUser,
    CloudAdminUserStatus,
    SupportDepartment,
} from '../types';

export const permissionCatalog: Array<{ key: CloudAdminPermissionKey; group: string; label: string; description: string }> = [
    { key: 'dashboard_view', group: 'Dashboard', label: 'Consultar', description: 'Ver indicadores generales.' },
    { key: 'tenants_view', group: 'Tenants', label: 'Consultar', description: 'Ver empresas, licencias y terminales.' },
    { key: 'tenants_manage', group: 'Tenants', label: 'Gestionar', description: 'Crear, editar, suspender y reactivar.' },
    { key: 'tenants_delete', group: 'Tenants', label: 'Eliminar', description: 'Eliminar definitivamente un tenant.' },
    { key: 'plans_view', group: 'Planes', label: 'Consultar', description: 'Ver planes y límites comerciales.' },
    { key: 'plans_manage', group: 'Planes', label: 'Gestionar', description: 'Crear o editar planes.' },
    { key: 'licenses_view', group: 'Licencias ERP', label: 'Consultar', description: 'Ver módulos y límites contratados por tenant.' },
    { key: 'licenses_manage', group: 'Licencias ERP', label: 'Gestionar', description: 'Activar módulos y modificar sus límites.' },
    { key: 'terminal_reauthorization', group: 'Terminales', label: 'Reautorizar dispositivos', description: 'Aprobar o rechazar reemplazos de dispositivos POS.' },
    { key: 'support_view', group: 'HelpDesk', label: 'Consultar', description: 'Ver tickets y conversaciones.' },
    { key: 'support_manage', group: 'HelpDesk', label: 'Gestionar', description: 'Responder, asignar y resolver tickets.' },
    { key: 'knowledge_view', group: 'Manuales', label: 'Consultar', description: 'Consultar manuales y videos.' },
    { key: 'knowledge_manage', group: 'Manuales', label: 'Gestionar', description: 'Publicar o editar contenido.' },
    { key: 'calendar_view', group: 'Implementaciones', label: 'Consultar', description: 'Ver reuniones e implementaciones.' },
    { key: 'calendar_manage', group: 'Implementaciones', label: 'Gestionar', description: 'Crear o editar reuniones.' },
    { key: 'internal_requests_view', group: 'Solicitudes', label: 'Consultar', description: 'Ver solicitudes internas y de clientes.' },
    { key: 'internal_requests_manage', group: 'Solicitudes', label: 'Gestionar', description: 'Crear, asignar y actualizar solicitudes.' },
    { key: 'apk_view', group: 'APK POS', label: 'Consultar', description: 'Ver versiones y descargas.' },
    { key: 'apk_manage', group: 'APK POS', label: 'Gestionar', description: 'Publicar o editar versiones.' },
    { key: 'observability_view', group: 'Observabilidad', label: 'Consultar', description: 'Ver telemetría y salud operativa.' },
    { key: 'billing_view', group: 'Facturación', label: 'Consultar', description: 'Ver suscripciones y pagos.' },
    { key: 'billing_manage', group: 'Facturación', label: 'Gestionar', description: 'Modificar información comercial.' },
    { key: 'settings_view', group: 'Configuración', label: 'Consultar', description: 'Ver integraciones y parámetros.' },
    { key: 'settings_manage', group: 'Configuración', label: 'Gestionar', description: 'Modificar integraciones y parámetros.' },
    { key: 'kill_switch_execute', group: 'Seguridad crítica', label: 'Ejecutar Kill Switch', description: 'Suspender operaciones críticas.' },
    { key: 'users_view', group: 'Usuarios', label: 'Consultar', description: 'Ver usuarios y perfiles.' },
    { key: 'users_manage', group: 'Usuarios', label: 'Gestionar', description: 'Crear, editar o suspender usuarios.' },
    { key: 'profiles_manage', group: 'Usuarios', label: 'Gestionar perfiles', description: 'Crear o modificar perfiles y permisos.' },
    { key: 'audit_view', group: 'Auditoría', label: 'Consultar', description: 'Ver el registro administrativo.' },
];

export const emptyPermissions = permissionCatalog.reduce((acc, permission) => {
    acc[permission.key] = false;
    return acc;
}, {} as CloudAdminPermissions);

export interface CreateProfileInput {
    code: string;
    name: string;
    description?: string;
    level: number;
    permissions: Partial<CloudAdminPermissions>;
}

export interface UpdateProfileInput {
    name: string;
    description?: string;
    level: number;
    permissions: Partial<CloudAdminPermissions>;
    is_active: boolean;
}

export interface CreateCloudAdminUserInput {
    email: string;
    fullName: string;
    phone?: string;
    profileId: string;
    status: CloudAdminUserStatus;
    departmentIds: string[];
    helpdeskAllDepartments: boolean;
}

export interface UpdateCloudAdminUserInput {
    fullName: string;
    phone?: string;
    profileId: string;
    status: CloudAdminUserStatus;
    departmentIds: string[];
    helpdeskAllDepartments: boolean;
}

export interface SupportDepartmentInput {
    code: string;
    name: string;
    description?: string;
    isActive?: boolean;
}

export interface CreatedCloudAdminUser {
    user: CloudAdminUser;
    tempPassword?: string | null;
    authLinkType: 'created' | 'linked_existing';
}

function normalizeEmail(value: string) {
    return value.trim().toLowerCase();
}

function normalizeCode(value: string) {
    return value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

function generateTempPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    let password = '';
    for (let i = 0; i < 16; i += 1) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

function normalizePermissions(permissions: Partial<CloudAdminPermissions>) {
    return {
        ...emptyPermissions,
        ...permissions,
    };
}

function isDuplicateAuthEmailError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || '');
    return /already.*registered|already.*exists|email.*exists/i.test(message);
}

function buildCloudAdminAuthMetadata(
    profile: CloudAdminProfile,
    input: CreateCloudAdminUserInput | UpdateCloudAdminUserInput,
    existingUser?: User | null,
) {
    return {
        user_metadata: {
            ...(existingUser?.user_metadata || {}),
            full_name: input.fullName.trim(),
            phone: input.phone?.trim() || null,
            cloud_admin: true,
        },
        app_metadata: {
            ...(existingUser?.app_metadata || {}),
            cloud_admin: true,
            cloud_admin_profile_id: profile.id,
            cloud_admin_profile_code: profile.code,
            cloud_admin_level: profile.level,
            cloud_admin_permissions: normalizePermissions(profile.permissions || {}),
            cloud_admin_status: input.status,
        },
    };
}

async function findAuthUserByEmail(email: string): Promise<User | null> {
    const perPage = 100;
    for (let page = 1; page <= 20; page += 1) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
        if (error) throw error;
        const users = data.users || [];
        const match = users.find((user) => normalizeEmail(user.email || '') === email);
        if (match) return match;
        if (users.length < perPage) return null;
    }
    return null;
}

async function getAuthUserById(userId: string): Promise<User | null> {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (error) throw error;
    return data.user || null;
}

function withProfile(
    user: CloudAdminUser,
    profiles: CloudAdminProfile[],
    departments: SupportDepartment[],
    memberships: Array<{ admin_user_id: string; team_id: string }>,
) {
    return {
        ...user,
        profile: profiles.find((profile) => profile.id === user.profile_id) || null,
        departments: memberships
            .filter((membership) => membership.admin_user_id === user.id)
            .map((membership) => departments.find((department) => department.id === membership.team_id))
            .filter((department): department is SupportDepartment => Boolean(department)),
    };
}

async function syncUserDepartments(userId: string, departmentIds: string[]) {
    const uniqueDepartmentIds = Array.from(new Set(departmentIds.filter(Boolean)));
    const { error: deleteError } = await supabaseAdmin
        .from('support_team_members')
        .delete()
        .eq('admin_user_id', userId);
    if (deleteError) throw deleteError;
    if (!uniqueDepartmentIds.length) return;

    const { error: insertError } = await supabaseAdmin
        .from('support_team_members')
        .insert(uniqueDepartmentIds.map((teamId) => ({ team_id: teamId, admin_user_id: userId })));
    if (insertError) throw insertError;
}

export async function getAccessOverview() {
    const [profilesRes, usersRes, departmentsRes, membershipsRes] = await Promise.all([
        supabaseAdmin
            .from('cloud_admin_profiles')
            .select('*')
            .order('level', { ascending: false })
            .order('name', { ascending: true }),
        supabaseAdmin
            .from('cloud_admin_users')
            .select('*')
            .order('created_at', { ascending: false }),
        supabaseAdmin
            .from('support_teams')
            .select('*')
            .order('name'),
        supabaseAdmin
            .from('support_team_members')
            .select('team_id, admin_user_id'),
    ]);

    if (profilesRes.error) throw profilesRes.error;
    if (usersRes.error) throw usersRes.error;
    if (departmentsRes.error) throw departmentsRes.error;
    if (membershipsRes.error) throw membershipsRes.error;

    const profiles = ((profilesRes.data || []) as CloudAdminProfile[]).map((profile) => ({
        ...profile,
        permissions: normalizePermissions(profile.permissions || {}),
    }));
    const departments = (departmentsRes.data || []) as SupportDepartment[];
    const memberships = (membershipsRes.data || []) as Array<{ admin_user_id: string; team_id: string }>;
    const users = ((usersRes.data || []) as CloudAdminUser[])
        .map((user) => withProfile(user, profiles, departments, memberships));

    return { profiles, users, departments };
}

export async function createProfile(input: CreateProfileInput): Promise<CloudAdminProfile> {
    const code = normalizeCode(input.code);
    if (!code) throw new Error('El código del perfil es requerido.');

    const { data, error } = await supabaseAdmin
        .from('cloud_admin_profiles')
        .insert({
            code,
            name: input.name.trim(),
            description: input.description?.trim() || null,
            level: input.level,
            permissions: normalizePermissions(input.permissions),
            is_system: false,
            is_active: true,
        })
        .select('*')
        .single();

    if (error) throw error;
    return data as CloudAdminProfile;
}

export async function updateProfile(profileId: string, input: UpdateProfileInput): Promise<CloudAdminProfile> {
    const { data, error } = await supabaseAdmin
        .from('cloud_admin_profiles')
        .update({
            name: input.name.trim(),
            description: input.description?.trim() || null,
            level: input.level,
            permissions: normalizePermissions(input.permissions),
            is_active: input.is_active,
        })
        .eq('id', profileId)
        .select('*')
        .single();

    if (error) throw error;
    return data as CloudAdminProfile;
}

export async function deleteProfile(profileId: string): Promise<void> {
    const { count, error: countError } = await supabaseAdmin
        .from('cloud_admin_users')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', profileId);

    if (countError) throw countError;
    if ((count || 0) > 0) {
        throw new Error('No se puede eliminar un perfil asignado a usuarios.');
    }

    const { error } = await supabaseAdmin
        .from('cloud_admin_profiles')
        .delete()
        .eq('id', profileId)
        .eq('is_system', false);

    if (error) throw error;
}

export async function createCloudAdminUser(input: CreateCloudAdminUserInput): Promise<CreatedCloudAdminUser> {
    const email = normalizeEmail(input.email);
    const tempPassword = generateTempPassword();
    const profile = await getProfile(input.profileId);

    const { data: existingCloudAdminUser, error: existingCloudAdminError } = await supabaseAdmin
        .from('cloud_admin_users')
        .select('id')
        .eq('email', email)
        .maybeSingle();

    if (existingCloudAdminError) throw existingCloudAdminError;
    if (existingCloudAdminUser) {
        throw new Error('Este usuario ya tiene acceso registrado en ALFA-Admin.');
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        ...buildCloudAdminAuthMetadata(profile, input),
    });

    let authUserId = authData.user?.id || null;
    let authUserCreated = Boolean(authUserId);
    let authLinkType: CreatedCloudAdminUser['authLinkType'] = 'created';
    let passwordToReturn: string | null = tempPassword;

    if (authError) {
        if (!isDuplicateAuthEmailError(authError)) throw authError;

        const existingAuthUser = await findAuthUserByEmail(email);
        if (!existingAuthUser?.id) throw authError;

        const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(
            existingAuthUser.id,
            buildCloudAdminAuthMetadata(profile, input, existingAuthUser),
        );
        if (updateAuthError) throw updateAuthError;

        authUserId = existingAuthUser.id;
        authUserCreated = false;
        authLinkType = 'linked_existing';
        passwordToReturn = null;
    }

    if (!authUserId) throw new Error('No se pudo resolver el usuario de autenticación.');

    const { data, error } = await supabaseAdmin
        .from('cloud_admin_users')
        .insert({
            auth_user_id: authUserId,
            email,
            full_name: input.fullName.trim(),
            phone: input.phone?.trim() || null,
            profile_id: profile.id,
            status: input.status,
            helpdesk_all_departments: input.helpdeskAllDepartments,
            metadata: {
                created_from: 'cloud_admin',
                auth_link_type: authLinkType,
                profile_code: profile.code,
            },
        })
        .select('*')
        .single();

    if (error) {
        if (authUserCreated) {
            await supabaseAdmin.auth.admin.deleteUser(authUserId);
        }
        throw error;
    }

    try {
        await syncUserDepartments(data.id, input.departmentIds);
    } catch (membershipError) {
        await supabaseAdmin.from('cloud_admin_users').delete().eq('id', data.id);
        if (authUserCreated) await supabaseAdmin.auth.admin.deleteUser(authUserId);
        throw membershipError;
    }

    return {
        user: { ...(data as CloudAdminUser), profile, departments: [] },
        tempPassword: passwordToReturn,
        authLinkType,
    };
}

export async function updateCloudAdminUser(userId: string, input: UpdateCloudAdminUserInput): Promise<CloudAdminUser> {
    const profile = await getProfile(input.profileId);
    const { data: existingUser, error: existingUserError } = await supabaseAdmin
        .from('cloud_admin_users')
        .select('metadata')
        .eq('id', userId)
        .single();
    if (existingUserError) throw existingUserError;
    const { data, error } = await supabaseAdmin
        .from('cloud_admin_users')
        .update({
            full_name: input.fullName.trim(),
            phone: input.phone?.trim() || null,
            profile_id: profile.id,
            status: input.status,
            helpdesk_all_departments: input.helpdeskAllDepartments,
            metadata: {
                ...((existingUser.metadata || {}) as Record<string, unknown>),
                profile_code: profile.code,
            },
        })
        .eq('id', userId)
        .select('*')
        .single();

    if (error) throw error;
    const user = data as CloudAdminUser;

    await syncUserDepartments(userId, input.departmentIds);

    if (user.auth_user_id) {
        const authUser = await getAuthUserById(user.auth_user_id);
        const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(user.auth_user_id, {
            ...buildCloudAdminAuthMetadata(profile, input, authUser),
        });
        if (authError) throw authError;
    }

    return { ...user, profile, departments: [] };
}

export async function deleteCloudAdminUser(user: CloudAdminUser): Promise<void> {
    const { error } = await supabaseAdmin
        .from('cloud_admin_users')
        .delete()
        .eq('id', user.id);

    if (error) throw error;

    const authLinkType = user.metadata?.auth_link_type;
    const wasCreatedByCloudAdmin = user.metadata?.created_from === 'cloud_admin' && authLinkType !== 'linked_existing';

    if (user.auth_user_id && wasCreatedByCloudAdmin) {
        const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(user.auth_user_id);
        if (authError) throw authError;
    }
}

export async function createSupportDepartment(input: SupportDepartmentInput): Promise<SupportDepartment> {
    const code = normalizeCode(input.code);
    if (!code || !input.name.trim()) throw new Error('Código y nombre del departamento son requeridos.');
    const { data, error } = await supabaseAdmin
        .from('support_teams')
        .insert({
            code,
            name: input.name.trim(),
            description: input.description?.trim() || null,
            is_active: input.isActive ?? true,
        })
        .select('*')
        .single();
    if (error) throw error;
    return data as SupportDepartment;
}

export async function updateSupportDepartment(
    departmentId: string,
    input: Omit<SupportDepartmentInput, 'code'>,
): Promise<SupportDepartment> {
    if (!input.name.trim()) throw new Error('El nombre del departamento es requerido.');
    const { data, error } = await supabaseAdmin
        .from('support_teams')
        .update({
            name: input.name.trim(),
            description: input.description?.trim() || null,
            is_active: input.isActive ?? true,
        })
        .eq('id', departmentId)
        .select('*')
        .single();
    if (error) throw error;
    return data as SupportDepartment;
}

async function getProfile(profileId: string): Promise<CloudAdminProfile> {
    const { data, error } = await supabaseAdmin
        .from('cloud_admin_profiles')
        .select('*')
        .eq('id', profileId)
        .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Perfil no encontrado.');
    return {
        ...(data as CloudAdminProfile),
        permissions: normalizePermissions(((data as CloudAdminProfile).permissions || {})),
    };
}

export const accessService = {
    getAccessOverview,
    createProfile,
    updateProfile,
    deleteProfile,
    createCloudAdminUser,
    updateCloudAdminUser,
    deleteCloudAdminUser,
    createSupportDepartment,
    updateSupportDepartment,
};
