import type { IncomingMessage, ServerResponse } from 'node:http';
import { requireCloudAdminPermission, requireCloudAdminSession, CloudAdminAuthError, type AnySupabaseClient } from '../lib/cloud-admin-session.js';
import { tenantService } from '../../src/lib/tenantService.js';
import { getOperationalObservability } from '../../src/lib/observabilityService.js';

type ApiRequest = IncomingMessage & { body?: unknown; method?: string };
type CommandBody = { action?: unknown; payload?: unknown };

const permissions: Record<string, string> = {
    get_tenants: 'tenants_view',
    get_distributors: 'tenants_view',
    get_tenant_terminal_overview: 'tenants_view',
    get_terminal_device_audit: 'tenants_view',
    get_tenant_pos_license_seats: 'licenses_view',
    get_dashboard_stats: 'dashboard_view',
    get_operational_observability: 'observability_view',
    get_integration_configuration: 'settings_view',
    create_tenant: 'tenants_manage',
    update_tenant_tax_id: 'tenants_manage',
    update_tenant: 'tenants_manage',
    suspend_tenant: 'tenants_manage',
    reactivate_tenant: 'tenants_manage',
    update_tenant_credentials: 'tenants_manage',
    sync_terminal_authorized_device: 'terminal_reauthorization',
    release_terminal_license_slot: 'licenses_manage',
    enforce_tenant_pos_license_limits: 'licenses_manage',
    release_pos_only_provisioning_block: 'tenants_manage',
    toggle_terminal_active_status: 'tenants_manage',
    register_tenant_server_endpoint: 'tenants_manage',
    delete_tenant: 'tenants_delete',
};

function sendJson(response: ServerResponse, status: number, body: unknown) {
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    response.end(JSON.stringify(body));
}

async function readBody(request: ApiRequest): Promise<CommandBody> {
    if (request.body) return (typeof request.body === 'string' ? JSON.parse(request.body) : request.body) as CommandBody;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) as CommandBody : {};
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} es requerido.`);
    return value.trim();
}

async function execute(action: string, payload: Record<string, unknown>, admin: AnySupabaseClient) {
    switch (action) {
        case 'get_tenants': return tenantService.getTenants();
        case 'get_distributors': return tenantService.getDistributors();
        case 'get_tenant_terminal_overview': return tenantService.getTenantTerminalOverview(text(payload.tenantId, 'tenantId'));
        case 'get_terminal_device_audit': return tenantService.getTerminalDeviceAudit(text(payload.tenantId, 'tenantId'), text(payload.terminalId, 'terminalId'), Number(payload.limit) || 20);
        case 'get_tenant_pos_license_seats': return tenantService.getTenantPosLicenseSeats(text(payload.tenantId, 'tenantId'));
        case 'get_dashboard_stats': return tenantService.getDashboardStats();
        case 'get_operational_observability': return getOperationalObservability(record(payload.filters) as never);
        case 'get_integration_configuration': {
            const [settingsResult, secretsResult] = await Promise.all([
                admin.from('support_integration_settings').select('*').eq('id', 'helpdesk').maybeSingle(),
                admin.from('support_integration_secrets').select('provider,secret_last4,updated_at'),
            ]);
            if (settingsResult.error) throw settingsResult.error;
            if (secretsResult.error) throw secretsResult.error;
            return { settings: settingsResult.data, secrets: secretsResult.data || [] };
        }
        case 'create_tenant': return tenantService.createTenant(record(payload.input) as never);
        case 'update_tenant_tax_id': return tenantService.updateTenantTaxId(text(payload.id, 'id'), text(payload.taxId, 'taxId'));
        case 'update_tenant': return tenantService.updateTenant(text(payload.id, 'id'), record(payload.update) as never);
        case 'suspend_tenant': return tenantService.suspendTenant(text(payload.id, 'id'));
        case 'reactivate_tenant': return tenantService.reactivateTenant(text(payload.id, 'id'));
        case 'update_tenant_credentials': return tenantService.updateTenantCredentials(text(payload.tenantId, 'tenantId'), record(payload.update));
        case 'sync_terminal_authorized_device': return tenantService.syncTerminalAuthorizedDevice(record(payload.input) as never);
        case 'release_terminal_license_slot': return tenantService.releaseTerminalLicenseSlot(record(payload.input) as never);
        case 'enforce_tenant_pos_license_limits': return tenantService.enforceTenantPosLicenseLimits(text(payload.tenantId, 'tenantId'));
        case 'release_pos_only_provisioning_block': return tenantService.releasePosOnlyProvisioningBlock(text(payload.tenantId, 'tenantId'));
        case 'toggle_terminal_active_status': return tenantService.toggleTerminalActiveStatus(text(payload.terminalId, 'terminalId'), payload.isActive === true);
        case 'register_tenant_server_endpoint': return tenantService.registerTenantServerEndpoint(record(payload.input) as never);
        case 'delete_tenant': {
            const tenantId = text(payload.tenantId, 'tenantId');
            const tenant = (await tenantService.getTenants()).find((item) => item.id === tenantId);
            if (!tenant) throw new Error('Tenant no encontrado.');
            return tenantService.deleteTenant(tenant);
        }
        default: throw new Error('Acción administrativa no permitida.');
    }
}

export default async function handler(request: ApiRequest, response: ServerResponse) {
    if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
        return;
    }

    try {
        const body = await readBody(request);
        const action = text(body.action, 'action');
        const payload = record(body.payload);

        if (action === 'session') {
            const session = await requireCloudAdminSession(request.headers);
            const { data: adminUser, error } = await session.admin
                .from('cloud_admin_users')
                .select('*')
                .eq('id', session.actor.id)
                .maybeSingle();
            if (error) throw error;
            const profileId = (adminUser as { profile_id?: string | null } | null)?.profile_id;
            const profileResult = profileId
                ? await session.admin.from('cloud_admin_profiles').select('*').eq('id', profileId).maybeSingle()
                : { data: null, error: null };
            if (profileResult.error) throw profileResult.error;
            sendJson(response, 200, { data: { adminUser, profile: profileResult.data } });
            return;
        }

        const permission = permissions[action];
        if (!permission) throw new CloudAdminAuthError(403, 'FORBIDDEN', 'Acción administrativa no permitida.');
        const session = await requireCloudAdminPermission(request.headers, permission);
        const data = await execute(action, payload, session.admin);
        sendJson(response, 200, { data: data ?? null });
    } catch (error) {
        if (error instanceof CloudAdminAuthError) {
            sendJson(response, error.status, { error: error.code, message: error.message });
            return;
        }
        console.error('[admin-command] failed', error);
        sendJson(response, 500, { error: 'ADMIN_COMMAND_FAILED', message: error instanceof Error ? error.message : 'Error interno.' });
    }
}
