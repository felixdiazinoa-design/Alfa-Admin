import { supabase, supabaseAdmin, supabaseProjectUrl } from './supabase.js';
import { invokeAdminCommand } from './adminApi.js';
import type {
    CloudChannel,
    ContractedProduct,
    Tenant,
    TenantTerminalErpReadiness,
    TenantTerminalRegistryEntry,
} from '../types.js';

export type ObservabilityStatus = 'OK' | 'ATTENTION' | 'CRITICAL';
export type ObservabilityPeriod = '24h' | '7d' | '30d';

export interface ObservabilityFilters {
    period: ObservabilityPeriod;
    tenantId?: string;
    contractedProduct?: ContractedProduct | 'ALL';
    cloudChannel?: CloudChannel | 'ALL';
}

export interface EndpointMetric {
    endpoint: string;
    calls: number;
    errors: number;
    avgDurationMs?: number | null;
    cacheHitRate?: number | null;
}

export interface ObservabilityTerminalRow {
    id: string;
    tenantId: string;
    tenantName: string;
    terminalId: string;
    terminalName: string;
    deviceId: string;
    authorizedDeviceId: string;
    cloudChannel: CloudChannel | 'N/D';
    status: ObservabilityStatus;
    online: boolean;
    lastSeenAt?: string | null;
    lastSyncAt?: string | null;
    syncStatus: string;
    pendingDocuments: number;
    errorDocuments: number;
    retries: number;
    lastError?: string | null;
    suggestions: string[];
}

export interface TenantObservabilityRow {
    tenantId: string;
    tenantName: string;
    contractedProduct: ContractedProduct | 'N/D';
    cloudChannel: CloudChannel | 'N/D';
    status: ObservabilityStatus;
    terminalsTotal: number;
    terminalsOnline: number;
    terminalsOffline: number;
    lastSyncAt?: string | null;
    recentErrors: number;
    posEvents: number;
    apiCalls: number;
    blockedEvents: number;
    pendingEvents: number;
    supabaseEstimatedUnits: number;
    alerts: string[];
    endpoints: EndpointMetric[];
    terminals: ObservabilityTerminalRow[];
}

export interface ObservabilitySummary {
    tenants: number;
    terminals: number;
    terminalsOnline: number;
    terminalsOffline: number;
    ok: number;
    attention: number;
    critical: number;
    posEvents: number;
    apiCalls: number;
    recentErrors: number;
    supabaseEstimatedUnits: number;
}

export interface OperationalObservability {
    generatedAt: string;
    period: ObservabilityPeriod;
    summary: ObservabilitySummary;
    tenants: TenantObservabilityRow[];
    topEndpoints: EndpointMetric[];
    telemetryConfigured: boolean;
    telemetryMessage?: string | null;
}

interface PublicTerminalRow {
    id: string;
    tenant_id: string;
    device_id?: string | null;
    code?: string | null;
    name?: string | null;
    is_active?: boolean | null;
    last_checkin_at?: string | null;
    created_at?: string | null;
}

interface ErpTenantRow {
    id: string;
    name?: string | null;
    config?: Record<string, unknown> | null;
}

interface ErpStoreRow {
    id: string;
    tenant_id: string;
}

interface ErpTerminalRow {
    id: string;
    store_id: string;
    device_id?: string | null;
    name?: string | null;
    config?: Record<string, unknown> | null;
    last_seen?: string | null;
    created_at?: string | null;
}

interface SupportTicketMetricRow {
    id: string;
    tenant_id?: string | null;
    status?: string | null;
    priority?: string | null;
    created_at?: string | null;
}

interface AuditMetricRow {
    tenant_id?: string | null;
    terminal_id?: string | null;
    event?: string | null;
    action?: string | null;
    erp_response_status?: number | null;
    erp_error_code?: string | null;
    result?: string | null;
    created_at?: string | null;
    performed_at?: string | null;
}

interface ErpTelemetryTenant {
    tenant_id?: string;
    cloud_admin_tenant_id?: string;
    api_calls?: number;
    apiCalls?: number;
    pos_events?: number;
    posEvents?: number;
    errors?: number;
    blocked_events?: number;
    blockedEvents?: number;
    pending_events?: number;
    pendingEvents?: number;
    endpoints?: EndpointMetric[];
    terminals?: Array<{
        terminal_id?: string;
        terminalId?: string;
        device_id?: string;
        deviceId?: string;
        pending_documents?: number;
        pendingDocuments?: number;
        error_documents?: number;
        errorDocuments?: number;
        retries?: number;
        last_error?: string | null;
        lastError?: string | null;
        last_sync_at?: string | null;
        lastSyncAt?: string | null;
    }>;
}

