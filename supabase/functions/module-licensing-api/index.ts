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
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function text(value: unknown, max = 500) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function uuid(value: unknown) {
    const normalized = text(value, 64);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
        ? normalized
        : '';
}

function requestMeta(request: Request) {
    return {
        request_ip: text(request.headers.get('x-forwarded-for')?.split(',')[0], 120) || null,
        user_agent: text(request.headers.get('user-agent'), 500) || null,
    };
}

function normalizeSelections(value: unknown) {
    if (!Array.isArray(value)) throw new Error('La selección de módulos es inválida.');
    const seen = new Set<string>();
    return value.map((raw) => {
        const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as JsonRecord : {};
        const moduleCode = text(item.module_code, 80).toLowerCase().replace(/[^a-z0-9_]+/g, '');
        if (!moduleCode || seen.has(moduleCode)) throw new Error('La selección contiene módulos inválidos o duplicados.');
        seen.add(moduleCode);
        const licensedQuantity = Math.max(1, Math.min(1_000_000, Math.trunc(Number(item.licensed_quantity) || 1)));
        return {
            module_code: moduleCode,
            enabled: item.enabled === true,
            licensed_quantity: licensedQuantity,
        };
    }).slice(0, 100);
}

async function loadOverview(client: ReturnType<typeof createCloudAdminClient>, tenantId: string) {
    const [tenantResult, catalogResult, dependencyResult, entitlementResult] = await Promise.all([
        client.from('tenants')
            .select('id, name, type, contracted_product, erp_ui_enabled, customer_erp_access')
            .eq('id', tenantId)
            .maybeSingle(),
        client.from('erp_module_catalog').select('*').eq('is_active', true).order('display_order').order('name'),
        client.from('erp_module_dependencies').select('module_code, required_module_code'),
        client.from('tenant_erp_module_entitlements').select('*').eq('tenant_id', tenantId),
    ]);

    for (const result of [tenantResult, catalogResult, dependencyResult, entitlementResult]) {
        if (result.error) throw result.error;
    }
    if (!tenantResult.data) throw new Error('Tenant no encontrado.');

    const tenant = tenantResult.data;
    const erpEnabled = tenant.erp_ui_enabled === true || ['full', 'erp_only'].includes(String(tenant.type ?? ''));
    return {
        tenant: { ...tenant, erp_enabled: erpEnabled },
        modules: catalogResult.data ?? [],
        dependencies: dependencyResult.data ?? [],
        entitlements: entitlementResult.data ?? [],
    };
}

async function audit(
    client: ReturnType<typeof createCloudAdminClient>,
    request: Request,
    actor: CloudAdminActor,
    tenantId: string,
    selections: Array<{ module_code: string; enabled: boolean; licensed_quantity: number }>,
) {
    const { error } = await client.from('cloud_admin_audit_log').insert({
        actor_admin_user_id: actor.id,
        actor_auth_user_id: actor.authUserId,
        actor_email: actor.email,
        action: 'tenant.erp_modules.update',
        entity_type: 'tenant',
        entity_id: tenantId,
        after_data: { modules: selections },
        ...requestMeta(request),
    });
    if (error) throw error;
}

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    try {
        const payload = await request.json().catch(() => ({})) as JsonRecord;
        const action = text(payload.action, 80);
        const actor = await requireCloudAdminActor(request, action === 'save' ? 'licenses_manage' : 'licenses_view');
        const tenantId = uuid(payload.tenant_id);
        if (!tenantId) return json({ error: 'tenant_id inválido.' }, 400);

        const client = createCloudAdminClient();
        if (action === 'overview') return json(await loadOverview(client, tenantId));

        if (action === 'save') {
            const selections = normalizeSelections(payload.entitlements);
            const before = await loadOverview(client, tenantId);
            if (!before.tenant.erp_enabled && selections.some((selection) => selection.enabled)) {
                throw new Error('Activa ALFA-RMS y guarda el tenant antes de habilitar módulos adicionales.');
            }

            const { error } = await client.rpc('apply_tenant_erp_module_entitlements', {
                p_tenant_id: tenantId,
                p_entitlements: selections,
                p_actor_admin_user_id: actor.id,
                p_actor_email: actor.email,
            });
            if (error) throw error;
            await audit(client, request, actor, tenantId, selections);
            return json(await loadOverview(client, tenantId));
        }

        return json({ error: 'Unknown action' }, 400);
    } catch (error) {
        console.error('module-licensing-api', error);
        const rawMessage = error instanceof Error ? error.message : String(error ?? 'Unknown error');
        const message = rawMessage.includes('ERP_MODULE_DEPENDENCY_REQUIRED')
            ? 'La selección no incluye todos los módulos requeridos.'
            : rawMessage.includes('ERP_REQUIRED_FOR_MODULES')
                ? 'ALFA-RMS debe estar activo antes de habilitar módulos.'
                : rawMessage;
        return json(
            { error: message },
            isCloudAdminAuthorizationError(error) ? (/forbidden/i.test(rawMessage) ? 403 : 401) : 400,
        );
    }
});
