import type { CloudAdminPermissionKey, CloudAdminPermissions } from '../types';

const legacyPermissionFallback: Partial<Record<CloudAdminPermissionKey, CloudAdminPermissionKey>> = {
    dashboard_view: 'dashboard',
    tenants_view: 'tenants',
    tenants_manage: 'tenants',
    tenants_delete: 'kill_switch',
    plans_view: 'plans',
    plans_manage: 'plans',
    support_view: 'support',
    support_manage: 'support',
    knowledge_view: 'support',
    knowledge_manage: 'support',
    calendar_view: 'support',
    calendar_manage: 'support',
    improvements_view: 'improvements',
    improvements_manage: 'improvements',
    internal_requests_view: 'improvements',
    internal_requests_manage: 'improvements',
    apk_view: 'apk',
    apk_manage: 'apk',
    observability_view: 'observability',
    billing_view: 'billing',
    billing_manage: 'billing',
    settings_view: 'settings',
    settings_manage: 'settings',
    kill_switch_execute: 'kill_switch',
    users_view: 'users',
    users_manage: 'users',
    profiles_manage: 'users',
    licenses_view: 'plans_view',
    licenses_manage: 'plans_manage',
    // La reconciliación se agregó después; quien ya reautoriza dispositivos
    // puede reconciliar sin esperar una migración de perfiles.
    terminal_reconciliation: 'terminal_reauthorization',
};

export function hasCloudAdminPermission(
    permissions: Partial<CloudAdminPermissions> | null | undefined,
    permission: CloudAdminPermissionKey,
) {
    if (!permissions) return false;
    if (typeof permissions[permission] === 'boolean') return permissions[permission] === true;
    const fallback = legacyPermissionFallback[permission];
    return fallback ? permissions[fallback] === true : false;
}