interface ErpTelemetryPayload {
    configured?: boolean;
    message?: string | null;
    tenants?: ErpTelemetryTenant[];
    endpoints?: EndpointMetric[];
}

const periodDays: Record<ObservabilityPeriod, number> = {
    '24h': 1,
    '7d': 7,
    '30d': 30,
};

function toDate(value?: string | null): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function maxIso(...values: Array<string | null | undefined>): string | null {
    const dates = values
        .map(toDate)
        .filter((date): date is Date => Boolean(date))
        .sort((a, b) => b.getTime() - a.getTime());
    return dates[0]?.toISOString() || null;
}

function asNumber(value: unknown, fallback = 0): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

function normalizeStatus(value?: string | null): string {
    return (value || '').trim().toUpperCase();
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function isUuidLike(value?: string | null): boolean {
    return Boolean(value?.trim())
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value!.trim());
}

function firstHumanLabel(...values: Array<unknown>): string | null {
    for (const value of values) {
        const text = asText(value);
        if (text && !isUuidLike(text)) return text;
    }
    return null;
}

function getLatestRegistry(registries: TenantTerminalRegistryEntry[]): TenantTerminalRegistryEntry | null {
    return [...registries].sort((a, b) => {
        const aTime = toDate(a.last_seen_at || a.updated_at || a.created_at || null)?.getTime() || 0;
        const bTime = toDate(b.last_seen_at || b.updated_at || b.created_at || null)?.getTime() || 0;
        return bTime - aTime;
    })[0] || null;
}

function getRegistryLogicalTerminalKey(registry: TenantTerminalRegistryEntry): string {
    return normalizeStatus(registry.terminal_id || registry.terminal_name || registry.device_id || registry.id);
}

function getErpTerminalConfig(terminal: ErpTerminalRow): Record<string, unknown> {
    return asRecord(terminal.config);
}

function getErpTerminalMetadata(terminal: ErpTerminalRow): Record<string, unknown> {
    return asRecord(getErpTerminalConfig(terminal).metadata);
}

function getErpTerminalCode(terminal: ErpTerminalRow): string | null {
    const config = getErpTerminalConfig(terminal);
    const metadata = getErpTerminalMetadata(terminal);
    return firstHumanLabel(
        config.station_number,
        config.stationNumber,
        metadata.terminal_code,
        metadata.terminalCode,
        metadata.station_number,
        metadata.stationNumber,
    );
}

function getErpTerminalName(terminal: ErpTerminalRow): string {
    const config = getErpTerminalConfig(terminal);
    const metadata = getErpTerminalMetadata(terminal);
    return firstHumanLabel(
        terminal.name,
        metadata.terminal_name,
        metadata.terminalName,
        metadata.display_name,
        metadata.displayName,
        config.terminal_name,
        config.terminalName,
        config.display_name,
        config.displayName,
        getErpTerminalCode(terminal),
    ) || 'Terminal ERP';
}

function isArchivedErpTerminal(terminal: ErpTerminalRow): boolean {
    const config = getErpTerminalConfig(terminal);
    const metadata = getErpTerminalMetadata(terminal);
    const terminalName = asText(terminal.name).toUpperCase();
    const deviceId = asText(terminal.device_id).toUpperCase();

    return terminalName.startsWith('ARCHIVED-')
        || deviceId.startsWith('ARCHIVED-')
        || config.active === false
        || config.is_active === false
        || config.archived === true
        || metadata.archived === true;
}

function getErpTerminalGroupKey(terminal: ErpTerminalRow): string {
    return normalizeStatus(getErpTerminalCode(terminal) || getErpTerminalName(terminal) || terminal.id);
}

function dedupeErpTerminals(terminals: ErpTerminalRow[]): ErpTerminalRow[] {
    const groups = new Map<string, ErpTerminalRow[]>();
    for (const terminal of terminals) {
        const key = getErpTerminalGroupKey(terminal);
        const list = groups.get(key) || [];
        list.push(terminal);
        groups.set(key, list);
    }

    return Array.from(groups.values()).map((group) => (
        [...group].sort((a, b) => {
            const aTime = toDate(a.last_seen || a.created_at || null)?.getTime() || 0;
            const bTime = toDate(b.last_seen || b.created_at || null)?.getTime() || 0;
            return bTime - aTime;
        })[0]
    ));
}

function getReadinessCheck(readiness: TenantTerminalErpReadiness | null | undefined, key: string): boolean | null {
    const checks = readiness?.checks;
    if (!checks || typeof checks !== 'object') return null;
    const value = (checks as Record<string, unknown>)[key];
    return typeof value === 'boolean' ? value : null;
}

function getReadinessStatus(readiness: TenantTerminalErpReadiness | null | undefined): string {
    return normalizeStatus(readiness?.status || readiness?.profileStatus || readiness?.profile_status) || 'N/D';
}

function isTerminalOnline(registry: TenantTerminalRegistryEntry | null | undefined, terminal?: PublicTerminalRow | null): boolean {
    const registryStatus = normalizeStatus(registry?.status);
    if (registryStatus === 'ONLINE') return true;

    const lastSeen = toDate(registry?.last_seen_at || terminal?.last_checkin_at || null);
    if (!lastSeen) return false;
    return Date.now() - lastSeen.getTime() <= 15 * 60 * 1000;
}

function getTerminalDeviceId(registry: TenantTerminalRegistryEntry | null | undefined, terminal?: PublicTerminalRow | null): string {
    return registry?.current_device_id
        || registry?.device_id
        || terminal?.device_id
        || 'N/D';
}

function getAuthorizedDeviceId(registry: TenantTerminalRegistryEntry | null | undefined, terminal?: PublicTerminalRow | null): string {
    return registry?.authorized_device_id
        || registry?.current_device_id
        || registry?.device_id
        || terminal?.device_id
        || 'N/D';
}

function getTerminalKey(terminalId: string, deviceId: string) {
    return `${normalizeStatus(terminalId)}::${normalizeStatus(deviceId)}`;
}

function mergeEndpointMetrics(items: EndpointMetric[]): EndpointMetric[] {
    const byEndpoint = new Map<string, EndpointMetric & { durationWeight: number; cacheWeight: number }>();

    for (const item of items) {
        const endpoint = item.endpoint || 'N/D';
        const current = byEndpoint.get(endpoint) || {
            endpoint,
            calls: 0,
            errors: 0,
            avgDurationMs: null,
            cacheHitRate: null,
            durationWeight: 0,
            cacheWeight: 0,
        };
        const calls = asNumber(item.calls);
        current.calls += calls;
        current.errors += asNumber(item.errors);

        if (typeof item.avgDurationMs === 'number') {
            current.avgDurationMs = ((current.avgDurationMs || 0) * current.durationWeight + item.avgDurationMs * Math.max(calls, 1))
                / (current.durationWeight + Math.max(calls, 1));
            current.durationWeight += Math.max(calls, 1);
        }
        if (typeof item.cacheHitRate === 'number') {
            current.cacheHitRate = ((current.cacheHitRate || 0) * current.cacheWeight + item.cacheHitRate * Math.max(calls, 1))
                / (current.cacheWeight + Math.max(calls, 1));
            current.cacheWeight += Math.max(calls, 1);
        }
        byEndpoint.set(endpoint, current);
    }

    return Array.from(byEndpoint.values())
        .map((item) => ({
            endpoint: item.endpoint,
            calls: item.calls,
            errors: item.errors,
            avgDurationMs: item.avgDurationMs,
            cacheHitRate: item.cacheHitRate,
        }))
        .sort((a, b) => b.calls - a.calls || b.errors - a.errors);
}

async function safeSelect<T>(query: PromiseLike<{ data: unknown; error: unknown }>, label: string): Promise<T[]> {
    const { data, error } = await query;
    if (error) {
        console.warn(`Observability source unavailable: ${label}`, error);
        return [];
    }
    return (data as T[]) || [];
}

async function loadErpTelemetry(): Promise<ErpTelemetryPayload> {
    const endpoint = `${supabaseProjectUrl.replace(/\/$/, '')}/functions/v1/get-operational-telemetry`;
    try {
        const accessToken = typeof window === 'undefined'
            ? (globalThis as typeof globalThis & {
                process?: { env?: Record<string, string | undefined> };
            }).process?.env?.SUPABASE_SERVICE_ROLE_KEY
            : (await supabase.auth.getSession()).data.session?.access_token;
        if (!accessToken) throw new Error('Sesión administrativa requerida.');
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'X-Actor-Source': 'cloud-admin-ui',
            },
        });
        const payload = await response.json().catch(() => null) as ErpTelemetryPayload | null;
        if (!response.ok) {
            return {
                configured: false,
                message: payload?.message || 'No se pudo cargar telemetria ERP opcional.',
            };
        }
        return payload || { configured: false };
    } catch (error) {
        console.warn('ERP telemetry optional source unavailable:', error);
        return {
            configured: false,
            message: 'Telemetria ERP opcional no disponible.',
        };
    }
}

export async function getOperationalObservability(filters: ObservabilityFilters): Promise<OperationalObservability> {
    if (typeof window !== 'undefined') {
        return invokeAdminCommand('get_operational_observability', { filters });
    }
    const since = new Date(Date.now() - periodDays[filters.period] * 86400000);
    const [tenants, publicTerminals, erpTenants, erpStores, erpTerminals, registryRows, supportTickets, takeoverAudits, deviceAudits, telemetry] = await Promise.all([
        safeSelect<Tenant>(
            supabaseAdmin
                .from('tenants')
                .select('*')
                .order('name', { ascending: true }),
            'landlord.tenants',
        ),
        safeSelect<PublicTerminalRow>(
            supabaseAdmin
                .schema('public')
                .from('terminals')
                .select('id,tenant_id,code,name,is_active,last_checkin_at,created_at'),
            'public.terminals',
        ),
        safeSelect<ErpTenantRow>(
            supabaseAdmin
                .schema('public')
                .from('erp_tenants')
                .select('id,name,config'),
            'public.erp_tenants',
        ),
        safeSelect<ErpStoreRow>(
            supabaseAdmin
                .schema('public')
                .from('erp_stores')
                .select('id,tenant_id'),
            'public.erp_stores',
        ),
        safeSelect<ErpTerminalRow>(
            supabaseAdmin
                .schema('public')
                .from('erp_terminals')
                .select('id,store_id,device_id,name,config,last_seen,created_at'),
            'public.erp_terminals',
        ),
        safeSelect<TenantTerminalRegistryEntry>(
            supabaseAdmin
                .from('tenant_server_registry')
                .select('*'),
            'landlord.tenant_server_registry',
        ),
        safeSelect<SupportTicketMetricRow>(
            supabaseAdmin
                .from('support_tickets')
                .select('id,tenant_id,status,priority,created_at')
                .gte('created_at', since.toISOString()),
            'landlord.support_tickets',
        ),
        safeSelect<AuditMetricRow>(
            supabaseAdmin
                .from('terminal_takeover_audit')
                .select('tenant_id,terminal_id,event,erp_response_status,erp_error_code,created_at')
                .gte('created_at', since.toISOString()),
            'landlord.terminal_takeover_audit',
        ),
        safeSelect<AuditMetricRow>(
            supabaseAdmin
                .from('terminal_device_audit')
                .select('tenant_id,terminal_id,action,result,erp_response_status,erp_error_code,performed_at')
                .gte('performed_at', since.toISOString()),
            'landlord.terminal_device_audit',
        ),
        loadErpTelemetry(),
    ]);

    const telemetryTenants = new Map<string, ErpTelemetryTenant>();
    for (const item of telemetry.tenants || []) {
        const tenantId = item.tenant_id || item.cloud_admin_tenant_id;
        if (tenantId) telemetryTenants.set(tenantId, item);
    }

    const terminalsByTenant = new Map<string, PublicTerminalRow[]>();
    for (const terminal of publicTerminals) {
        const list = terminalsByTenant.get(terminal.tenant_id) || [];
        list.push(terminal);
        terminalsByTenant.set(terminal.tenant_id, list);
    }

    const erpTenantToCloudTenant = new Map<string, string>();
    for (const erpTenant of erpTenants) {
        const cloudAdminTenantId = asText(asRecord(erpTenant.config).cloudAdminTenantId);
        if (cloudAdminTenantId) erpTenantToCloudTenant.set(erpTenant.id, cloudAdminTenantId);
    }

    const erpStoreToCloudTenant = new Map<string, string>();
    for (const store of erpStores) {
        const cloudTenantId = erpTenantToCloudTenant.get(store.tenant_id);
        if (cloudTenantId) erpStoreToCloudTenant.set(store.id, cloudTenantId);
    }

    const erpTerminalsByTenant = new Map<string, ErpTerminalRow[]>();
    for (const terminal of erpTerminals) {
        if (isArchivedErpTerminal(terminal)) continue;

        const cloudTenantId = erpStoreToCloudTenant.get(terminal.store_id);
        if (!cloudTenantId) continue;
        const list = erpTerminalsByTenant.get(cloudTenantId) || [];
        list.push(terminal);
        erpTerminalsByTenant.set(cloudTenantId, list);
    }

    const registryByTenant = new Map<string, TenantTerminalRegistryEntry[]>();
    for (const registry of registryRows) {
        const list = registryByTenant.get(registry.tenant_id) || [];
        list.push(registry);
        registryByTenant.set(registry.tenant_id, list);
    }

    const supportErrorsByTenant = new Map<string, number>();
    for (const ticket of supportTickets) {
        if (!ticket.tenant_id) continue;
        const open = !['CERRADO', 'RESUELTO'].includes(normalizeStatus(ticket.status));
        const critical = normalizeStatus(ticket.priority).startsWith('CR');
        supportErrorsByTenant.set(ticket.tenant_id, (supportErrorsByTenant.get(ticket.tenant_id) || 0) + (open && critical ? 2 : open ? 1 : 0));
    }

    const audits = [...takeoverAudits, ...deviceAudits];
    const auditErrorsByTenant = new Map<string, number>();
    const auditEventsByTenant = new Map<string, number>();
    for (const audit of audits) {
        if (!audit.tenant_id) continue;
        const httpStatus = audit.erp_response_status || 0;
        const hasError = Boolean(audit.erp_error_code) || httpStatus >= 400 || normalizeStatus(audit.result).includes('ERROR');
        auditEventsByTenant.set(audit.tenant_id, (auditEventsByTenant.get(audit.tenant_id) || 0) + 1);
        if (hasError) {
            auditErrorsByTenant.set(audit.tenant_id, (auditErrorsByTenant.get(audit.tenant_id) || 0) + 1);
        }
    }

    const selectedTenants = tenants.filter((tenant) => {
        if (filters.tenantId && tenant.id !== filters.tenantId) return false;
        if (filters.contractedProduct && filters.contractedProduct !== 'ALL' && tenant.contracted_product !== filters.contractedProduct) return false;
        if (filters.cloudChannel && filters.cloudChannel !== 'ALL' && tenant.cloud_channel !== filters.cloudChannel) return false;
        return true;
    });

    const tenantRows = selectedTenants.map((tenant) => {
        const tenantTerminals = terminalsByTenant.get(tenant.id) || [];
        const tenantErpTerminals = dedupeErpTerminals(erpTerminalsByTenant.get(tenant.id) || []);
        const tenantRegistry = registryByTenant.get(tenant.id) || [];
        const telemetryTenant = telemetryTenants.get(tenant.id);
        const telemetryTerminalRows = new Map<string, NonNullable<ErpTelemetryTenant['terminals']>[number]>();
        for (const terminal of telemetryTenant?.terminals || []) {
            const terminalId = terminal.terminal_id || terminal.terminalId || '';
            const deviceId = terminal.device_id || terminal.deviceId || '';
            telemetryTerminalRows.set(getTerminalKey(terminalId, deviceId), terminal);
            if (terminalId) telemetryTerminalRows.set(getTerminalKey(terminalId, ''), terminal);
            if (deviceId) telemetryTerminalRows.set(getTerminalKey('', deviceId), terminal);
        }

        const matchedRegistryKeys = new Set<string>();
        const terminalRows: ObservabilityTerminalRow[] = [];

        if (tenant.contracted_product === 'POS_ERP' && tenantErpTerminals.length > 0) {
            for (const erpTerminal of tenantErpTerminals) {
                const terminalCode = getErpTerminalCode(erpTerminal);
                const terminalName = getErpTerminalName(erpTerminal);
                const matchingRegistries = tenantRegistry.filter((item) => (
                    item.terminal_id === erpTerminal.id
                    || item.device_id === erpTerminal.device_id
                    || item.terminal_name === erpTerminal.name
                    || item.terminal_name === terminalName
                    || item.terminal_name === terminalCode
                ));
                for (const registry of matchingRegistries) {
                    matchedRegistryKeys.add(getRegistryLogicalTerminalKey(registry));
                }
                const registry = getLatestRegistry(matchingRegistries);
                const terminal: PublicTerminalRow = {
                    id: erpTerminal.id,
                    tenant_id: tenant.id,
                    device_id: erpTerminal.device_id || null,
                    code: terminalCode,
                    name: terminalName,
                    is_active: true,
                    last_checkin_at: erpTerminal.last_seen || null,
                    created_at: erpTerminal.created_at || null,
                };
                terminalRows.push(buildTerminalRow(tenant, terminal, registry, telemetryTerminalRows));
            }
        } else {
            for (const terminal of tenantTerminals) {
                const matchingRegistries = tenantRegistry.filter((item) => (
                    item.terminal_id === terminal.id
                    || item.device_id === terminal.device_id
                    || item.terminal_name === terminal.name
                    || item.terminal_name === terminal.code
                ));
                for (const registry of matchingRegistries) {
                    matchedRegistryKeys.add(getRegistryLogicalTerminalKey(registry));
                }
                const registry = getLatestRegistry(matchingRegistries);
                terminalRows.push(buildTerminalRow(tenant, terminal, registry, telemetryTerminalRows));
            }
        }

        const orphanRegistryGroups = new Map<string, TenantTerminalRegistryEntry[]>();
        for (const registry of tenantRegistry) {
            const key = getRegistryLogicalTerminalKey(registry);
            if (matchedRegistryKeys.has(key)) continue;
            if (tenant.contracted_product === 'POS_ERP' && tenantErpTerminals.length > 0) continue;
            const list = orphanRegistryGroups.get(key) || [];
            list.push(registry);
            orphanRegistryGroups.set(key, list);
        }

        for (const registries of orphanRegistryGroups.values()) {
            terminalRows.push(buildTerminalRow(tenant, null, getLatestRegistry(registries), telemetryTerminalRows));
        }

        const terminalsOnline = terminalRows.filter((terminal) => terminal.online).length;
        const terminalsOffline = Math.max(terminalRows.length - terminalsOnline, 0);
        const lastSyncAt = maxIso(
            tenant.last_sync_received_at,
            ...terminalRows.map((terminal) => terminal.lastSyncAt || terminal.lastSeenAt || null),
        );
        const telemetryApiCalls = asNumber(telemetryTenant?.api_calls ?? telemetryTenant?.apiCalls);
        const telemetryPosEvents = asNumber(telemetryTenant?.pos_events ?? telemetryTenant?.posEvents);
        const blockedEvents = asNumber(tenant.blocked_events_count) + asNumber(telemetryTenant?.blocked_events ?? telemetryTenant?.blockedEvents);
        const pendingEvents = asNumber(tenant.pending_events_count) + asNumber(telemetryTenant?.pending_events ?? telemetryTenant?.pendingEvents);
        const recentErrors = asNumber(telemetryTenant?.errors)
            + (supportErrorsByTenant.get(tenant.id) || 0)
            + (auditErrorsByTenant.get(tenant.id) || 0)
            + terminalRows.filter((terminal) => terminal.status === 'CRITICAL').length * 2
            + terminalRows.filter((terminal) => terminal.status === 'ATTENTION').length;
        const posEvents = telemetryPosEvents + pendingEvents + blockedEvents + (auditEventsByTenant.get(tenant.id) || 0);
        const apiCalls = telemetryApiCalls;
        const endpoints = mergeEndpointMetrics(telemetryTenant?.endpoints || []);
        const alerts = buildTenantAlerts(tenant, terminalRows, pendingEvents, blockedEvents, recentErrors);
        const status = alerts.some((alert) => /bloquead|critico|crítico|suspend|token|device/i.test(alert))
            ? 'CRITICAL'
            : alerts.length > 0
                ? 'ATTENTION'
                : 'OK';

        return {
            tenantId: tenant.id,
            tenantName: tenant.name,
            contractedProduct: tenant.contracted_product || 'N/D',
            cloudChannel: tenant.cloud_channel || 'N/D',
            status,
            terminalsTotal: terminalRows.length,
            terminalsOnline,
            terminalsOffline,
            lastSyncAt,
            recentErrors,
            posEvents,
            apiCalls,
            blockedEvents,
            pendingEvents,
            supabaseEstimatedUnits: estimateSupabaseUnits({
                terminals: terminalRows.length,
                posEvents,
                apiCalls,
                errors: recentErrors,
            }),
            alerts,
            endpoints,
            terminals: terminalRows,
        } satisfies TenantObservabilityRow;
    });

    const summary = tenantRows.reduce<ObservabilitySummary>((acc, tenant) => {
        acc.tenants += 1;
        acc.terminals += tenant.terminalsTotal;
        acc.terminalsOnline += tenant.terminalsOnline;
        acc.terminalsOffline += tenant.terminalsOffline;
        acc.ok += tenant.status === 'OK' ? 1 : 0;
        acc.attention += tenant.status === 'ATTENTION' ? 1 : 0;
        acc.critical += tenant.status === 'CRITICAL' ? 1 : 0;
        acc.posEvents += tenant.posEvents;
        acc.apiCalls += tenant.apiCalls;
        acc.recentErrors += tenant.recentErrors;
        acc.supabaseEstimatedUnits += tenant.supabaseEstimatedUnits;
        return acc;
    }, {
        tenants: 0,
        terminals: 0,
        terminalsOnline: 0,
        terminalsOffline: 0,
        ok: 0,
        attention: 0,
        critical: 0,
        posEvents: 0,
        apiCalls: 0,
        recentErrors: 0,
        supabaseEstimatedUnits: 0,
    });

    return {
        generatedAt: new Date().toISOString(),
        period: filters.period,
        summary,
        tenants: tenantRows.sort((a, b) => statusWeight(b.status) - statusWeight(a.status) || b.recentErrors - a.recentErrors),
        topEndpoints: mergeEndpointMetrics([
            ...(telemetry.endpoints || []),
            ...tenantRows.flatMap((tenant) => tenant.endpoints),
        ]).slice(0, 8),
        telemetryConfigured: telemetry.configured === true,
        telemetryMessage: telemetry.message || null,
    };
}

function buildTerminalRow(
    tenant: Tenant,
    terminal: PublicTerminalRow | null,
    registry: TenantTerminalRegistryEntry | null,
    telemetryRows: Map<string, NonNullable<ErpTelemetryTenant['terminals']>[number]>,
): ObservabilityTerminalRow {
    const terminalId = terminal?.id || registry?.terminal_id || registry?.id || 'N/D';
    const deviceId = getTerminalDeviceId(registry, terminal);
    const telemetry = telemetryRows.get(getTerminalKey(terminalId, deviceId))
        || telemetryRows.get(getTerminalKey(terminalId, ''))
        || telemetryRows.get(getTerminalKey('', deviceId));
    const readiness = registry?.erp_readiness || null;
    const fiscalStatus = normalizeStatus(registry?.fiscal_readiness?.status || registry?.fiscal_readiness?.fiscal_readiness as string | undefined);
    const authStatus = normalizeStatus(registry?.auth_status);
    const online = isTerminalOnline(registry, terminal);
    const lastSyncAt = maxIso(
        telemetry?.last_sync_at || telemetry?.lastSyncAt || null,
        readiness?.lastSyncEventAt || readiness?.last_sync_event_at || null,
        registry?.last_seen_at || null,
        terminal?.last_checkin_at || null,
    );
    const pendingDocuments = asNumber(telemetry?.pending_documents ?? telemetry?.pendingDocuments);
    const errorDocuments = asNumber(telemetry?.error_documents ?? telemetry?.errorDocuments);
    const retries = asNumber(telemetry?.retries);
    const lastError = telemetry?.last_error || telemetry?.lastError || registry?.last_auth_error || readiness?.message || readiness?.error_code || null;
    const suggestions = buildTerminalSuggestions({
        authStatus,
        readiness,
        fiscalStatus,
        pendingDocuments,
        errorDocuments,
        lastError,
        online,
    });
    const status: ObservabilityStatus = authStatus === 'DEVICE_MISMATCH'
        || authStatus === 'ERP_AUTH_ERROR'
        || authStatus === 'TOKEN_ROTATION_REQUIRED'
        || authStatus === 'ERP_REPAIR_FAILED'
        || authStatus === 'BOUND_AUTH_MISMATCH'
        || normalizeStatus(readiness?.status) === 'ERROR'
        || errorDocuments > 0
        ? 'CRITICAL'
        : !online || suggestions.length > 0 || pendingDocuments > 0
            ? 'ATTENTION'
            : 'OK';

    return {
        id: `${tenant.id}-${terminalId}-${deviceId}`,
        tenantId: tenant.id,
        tenantName: tenant.name,
        terminalId,
        terminalName: firstHumanLabel(terminal?.name, terminal?.code, registry?.terminal_name) || 'Terminal ERP',
        deviceId,
        authorizedDeviceId: getAuthorizedDeviceId(registry, terminal),
        cloudChannel: tenant.cloud_channel || 'N/D',
        status,
        online,
        lastSeenAt: registry?.last_seen_at || terminal?.last_checkin_at || null,
        lastSyncAt,
        syncStatus: getReadinessStatus(readiness),
        pendingDocuments,
        errorDocuments,
        retries,
        lastError,
        suggestions,
    };
}

function buildTenantAlerts(
    tenant: Tenant,
    terminals: ObservabilityTerminalRow[],
    pendingEvents: number,
    blockedEvents: number,
    recentErrors: number,
) {
    const alerts: string[] = [];
    if (tenant.status === 'SUSPENDED' || tenant.lifecycle_status === 'BLOCKED' || tenant.provisioning_status === 'BLOCKED') {
        alerts.push('Tenant suspendido o bloqueado');
    }
    if (terminals.some((terminal) => !terminal.online)) {
        alerts.push('Terminales sin heartbeat reciente');
    }
    if (blockedEvents > 0) {
        alerts.push('Eventos bloqueados en cola');
    }
    if (pendingEvents > 25) {
        alerts.push('Cola APPLY_PENDING alta');
    }
    if (recentErrors >= 5) {
        alerts.push('Alto volumen de errores recientes');
    }
    if (terminals.some((terminal) => terminal.suggestions.includes('Revisar readiness ERP'))) {
        alerts.push('POS_ERP sin readiness completo');
    }
    if (terminals.some((terminal) => terminal.suggestions.includes('Revisar configuración fiscal'))) {
        alerts.push('Configuración fiscal pendiente');
    }
    if (terminals.some((terminal) => terminal.suggestions.includes('Revisar device token o pairing'))) {
        alerts.push('Device mismatch o token inválido');
    }
    return alerts;
}

function buildTerminalSuggestions(input: {
    authStatus: string;
    readiness: TenantTerminalErpReadiness | null;
    fiscalStatus: string;
    pendingDocuments: number;
    errorDocuments: number;
    lastError?: string | null;
    online: boolean;
}) {
    const suggestions: string[] = [];
    if (!input.online) suggestions.push('Revisar heartbeat o red local');
    if (['DEVICE_MISMATCH', 'ERP_AUTH_ERROR', 'TOKEN_ROTATION_REQUIRED', 'TAKEOVER_PENDING', 'ERP_REPAIR_PENDING', 'ERP_REPAIR_FAILED', 'WAITING_ERP_CONFIRMATION', 'BOUND_AUTH_MISMATCH'].includes(input.authStatus)) {
        suggestions.push('Revisar device token o pairing');
    }
    if (normalizeStatus(input.readiness?.status) !== 'READY' && input.readiness) {
        suggestions.push('Revisar readiness ERP');
    }
    if (getReadinessCheck(input.readiness, 'catalog') === false || getReadinessCheck(input.readiness, 'items') === false) {
        suggestions.push('Revisar catálogo');
    }
    if (input.fiscalStatus === 'MISSING' || /FISCAL_CONFIG_MISSING/i.test(input.lastError || '')) {
        suggestions.push('Revisar configuración fiscal');
    }
    if (input.pendingDocuments > 0 || input.errorDocuments > 0) {
        suggestions.push('Revisar cola de sincronización');
    }
    return Array.from(new Set(suggestions));
}

function estimateSupabaseUnits(input: { terminals: number; posEvents: number; apiCalls: number; errors: number }) {
    return input.terminals * 10 + input.posEvents * 2 + input.apiCalls + input.errors * 5;
}

function statusWeight(status: ObservabilityStatus) {
    if (status === 'CRITICAL') return 3;
    if (status === 'ATTENTION') return 2;
    return 1;
}
