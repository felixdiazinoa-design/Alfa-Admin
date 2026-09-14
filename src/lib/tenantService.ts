import { supabase, supabaseAdmin, supabaseProjectUrl } from "./supabase";
import { invokeAdminCommand } from "./adminApi";
import type {
    Distributor,
    Tenant,
    CloudChannel,
    ContractedProduct,
    DataMaster,
    PosVariant,
    PosRuntime,
    TenantLifecycleStatus,
    TenantProvisioningStatus,
    TerminalAuthAttempt,
    TerminalFiscalProductionConfig,
    TerminalFiscalReadiness,
    TerminalSyncPendingResult,
    TerminalSyncRetryResult,
    TenantTerminalRegistryEntry,
    TenantTerminalErpReadiness,
    TenantTerminalSnapshot,
    TenantType,
    Terminal,
} from "../types";
import {
    getTenantLicenseProvisioningMismatch,
    normalizeTenantLicenseLimit,
    type ProvisionTenantInput,
} from "./tenantProvisioning";
import {
    deriveTenantSemanticsFromTenant,
    type TenantSemanticConfig,
} from "./tenantProducts";
import { buildTenantAuthMetadataPayload } from "./tenantAuthMetadata";

export interface DashboardStats {
    totalTenants: number;
    activeTenants: number;
    trialTenants: number;
    suspendedTenants: number;
    terminals: number;
    activeSubscriptions: number;
    openTickets: number;
    criticalTickets: number;
    tenantGrowth: DashboardTrendPoint[];
    recentTickets: DashboardTicket[];
    expiringSubscriptions: DashboardExpiringSubscription[];
    inactiveTenants: DashboardInactiveTenant[];
    supportSatisfaction: DashboardSupportSatisfaction;
    lastUpdatedAt: string;
}

export interface DashboardSupportSatisfaction {
    totalResponses: number;
    excellent: DashboardSatisfactionBucket;
    good: DashboardSatisfactionBucket;
    bad: DashboardSatisfactionBucket;
}

export interface DashboardSatisfactionBucket {
    count: number;
    percentage: number;
}

export interface DashboardTrendPoint {
    name: string;
    value: number;
}

export interface DashboardTicket {
    id: string;
    subject: string;
    priority: string;
    status: string;
    tenantName: string;
    createdAt: string;
}

export interface DashboardExpiringSubscription {
    tenantId: string;
    tenantName: string;
    planName: string;
    endDate: string;
    daysRemaining: number;
}

export interface DashboardInactiveTenant {
    tenantId: string;
    tenantName: string;
    lastActivityAt: string | null;
    daysInactive: number;
    status: string;
}

type CreateTenantInput = ProvisionTenantInput;

const isBrowserRuntime = typeof window !== "undefined";

async function getAdminAccessToken(): Promise<string> {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error("Sesión administrativa requerida.");
    return accessToken;
}

type TenantUpdatePayload = {
    name: string;
    legal_name: string | null;
    tax_id: string | null;
    phone: string | null;
    type: TenantType;
    cloud_sync: boolean;
    max_pos_terminals?: number;
    max_erp_users?: number;
    contracted_product?: ContractedProduct;
    pos_variant?: PosVariant;
    offline_mode?: boolean;
    explicit_offline?: boolean;
    cloud_disabled_reason?: string | null;
    pos_runtime?: PosRuntime;
    cloud_channel?: CloudChannel;
    data_master?: DataMaster;
    cloud_sync_enabled?: boolean;
    erp_core_enabled?: boolean;
    erp_ui_enabled?: boolean;
    customer_erp_access?: boolean;
    backup_enabled?: boolean;
    lifecycle_status?: TenantLifecycleStatus;
    provisioning_status?: TenantProvisioningStatus;
    email?: string;
    password?: string;
};

const TENANT_UPDATE_PAYLOAD_KEYS = new Set<keyof TenantUpdatePayload>([
    "name",
    "legal_name",
    "tax_id",
    "phone",
    "type",
    "cloud_sync",
    "max_pos_terminals",
    "max_erp_users",
    "contracted_product",
    "pos_variant",
    "offline_mode",
    "explicit_offline",
    "cloud_disabled_reason",
    "pos_runtime",
    "cloud_channel",
    "data_master",
    "cloud_sync_enabled",
    "erp_core_enabled",
    "erp_ui_enabled",
    "customer_erp_access",
    "backup_enabled",
    "lifecycle_status",
    "provisioning_status",
    "email",
    "password",
]);

const REQUIRED_TENANT_UPDATE_COLUMNS = new Set<keyof TenantUpdatePayload>([
    "name",
    "type",
    "cloud_sync",
]);

const TENANT_CORE_UPDATE_COLUMNS: Array<keyof TenantUpdatePayload> = [
    "name",
    "legal_name",
    "tax_id",
    "phone",
    "type",
    "cloud_sync",
    "max_pos_terminals",
    "max_erp_users",
];

const TENANT_SEMANTIC_UPDATE_COLUMNS: Array<keyof TenantUpdatePayload> = [
    "contracted_product",
    "pos_variant",
    "offline_mode",
    "explicit_offline",
    "cloud_disabled_reason",
    "pos_runtime",
    "cloud_channel",
    "data_master",
    "cloud_sync_enabled",
    "erp_core_enabled",
    "erp_ui_enabled",
    "customer_erp_access",
    "backup_enabled",
    "lifecycle_status",
    "provisioning_status",
];

function getSupabaseErrorHaystack(error: unknown): string {
    if (!error || typeof error !== "object") return "";

    const record = error as Record<string, unknown>;
    return [
        record.message,
        record.details,
        record.hint,
        record.error,
    ]
        .filter((value): value is string => typeof value === "string")
        .join(" ");
}

function getTerminalEdgeErrorMessage(
    payload: { message?: string; error?: string } | null | undefined,
    fallback: string,
    context: string,
) {
    const message = payload?.message || payload?.error || "";
    if (message && !message.toLowerCase().includes("no tienes permiso")) return message;
    if (message) {
        return `${context}: el servicio rechazo la solicitud con permisos insuficientes. Verifica el token de servicio ERP/Supabase y la configuracion del tenant.`;
    }
    return fallback;
}

function parseMissingTenantColumn(error: unknown): keyof TenantUpdatePayload | null {
    const haystack = getSupabaseErrorHaystack(error);
    if (!haystack) return null;

    const quotedMatch = haystack.match(/Could not find the '([^']+)' column/i)
        || haystack.match(/'([a-z][a-z0-9_]*)'\s+column/i)
        || haystack.match(/column\s+"([a-z][a-z0-9_]*)"/i)
        || haystack.match(/column\s+'([a-z][a-z0-9_]*)'/i);

    if (quotedMatch?.[1]) {
        const column = quotedMatch[1] as keyof TenantUpdatePayload;
        if (TENANT_UPDATE_PAYLOAD_KEYS.has(column) && !REQUIRED_TENANT_UPDATE_COLUMNS.has(column)) {
            return column;
        }
    }

    const lowerHaystack = haystack.toLowerCase();
    for (const column of TENANT_UPDATE_PAYLOAD_KEYS) {
        if (REQUIRED_TENANT_UPDATE_COLUMNS.has(column)) continue;
        if (lowerHaystack.includes(column)) {
            return column;
        }
    }

    return null;
}

function pickTenantUpdateFields(
    payload: TenantUpdatePayload,
    keys: Array<keyof TenantUpdatePayload>,
): Partial<TenantUpdatePayload> {
    const picked: Partial<TenantUpdatePayload> = {};

    for (const key of keys) {
        if (key in payload && payload[key] !== undefined) {
            (picked as Record<string, unknown>)[key] = payload[key];
        }
    }

    return picked;
}

async function updateTenantPayloadWithFallback(
    id: string,
    payload: Partial<TenantUpdatePayload>,
): Promise<void> {
    const nextPayload: Partial<TenantUpdatePayload> = { ...payload };
    const maxAttempts = Math.max(5, Object.keys(nextPayload).length + 3);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (Object.keys(nextPayload).length === 0) return;

        const { error } = await supabaseAdmin
            .from("tenants")
            .update(nextPayload)
            .eq("id", id);

        if (!error) return;

        const missingColumn = parseMissingTenantColumn(error);
        if (missingColumn && missingColumn in nextPayload) {
            delete nextPayload[missingColumn];
            continue;
        }

        throw error;
    }

    if (Object.keys(nextPayload).length === 0) return;

    throw new Error("Tenant update failed after retrying without optional columns.");
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asText(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function isArchivedErpTerminalRow(terminal: Record<string, unknown>): boolean {
    const config = asRecord(terminal.config);
    const metadata = asRecord(config.metadata);
    const terminalName = asText(terminal.name).toUpperCase();
    const deviceId = asText(terminal.device_id).toUpperCase();

    return terminalName.startsWith("ARCHIVED-")
        || deviceId.startsWith("ARCHIVED-")
        || config.active === false
        || config.is_active === false
        || config.archived === true
        || metadata.archived === true;
}

function normalizeKey(value: unknown): string {
    return asText(value).toUpperCase();
}

function isUuidLike(value: unknown): boolean {
    const text = asText(value);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text);
}

function firstText(...values: unknown[]): string | null {
    for (const value of values) {
        const text = asText(value);
        if (text) return text;
    }
    return null;
}

function firstHumanText(...values: unknown[]): string | null {
    for (const value of values) {
        const text = asText(value);
        if (text && !isUuidLike(text)) return text;
    }
    return null;
}

function firstNumber(...values: unknown[]): number | null {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value === "string" && value.trim()) {
            const parsed = Number(value.trim());
            if (Number.isFinite(parsed)) return parsed;
        }
    }
    return null;
}

interface ErpTerminalBinding {
    deviceId: string;
    erpTerminalId: string;
    storeId: string;
    storeName?: string | null;
    displayName?: string | null;
    terminalCode?: string | null;
    appVersion?: string | null;
    appVersionCode?: number | null;
}

function resolveErpTerminalBinding(
    bindings: Map<string, ErpTerminalBinding>,
    ...candidates: Array<string | null | undefined>
): ErpTerminalBinding | null {
    for (const candidate of candidates) {
        const key = normalizeKey(candidate);
        if (!key) continue;
        const hit = bindings.get(key);
        if (hit) return hit;
    }
    return null;
}

async function loadErpTerminalBindings(tenantId: string): Promise<Map<string, ErpTerminalBinding>> {
    try {
        const { data: erpTenant, error: erpTenantError } = await supabaseAdmin
            .schema("public")
            .from("erp_tenants")
            .select("id")
            .eq("config->>cloudAdminTenantId", tenantId)
            .maybeSingle();

        if (erpTenantError) {
            console.warn("ERP tenant lookup unavailable for terminal binding status:", erpTenantError);
            return new Map();
        }

        const erpTenantId = (erpTenant as { id?: string } | null)?.id;
        if (!erpTenantId) return new Map();

        const { data: stores, error: storesError } = await supabaseAdmin
            .schema("public")
            .from("erp_stores")
            .select("id,name")
            .eq("tenant_id", erpTenantId);

        if (storesError) {
            console.warn("ERP store lookup unavailable for terminal binding status:", storesError);
            return new Map();
        }

        const storeRows = ((stores as Array<{ id?: string; name?: string | null }> | null) || []);
        const storeIds = storeRows
            .map((store) => store.id)
            .filter((id): id is string => Boolean(id));
        const storeNamesById = new Map(
            storeRows
                .filter((store): store is { id: string; name?: string | null } => Boolean(store.id))
                .map((store) => [store.id, firstHumanText(store.name)]),
        );

        if (storeIds.length === 0) return new Map();

        const { data: terminals, error: terminalsError } = await supabaseAdmin
            .schema("public")
            .from("erp_terminals")
            .select("id,store_id,device_id,name,config,last_seen,created_at")
            .in("store_id", storeIds);

        if (terminalsError) {
            console.warn("ERP terminal lookup unavailable for terminal binding status:", terminalsError);
            return new Map();
        }

        const bindings = new Map<string, ErpTerminalBinding>();
        for (const terminal of ((terminals as Array<Record<string, unknown>> | null) || [])) {
            if (isArchivedErpTerminalRow(terminal)) continue;

            const deviceId = asText(terminal.device_id) || '';
            const erpTerminalId = asText(terminal.id);
            const storeId = asText(terminal.store_id);
            if (!erpTerminalId || !storeId || !isUuidLike(erpTerminalId)) continue;

            const config = asRecord(terminal.config);
            const metadata = asRecord(config.metadata);
            const status = asRecord(config.status);
            const app = asRecord(config.app);
            const apk = asRecord(config.apk);
            const terminalCode = firstHumanText(
                terminal.code,
                config.station_number,
                config.stationNumber,
                metadata.station_number,
                metadata.stationNumber,
                metadata.terminal_code,
                metadata.terminalCode,
            );
            const displayName = firstHumanText(
                terminal.name,
                terminal.code,
                metadata.terminal_name,
                metadata.terminalName,
                metadata.display_name,
                metadata.displayName,
                config.terminal_name,
                config.terminalName,
                config.display_name,
                config.displayName,
                terminalCode,
            );
            const binding: ErpTerminalBinding = {
                deviceId,
                erpTerminalId,
                storeId,
                storeName: storeNamesById.get(storeId) || null,
                displayName,
                terminalCode,
                appVersion: firstText(
                    config.app_version,
                    config.appVersion,
                    config.apk_version,
                    config.apkVersion,
                    config.version,
                    metadata.app_version,
                    metadata.appVersion,
                    metadata.apk_version,
                    metadata.apkVersion,
                    metadata.version,
                    status.app_version,
                    status.appVersion,
                    status.apk_version,
                    status.apkVersion,
                    status.version,
                    app.version,
                    app.app_version,
                    app.apk_version,
                    apk.version,
                    apk.app_version,
                    apk.apk_version,
                ),
                appVersionCode: firstNumber(
                    config.app_version_code,
                    config.appVersionCode,
                    config.apk_version_code,
                    config.apkVersionCode,
                    config.version_code,
                    config.versionCode,
                    metadata.app_version_code,
                    metadata.appVersionCode,
                    metadata.apk_version_code,
                    metadata.apkVersionCode,
                    metadata.version_code,
                    metadata.versionCode,
                    status.app_version_code,
                    status.appVersionCode,
                    status.apk_version_code,
                    status.apkVersionCode,
                    status.version_code,
                    status.versionCode,
                    app.version_code,
                    app.versionCode,
                    apk.version_code,
                    apk.versionCode,
                ),
            };
            // La identidad ERP solo se indexa por el UUID real de erp_terminals.
            // Nombre, código, estación y device_id no son evidencia canónica.
            bindings.set(normalizeKey(erpTerminalId), binding);
        }

        return bindings;
    } catch (error) {
        console.warn("ERP terminal binding status lookup failed:", error);
        return new Map();
    }
}

function applyRegistryBindingStatus(
    registries: TenantTerminalRegistryEntry[],
    bindings: Map<string, ErpTerminalBinding>,
): TenantTerminalRegistryEntry[] {
    if (bindings.size === 0) return registries;

    return registries.map((registry) => {
        const readiness = registry.erp_readiness || {};
        const explicitErpId = firstText(readiness.terminalId, readiness.terminal_id);
        const binding = isUuidLike(explicitErpId) ? resolveErpTerminalBinding(bindings, explicitErpId) : null;
        const authorizedDeviceId = binding?.deviceId || null;

        const isRevoked = Boolean(
            authorizedDeviceId
            && registry.device_id
            && normalizeKey(registry.device_id) !== normalizeKey(authorizedDeviceId)
        );

        return {
            ...registry,
            authorized_device_id: authorizedDeviceId || registry.authorized_device_id || null,
            is_revoked: isRevoked,
        };
    });
}

export interface RequestTerminalTakeoverInput {
    tenantId: string;
    terminalId: string;
    registryId?: string | null;
    newDeviceId: string;
    deviceName?: string;
    reason: string;
    confirmTakeover: boolean;
}

export interface TerminalTakeoverResult {
    status: string;
    terminal?: unknown;
    previous_device_id?: string | null;
    new_device_id?: string;
    requires_auth?: boolean;
    message?: string;
}

export interface RequestTerminalLocalRebuildInput {
    tenantId: string;
    terminalId: string;
    registryId?: string | null;
    reason: string;
    confirmRebuild: boolean;
}

export interface TerminalLocalRebuildResult {
    status: string;
    terminal?: unknown;
    device_id?: string | null;
    requires_full_bootstrap?: boolean;
    message?: string;
}

export interface RequestTerminalErpReadinessInput {
    tenantId: string;
    terminalId: string;
    registryId?: string | null;
    deviceId: string;
    terminalName?: string | null;
}

export interface TerminalErpReadinessResult {
    status: string;
    erpTenantId?: string | null;
    companyId?: string | null;
    storeId?: string | null;
    terminalId?: string | null;
    profileStatus?: string | null;
    checks?: Record<string, unknown>;
    erp_readiness?: TenantTerminalErpReadiness;
    message?: string;
}

export type TerminalDeviceAction =
    | "TAKEOVER"
    | "ROTATE_TOKEN"
    | "REVOKE_DEVICE"
    | "SYNC_AUTHORIZED_DEVICE"
    | "CLEAR_TERMINAL_DEVICES";

export interface RequestTerminalDeviceActionInput {
    tenantId: string;
    terminalId: string;
    catalogTerminalId?: string | null;
    storeId?: string | null;
    registryId?: string | null;
    terminalName?: string | null;
    deviceName?: string | null;
    deviceId?: string | null;
    requestId?: string | null;
    expectedAuthorizedDeviceId?: string | null;
    action: TerminalDeviceAction;
    reason: string;
    idempotencyKey?: string;
}

export interface TerminalDeviceActionResult {
    status: string;
    success?: boolean;
    action?: string;
    old_device_id?: string | null;
    new_device_id?: string | null;
    authorized_device_id?: string | null;
    terminal_id?: string | null;
    previous_device_id?: string | null;
    operation_id?: string | null;
    request_id?: string | null;
    request_status?: string | null;
    takeover_confirmed?: boolean;
    previous_device_revoked?: boolean;
    rotate_device_token?: boolean;
    revoked_device_id?: string | null;
    deviceTokenIssued?: boolean;
    deviceTokenStatus?: string | null;
    tokenPreview?: string | null;
    cleared_registry_count?: number | null;
    cleared_device_ids?: string[] | null;
    message?: string;
}

export interface RejectTerminalDeviceRequestInput {
    tenantId: string;
    terminalId: string;
    requestId: string;
    requestedDeviceId: string;
    idempotencyKey?: string;
}

export interface TerminalDeviceRequestResult {
    status: string;
    request_id: string;
    request_status: "REJECTED";
    operation_id?: string | null;
    reconciled?: boolean;
}

export interface TerminalDeviceAuditEntry {
    id: string;
    terminal_id: string;
    terminal_name?: string | null;
    old_device_id?: string | null;
    new_device_id?: string | null;
    performed_by?: string | null;
    performed_at: string;
    result?: string | null;
    action: string;
    reason?: string | null;
    erp_error_code?: string | null;
    metadata?: Record<string, unknown> | null;
}

export type TerminalReconciliationMode = "DRY_RUN" | "EXECUTE" | "ROLLBACK";

export interface TerminalReconciliationPlan {
    tenant_id: string;
    source_registry_id: string;
    target_erp_terminal_id: string;
    target_store_id: string;
    terminal_code: string;
    authorized_device_id: string;
    previous_authorized_device_id?: string | null;
    historical_device_ids: string[];
    affected_registry_ids: string[];
    orphan_registry_ids: string[];
    writes: string[];
    rollback: string[];
    destructive_operations: string[];
    preserves: string[];
}

export interface RequestTerminalReconciliationInput {
    mode: TerminalReconciliationMode;
    tenantId: string;
    sourceRegistryId?: string | null;
    targetErpTerminalId?: string | null;
    targetStoreId?: string | null;
    authorizedDeviceId?: string | null;
    reason: string;
    correlationId: string;
    expectedPlanHash?: string | null;
    adminConfirmed?: boolean;
}

export interface TerminalReconciliationResult {
    status: string;
    dry_run?: boolean;
    writes_performed?: boolean;
    executable?: boolean;
    idempotent_replay?: boolean;
    correlation_id: string;
    plan_hash?: string;
    plan?: TerminalReconciliationPlan;
    rollback_available?: boolean;
    message?: string;
}

export interface RequestTerminalFiscalReadinessInput {
    tenantId: string;
    terminalId: string;
    registryId?: string | null;
}

export interface TerminalFiscalReadinessResult {
    status: string;
    readiness?: TerminalFiscalReadiness | null;
    fiscal_readiness?: TerminalFiscalReadiness | null;
    message?: string;
}

export interface RequestTerminalFiscalConfigInput {
    tenantId: string;
    terminalId: string;
    registryId?: string | null;
    terminalName?: string | null;
    mode: "QA_DEMO" | "PRODUCTION";
    config?: TerminalFiscalProductionConfig;
}

export interface RequestTerminalErpProfilePrepareInput {
    tenantId: string;
    terminalId: string;
    registryId?: string | null;
    deviceId?: string | null;
    terminalName?: string | null;
}

export interface RequestTerminalSyncPendingInput {
    tenantId: string;
    terminalId: string;
}

export interface RequestTerminalSyncRetryInput {
    tenantId: string;
    terminalId: string;
    documentId?: string | null;
    documentIds?: string[];
}

export interface TerminalFiscalConfigResult {
    status: string;
    mode?: "QA_DEMO" | "PRODUCTION";
    readiness?: TerminalFiscalReadiness | null;
    fiscal_readiness?: TerminalFiscalReadiness | null;
    message?: string;
}

function normalizeOptional(value?: string | null): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function isOperationalTenantStatus(status?: string | null): boolean {
    const normalized = (status || "").trim().toUpperCase();
    return normalized === "ACTIVE" || normalized === "TRIAL";
}

function generateTempPassword(): string {
    const length = 14;
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let pwd = "";
    for (let i = 0; i < length; i++) {
        pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pwd;
}

function normalizeTenantSemantics(input: CreateTenantInput): TenantSemanticConfig {
    const inferred = deriveTenantSemanticsFromTenant(input.type, input.cloudSync, undefined, undefined, {
        posVariant: input.posVariant,
        offlineMode: input.offlineMode,
        explicitOffline: input.explicitOffline,
        cloudChannel: input.cloudChannel,
    });
    const semantics: TenantSemanticConfig = {
        ...inferred,
        contractedProduct: input.contractedProduct || inferred.contractedProduct,
        posVariant: input.posVariant || inferred.posVariant,
        offlineMode: input.offlineMode ?? inferred.offlineMode,
        explicitOffline: input.explicitOffline ?? inferred.explicitOffline,
        cloudDisabledReason: input.cloudDisabledReason ?? inferred.cloudDisabledReason,
        posRuntime: input.posRuntime || inferred.posRuntime,
        cloudChannel: input.cloudChannel || inferred.cloudChannel,
        dataMaster: input.dataMaster || inferred.dataMaster,
        cloudSyncEnabled: input.cloudSyncEnabled ?? inferred.cloudSyncEnabled,
        erpCoreEnabled: input.erpCoreEnabled ?? inferred.erpCoreEnabled,
        erpUiEnabled: input.erpUiEnabled ?? inferred.erpUiEnabled,
        customerErpAccess: input.customerErpAccess ?? inferred.customerErpAccess,
        backupEnabled: input.backupEnabled ?? inferred.backupEnabled,
        lifecycleStatus: input.lifecycleStatus || inferred.lifecycleStatus,
        provisioningStatus: input.provisioningStatus || inferred.provisioningStatus,
    };

    const explicitlyOffline = semantics.posVariant === "POS_ONLY_OFFLINE"
        || semantics.offlineMode
        || semantics.explicitOffline;

    if (semantics.contractedProduct === "POS_ONLY" && !explicitlyOffline && semantics.posRuntime !== "SLAVE") {
        semantics.posVariant = "POS_ONLY_STANDARD";
        semantics.offlineMode = false;
        semantics.explicitOffline = false;
        semantics.cloudDisabledReason = null;
        semantics.cloudChannel = "POS_CLOUD_STAGING";
        semantics.dataMaster = "POS";
        semantics.cloudSyncEnabled = true;
        semantics.erpCoreEnabled = true;
        semantics.erpUiEnabled = false;
        semantics.customerErpAccess = false;
        semantics.backupEnabled = true;
        semantics.lifecycleStatus = "CLOUD_STAGING";
        semantics.provisioningStatus = "CLOUD_STAGING_REQUIRED";
    }

    if (semantics.contractedProduct === "POS_ONLY" && explicitlyOffline && semantics.posRuntime !== "SLAVE") {
        semantics.posVariant = "POS_ONLY_OFFLINE";
        semantics.offlineMode = true;
        semantics.explicitOffline = true;
        semantics.cloudDisabledReason = semantics.cloudDisabledReason || "POS_ONLY_OFFLINE";
        semantics.cloudChannel = "NONE";
        semantics.dataMaster = "POS";
        semantics.cloudSyncEnabled = false;
        semantics.erpCoreEnabled = false;
        semantics.erpUiEnabled = false;
        semantics.customerErpAccess = false;
        semantics.backupEnabled = false;
        semantics.lifecycleStatus = "CLOUD_DISABLED";
        semantics.provisioningStatus = "PENDING";
    }

    if (semantics.contractedProduct === "POS_ONLY") {
        if (semantics.customerErpAccess) {
            throw new Error("POS_ONLY no puede tener acceso ERP visible para el cliente.");
        }
        if (semantics.erpUiEnabled) {
            throw new Error("POS_ONLY no puede tener ERP UI habilitado.");
        }
        if (semantics.cloudChannel === "NONE" && !explicitlyOffline && semantics.posRuntime !== "SLAVE") {
            throw new Error("POS_ONLY solo puede quedar sin nube cuando el modo offline es explicito.");
        }
        if (semantics.cloudChannel === "POS_CLOUD_STAGING" && (!semantics.cloudSyncEnabled || !semantics.erpCoreEnabled)) {
            throw new Error("POS_ONLY con Cloud Staging requiere cloud_sync_enabled y erp_core_enabled activos.");
        }
    }

    if (semantics.contractedProduct === "POS_ERP") {
        semantics.posVariant = "POS_ERP";
        semantics.offlineMode = false;
        semantics.explicitOffline = false;
        semantics.cloudDisabledReason = null;
        if (!semantics.customerErpAccess) {
            throw new Error("POS_ERP requiere acceso ERP para el cliente.");
        }
        if (semantics.cloudChannel !== "ERP_ACTIVE") {
            throw new Error("POS_ERP debe usar cloud_channel ERP_ACTIVE.");
        }
    }

    if (semantics.posRuntime === "SLAVE") {
        if (semantics.cloudChannel !== "POS_MASTER" || semantics.dataMaster !== "POS_MASTER") {
            throw new Error("POS_SLAVE debe depender de POS_MASTER y no de ERP directo.");
        }
        if (semantics.erpUiEnabled) {
            throw new Error("Una terminal esclava no puede tener ERP UI directo.");
        }
    }

    return semantics;
}

export async function createTenant(input: CreateTenantInput): Promise<{ tenantId: string; tempPassword: string }> {
    if (isBrowserRuntime) {
        return invokeAdminCommand("create_tenant", { input });
    }

    const {
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
        contractedProduct,
        posRuntime,
        posVariant,
        offlineMode,
        explicitOffline,
        cloudDisabledReason,
        cloudChannel,
        dataMaster,
        cloudSyncEnabled,
        erpCoreEnabled,
        erpUiEnabled,
        customerErpAccess,
        backupEnabled,
        lifecycleStatus,
        provisioningStatus,
        maxPosTerminals = 1,
        maxErpUsers = 1,
    } = input;
    const accessEmail = email.trim().toLowerCase();
    const contactMail = contactEmail.trim().toLowerCase();
    const tempPassword = generateTempPassword();
    const normalizedMaxPosTerminals = normalizeTenantLicenseLimit(maxPosTerminals);
    const normalizedMaxErpUsers = normalizeTenantLicenseLimit(maxErpUsers);
    const semantics = normalizeTenantSemantics({
        name,
        slug,
        email,
        contactName,
        contactEmail,
        city,
        capturedByDistributorId,
        servicedByDistributorId,
        plan,
        type,
        cloudSync,
        contractedProduct,
        posRuntime,
        posVariant,
        offlineMode,
        explicitOffline,
        cloudDisabledReason,
        cloudChannel,
        dataMaster,
        cloudSyncEnabled,
        erpCoreEnabled,
        erpUiEnabled,
        customerErpAccess,
        backupEnabled,
        lifecycleStatus,
        provisioningStatus,
    });

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
            contracted_product: semantics.contractedProduct,
            pos_variant: semantics.posVariant,
            offline_mode: semantics.offlineMode,
            explicit_offline: semantics.explicitOffline,
            cloud_disabled_reason: semantics.cloudDisabledReason,
            pos_runtime: semantics.posRuntime,
            cloud_channel: semantics.cloudChannel,
            data_master: semantics.dataMaster,
            cloud_sync_enabled: semantics.cloudSyncEnabled,
            erp_core_enabled: semantics.erpCoreEnabled,
            erp_ui_enabled: semantics.erpUiEnabled,
            customer_erp_access: semantics.customerErpAccess,
            backup_enabled: semantics.backupEnabled,
            lifecycle_status: semantics.lifecycleStatus,
            provisioning_status: semantics.provisioningStatus,
            contact_name: contactName.trim(),
            contact_email: contactMail,
            city: city.trim(),
            captured_by_distributor_id: normalizeOptional(capturedByDistributorId),
            serviced_by_distributor_id: normalizeOptional(servicedByDistributorId),
            is_new_user: true,
            must_change_password: true,
            temporary_password: true,
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
        p_contracted_product: semantics.contractedProduct,
        p_pos_variant: semantics.posVariant,
        p_offline_mode: semantics.offlineMode,
        p_explicit_offline: semantics.explicitOffline,
        p_cloud_disabled_reason: semantics.cloudDisabledReason,
        p_pos_runtime: semantics.posRuntime,
        p_cloud_channel: semantics.cloudChannel,
        p_data_master: semantics.dataMaster,
        p_cloud_sync_enabled: semantics.cloudSyncEnabled,
        p_erp_core_enabled: semantics.erpCoreEnabled,
        p_erp_ui_enabled: semantics.erpUiEnabled,
        p_customer_erp_access: semantics.customerErpAccess,
        p_backup_enabled: semantics.backupEnabled,
        p_lifecycle_status: semantics.lifecycleStatus,
        p_provisioning_status: semantics.provisioningStatus,
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
    const licenseMismatch = licenseVerificationError
        ? "No se pudo verificar la cantidad de licencias del tenant recién creado."
        : getTenantLicenseProvisioningMismatch(
            tenantRows?.[0],
            normalizedMaxPosTerminals,
            normalizedMaxErpUsers,
        );

    if (licenseMismatch) {
        await supabaseAdmin.from("tenants").delete().eq("id", tenantId);
        await supabaseAdmin.auth.admin.deleteUser(authUserId);
        throw new Error(licenseMismatch);
    }

    const { error: metadataError } = await supabaseAdmin.auth.admin.updateUserById(
        authUserId,
        {
            password: tempPassword,
            ...buildTenantAuthMetadataPayload(tenantId, {
                name,
                full_name: name,
                slug,
                type,
                cloudSync,
                contracted_product: semantics.contractedProduct,
                pos_variant: semantics.posVariant,
                offline_mode: semantics.offlineMode,
                explicit_offline: semantics.explicitOffline,
                cloud_disabled_reason: semantics.cloudDisabledReason,
                pos_runtime: semantics.posRuntime,
                cloud_channel: semantics.cloudChannel,
                data_master: semantics.dataMaster,
                cloud_sync_enabled: semantics.cloudSyncEnabled,
                erp_core_enabled: semantics.erpCoreEnabled,
                erp_ui_enabled: semantics.erpUiEnabled,
                customer_erp_access: semantics.customerErpAccess,
                backup_enabled: semantics.backupEnabled,
                lifecycle_status: semantics.lifecycleStatus,
                provisioning_status: semantics.provisioningStatus,
                contact_name: contactName.trim(),
                contact_email: contactMail,
                city: city.trim(),
                captured_by_distributor_id: normalizeOptional(capturedByDistributorId),
                serviced_by_distributor_id: normalizeOptional(servicedByDistributorId),
                is_new_user: true,
                must_change_password: true,
                temporary_password: true,
            }),
        },
    );

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

export async function verifyTenantEmail(token: string): Promise<void> {
    const client = isBrowserRuntime ? supabase : supabaseAdmin;
    const { error } = await client.rpc("verify_tenant_email", { p_token: token });
    if (error) throw error;
}

export async function changeTenantPassword(newPassword: string): Promise<void> {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
}

export async function getTenants(): Promise<Tenant[]> {
    if (isBrowserRuntime) return invokeAdminCommand("get_tenants");
    const { data, error } = await supabaseAdmin
        .from("tenants")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        console.error("Error fetching tenants:", error);
        throw error;
    }

    return (data as Tenant[]) || [];
}

export async function updateTenantTaxId(id: string, taxId: string): Promise<void> {
    if (isBrowserRuntime) return invokeAdminCommand("update_tenant_tax_id", { id, taxId });
    const { error } = await supabaseAdmin
        .from("tenants")
        .update({ tax_id: taxId.trim() })
        .eq("id", id);

    if (error) throw error;
}

export async function updateTenant(
    id: string,
    payload: TenantUpdatePayload,
): Promise<void> {
    if (isBrowserRuntime) return invokeAdminCommand("update_tenant", { id, update: payload });
    const corePayload = pickTenantUpdateFields(payload, TENANT_CORE_UPDATE_COLUMNS);
    const semanticPayload = pickTenantUpdateFields(payload, TENANT_SEMANTIC_UPDATE_COLUMNS);

    if (Object.keys(corePayload).length > 0) {
        await updateTenantPayloadWithFallback(id, corePayload);
    }

    if (Object.keys(semanticPayload).length === 0) return;

    try {
        await updateTenantPayloadWithFallback(id, semanticPayload);
    } catch (error) {
        console.warn(
            "Tenant semantic fields were not persisted because the database schema is missing columns:",
            getSupabaseErrorHaystack(error) || error,
        );
    }
}

async function findTenantAuthUserId(tenant: Tenant): Promise<string | null> {
    const tenantEmail = tenant.email.trim().toLowerCase();
    let page = 1;
    const perPage = 1000;

    while (true) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
        if (error) throw error;

        const users = data.users || [];
        const match = users.find((user) => {
            const userEmail = user.email?.trim().toLowerCase();
            const metadataTenantId = typeof user.user_metadata?.tenant_id === "string"
                ? user.user_metadata.tenant_id
                : null;
            return userEmail === tenantEmail || metadataTenantId === tenant.id;
        });

        if (match) return match.id;
        if (users.length < perPage) return null;
        page += 1;
    }
}

export async function deleteTenant(tenant: Tenant): Promise<void> {
    if (isBrowserRuntime) return invokeAdminCommand("delete_tenant", { tenantId: tenant.id });
    const authUserId = await findTenantAuthUserId(tenant);

    const { error } = await supabaseAdmin.rpc("delete_tenant", {
        p_tenant_id: tenant.id,
        p_confirm_name: tenant.name,
    });

    if (error) throw error;

    if (authUserId) {
        const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(authUserId);
        if (authDeleteError) {
            throw new Error(
                `Tenant eliminado, pero no se pudo eliminar el usuario de acceso (${tenant.email}): ${authDeleteError.message}`,
            );
        }
    }
}

export async function getDistributors(): Promise<Distributor[]> {
    if (isBrowserRuntime) return invokeAdminCommand("get_distributors");
    const { data, error } = await supabaseAdmin
        .from("distributors")
        .select("*")
        .eq("is_active", true)
        .order("name", { ascending: true });

    if (error) {
        const errorCode = (error as { code?: string }).code;
        if (errorCode === "42P01") {
            return [];
        }
        console.error("Error fetching distributors:", error);
        throw error;
    }

    return (data as Distributor[]) || [];
}

export async function getTenantTerminalOverview(tenantId: string): Promise<TenantTerminalSnapshot[]> {
    if (isBrowserRuntime) return invokeAdminCommand("get_tenant_terminal_overview", { tenantId });
    const [terminalsRes, registryRes, tenantRes] = await Promise.all([
        supabaseAdmin
            .schema("public")
            .from("terminals")
            .select("*")
            .eq("tenant_id", tenantId),
        supabaseAdmin
            .from("tenant_server_registry")
            .select("*")
            .eq("tenant_id", tenantId)
            .order("last_seen_at", { ascending: false }),
        supabaseAdmin
            .from("tenants")
            .select("contracted_product,cloud_channel,type")
            .eq("id", tenantId)
            .maybeSingle(),
    ]);

    const tenantRow = (tenantRes.data || null) as { contracted_product?: string | null; cloud_channel?: string | null; type?: string | null } | null;
    const isPosErpTenant = tenantRow?.contracted_product === "POS_ERP"
        || tenantRow?.cloud_channel === "ERP_ACTIVE"
        || tenantRow?.type === "full";

    const terminalRows: Terminal[] = [];
    if (terminalsRes.error) {
        console.warn("Tenant terminal catalog unavailable, falling back to registry data:", terminalsRes.error);
    } else {
        terminalRows.push(...((terminalsRes.data as Terminal[]) || []));
    }

    let registryRows: TenantTerminalRegistryEntry[] = [];
    if (registryRes.error) {
        const code = (registryRes.error as { code?: string }).code;
        if (code !== "42P01") {
            console.warn("Tenant server registry unavailable, falling back to catalog data:", registryRes.error);
        }
    } else {
        registryRows = (registryRes.data as TenantTerminalRegistryEntry[]) || [];
    }

    const erpBindings = await loadErpTerminalBindings(tenantId);
    registryRows = applyRegistryBindingStatus(registryRows, erpBindings);

    if (terminalsRes.error && registryRes.error) {
        throw terminalsRes.error;
    }

    const registriesByTerminalId = new Map<string, TenantTerminalRegistryEntry[]>();
    const matchedRegistryIds = new Set<string>();

    for (const row of registryRows) {
        if (row.terminal_id) {
            const arr = registriesByTerminalId.get(row.terminal_id) || [];
            arr.push(row);
            registriesByTerminalId.set(row.terminal_id, arr);
        }
    }

    const getTerminalConfig = (terminal?: Terminal | null) => asRecord(terminal?.config);
    const getTerminalMetadata = (terminal?: Terminal | null) => asRecord(getTerminalConfig(terminal).metadata);
    const getExplicitCatalogErpId = (terminal?: Terminal | null) => {
        const metadata = getTerminalMetadata(terminal);
        const value = firstText(
            metadata.erp_terminal_id,
            metadata.canonical_erp_terminal_id,
            getTerminalConfig(terminal).erp_terminal_id,
        );
        return isUuidLike(value) ? value : null;
    };
    const getExplicitRegistryErpId = (registry?: TenantTerminalRegistryEntry | null) => {
        const readiness = registry?.erp_readiness || {};
        const value = firstText(readiness.terminalId, readiness.terminal_id);
        return isUuidLike(value) ? value : null;
    };
    const getHumanTerminalCode = (terminal?: Terminal | null, binding?: ErpTerminalBinding | null) => {
        const config = getTerminalConfig(terminal);
        const metadata = getTerminalMetadata(terminal);
        return firstHumanText(
            terminal?.code,
            binding?.terminalCode,
            config.station_number,
            config.stationNumber,
            metadata.station_number,
            metadata.stationNumber,
            metadata.terminal_code,
            metadata.terminalCode,
        );
    };
    const getHumanTerminalName = (
        terminal?: Terminal | null,
        registry?: TenantTerminalRegistryEntry | null,
        binding?: ErpTerminalBinding | null,
    ) => {
        const config = getTerminalConfig(terminal);
        const metadata = getTerminalMetadata(terminal);
        return firstHumanText(
            terminal?.name,
            terminal?.terminal_name,
            terminal?.label,
            terminal?.code,
            registry?.terminal_name,
            binding?.displayName,
            metadata.terminal_name,
            metadata.terminalName,
            metadata.display_name,
            metadata.displayName,
            config.terminal_name,
            config.terminalName,
            config.display_name,
            config.displayName,
            getHumanTerminalCode(terminal, binding),
        ) || "Terminal sin nombre";
    };
    const getVisibleRegistries = (registries: TenantTerminalRegistryEntry[]) => registries;
    const groupedTerminalRows = new Map<string, Terminal[]>();
    const catalogCodeCounts = new Map<string, number>();
    for (const terminal of terminalRows) {
        const code = normalizeKey(getHumanTerminalCode(terminal));
        if (code) catalogCodeCounts.set(code, (catalogCodeCounts.get(code) || 0) + 1);
    }
    for (const terminal of terminalRows) {
        const explicitErpId = getExplicitCatalogErpId(terminal);
        const binding = resolveErpTerminalBinding(erpBindings, explicitErpId, terminal.id);
        const terminalName = getHumanTerminalName(terminal, null, binding);
        const groupKey = isPosErpTenant
            ? binding ? `ERP:${binding.erpTerminalId}` : `CATALOG:${terminal.id}`
            : terminalName === "Terminal sin nombre" ? terminal.id : terminalName.toUpperCase();
        const arr = groupedTerminalRows.get(groupKey) || [];
        arr.push(terminal);
        groupedTerminalRows.set(groupKey, arr);
    }

    const snapshots: TenantTerminalSnapshot[] = [];

    for (const terminalsGroup of groupedTerminalRows.values()) {
        // We pick the most recently created terminal row as the "primary" one for metadata
        const primaryTerminal = terminalsGroup.reduce((newest, current) => {
            const newestTime = new Date(newest.created_at || 0).getTime();
            const currentTime = new Date(current.created_at || 0).getTime();
            return currentTime > newestTime ? current : newest;
        });

        const registriesMap = new Map<string, TenantTerminalRegistryEntry>();

        for (const terminal of terminalsGroup) {
            if (registriesByTerminalId.has(terminal.id)) {
                for (const reg of registriesByTerminalId.get(terminal.id)!) {
                     if (reg.id) {
                         registriesMap.set(reg.id, reg);
                         matchedRegistryIds.add(reg.id);
                     }
                }
            }
            // Un código de catálogo único puede asociar heartbeats al grupo Cloud,
            // pero nunca crea un binding ERP. Si el código es ambiguo, queda huérfano.
            const catalogCode = normalizeKey(getHumanTerminalCode(terminal));
            if (catalogCode && catalogCodeCounts.get(catalogCode) === 1) {
                const directRegistries = registryRows.filter((reg) => normalizeKey(reg.terminal_id) === catalogCode);
                const legacyNames = new Set(directRegistries.map((reg) => normalizeKey(reg.terminal_name)).filter(Boolean));
                const cloudGroupRegistries = registryRows.filter((reg) => (
                    normalizeKey(reg.terminal_id) === catalogCode
                    || (legacyNames.size === 1 && legacyNames.has(normalizeKey(reg.terminal_id)) && legacyNames.has(normalizeKey(reg.terminal_name)))
                ));
                for (const reg of cloudGroupRegistries) {
                    if (reg.id) {
                        registriesMap.set(reg.id, reg);
                        matchedRegistryIds.add(reg.id);
                    }
                }
            }
        }

        const consolidatedRegistries = Array.from(registriesMap.values());
        // Sort registries by last_seen_at DESC so the most recent heartbeat is first
        consolidatedRegistries.sort((a, b) => new Date(b.last_seen_at || 0).getTime() - new Date(a.last_seen_at || 0).getTime());

        const registry = consolidatedRegistries.length > 0 ? consolidatedRegistries[0] : null;
        const explicitErpId = getExplicitCatalogErpId(primaryTerminal) || getExplicitRegistryErpId(registry);
        const erpBinding = resolveErpTerminalBinding(erpBindings, explicitErpId, primaryTerminal.id);
        const terminalName = getHumanTerminalName(primaryTerminal, registry, erpBinding);
        const visibleRegistries = getVisibleRegistries(consolidatedRegistries);
        const catalogDeviceId = erpBinding?.deviceId
            || registry?.authorized_device_id
            || registry?.current_device_id
            || registry?.device_id
            || null;

        snapshots.push({
            id: primaryTerminal.id,
            tenant_id: primaryTerminal.tenant_id,
            catalog_terminal_id: primaryTerminal.id,
            terminal_id: getHumanTerminalCode(primaryTerminal, erpBinding),
            terminal_code: getHumanTerminalCode(primaryTerminal, erpBinding),
            name: terminalName,
            device_token: catalogDeviceId,
            is_active: primaryTerminal.config?.is_active ?? primaryTerminal.is_active ?? primaryTerminal.active ?? true,
            last_checkin_at: primaryTerminal.last_checkin_at || primaryTerminal.last_seen_at || primaryTerminal.last_heartbeat_at || primaryTerminal.updated_at || null,
            created_at: primaryTerminal.created_at || null,
            erp_terminal_uuid: erpBinding?.erpTerminalId || null,
            erp_store_id: erpBinding?.storeId || null,
            erp_store_name: erpBinding?.storeName || null,
            erp_current_device_id: erpBinding?.deviceId || null,
            erp_app_version: erpBinding?.appVersion || primaryTerminal.app_version || null,
            erp_app_version_code: erpBinding?.appVersionCode || null,
            registry: visibleRegistries[0] || registry,
            registries: visibleRegistries,
            identity_status: erpBinding ? 'REPORTED' : 'PENDING_RECONCILIATION',
            identity_binding_source: erpBinding
                ? (explicitErpId ? 'metadata_erp_terminal_id' : 'erp_direct')
                : 'catalog_only',
            legacy_identity: !erpBinding && consolidatedRegistries.some((item) => (
                normalizeKey(item.terminal_id) === 'POS-001'
                && normalizeKey(item.terminal_name) === 'SLAV-01'
            )),
        });
    }

    const orphanedRegistriesGrouped = new Map<string, TenantTerminalRegistryEntry[]>();

    for (const row of registryRows) {
        if (row.id && matchedRegistryIds.has(row.id)) continue;
        
        const rowBinding = resolveErpTerminalBinding(erpBindings, getExplicitRegistryErpId(row));
        const terminalName = firstHumanText(
            row.terminal_name,
            rowBinding?.displayName,
            rowBinding?.terminalCode,
        ) || "Terminal sin catálogo";
        const groupKey = isPosErpTenant
            ? rowBinding ? `ERP:${rowBinding.erpTerminalId}` : `ORPHAN:${row.id}`
            : terminalName.toUpperCase();

        const existingSnapshot = snapshots.find((snapshot) => {
            if (isPosErpTenant) {
                return snapshot.erp_terminal_uuid ? `ERP:${snapshot.erp_terminal_uuid}` === groupKey : false;
            }
            return (snapshot.name || '').trim().toUpperCase() === groupKey;
        });

        if (existingSnapshot) {
            existingSnapshot.registries = existingSnapshot.registries || [];
            existingSnapshot.registries.push(row);
            existingSnapshot.registries.sort((a, b) => new Date(b.last_seen_at || 0).getTime() - new Date(a.last_seen_at || 0).getTime());
            existingSnapshot.registry = existingSnapshot.registries[0];
            if (row.id) matchedRegistryIds.add(row.id);
        } else {
            const arr = orphanedRegistriesGrouped.get(groupKey) || [];
            arr.push(row);
            orphanedRegistriesGrouped.set(groupKey, arr);
        }
    }

    for (const arr of orphanedRegistriesGrouped.values()) {
        arr.sort((a, b) => new Date(b.last_seen_at || 0).getTime() - new Date(a.last_seen_at || 0).getTime());
        const primary = arr[0];
        const orphanBinding = resolveErpTerminalBinding(erpBindings, getExplicitRegistryErpId(primary));
        const orphanName = firstHumanText(
            primary.terminal_name,
            orphanBinding?.displayName,
            orphanBinding?.terminalCode,
        ) || "Terminal sin catálogo";
        const visibleOrphanRegistries = getVisibleRegistries(arr);
        snapshots.push({
            id: primary.id || primary.device_id || `orphan-${Date.now()}`,
            tenant_id: primary.tenant_id,
            terminal_id: orphanBinding?.erpTerminalId || primary.terminal_id || null,
            name: orphanName,
            device_token: primary.device_id || null,
            is_active: (primary.status || "").toUpperCase() === "ONLINE",
            last_checkin_at: primary.last_seen_at || null,
            created_at: primary.created_at || null,
            erp_terminal_uuid: orphanBinding?.erpTerminalId || null,
            erp_store_id: orphanBinding?.storeId || null,
            erp_store_name: orphanBinding?.storeName || null,
            erp_current_device_id: orphanBinding?.deviceId || null,
            erp_app_version: orphanBinding?.appVersion || null,
            erp_app_version_code: orphanBinding?.appVersionCode || null,
            registry: visibleOrphanRegistries[0] || primary,
            registries: visibleOrphanRegistries,
            identity_status: orphanBinding ? 'REPORTED' : 'ORPHANED',
            identity_binding_source: orphanBinding ? 'erp_endpoint' : 'orphan_registry',
            legacy_identity: !orphanBinding && arr.some((item) => (
                normalizeKey(item.terminal_id) === 'POS-001'
                && normalizeKey(item.terminal_name) === 'SLAV-01'
            )),
        });
    }

    const consolidatedSnapshots = new Map<string, TenantTerminalSnapshot>();
    for (const snapshot of snapshots) {
        const key = isPosErpTenant
            ? snapshot.erp_terminal_uuid ? `ERP:${snapshot.erp_terminal_uuid}` : snapshot.catalog_terminal_id ? `CATALOG:${snapshot.catalog_terminal_id}` : `ORPHAN:${snapshot.id}`
            : snapshot.id;
        const existing = consolidatedSnapshots.get(key);
        if (!existing) {
            consolidatedSnapshots.set(key, snapshot);
            continue;
        }

        const mergedRegistries = [...(existing.registries || []), ...(snapshot.registries || [])]
            .filter((registry, index, arr) => registry.id ? arr.findIndex((item) => item.id === registry.id) === index : true)
            .sort((a, b) => new Date(b.last_seen_at || 0).getTime() - new Date(a.last_seen_at || 0).getTime());
        const visibleMergedRegistries = getVisibleRegistries(mergedRegistries);

        consolidatedSnapshots.set(key, {
            ...existing,
            erp_terminal_uuid: existing.erp_terminal_uuid || snapshot.erp_terminal_uuid,
            erp_store_id: existing.erp_store_id || snapshot.erp_store_id,
            erp_store_name: existing.erp_store_name || snapshot.erp_store_name,
            erp_current_device_id: existing.erp_current_device_id || snapshot.erp_current_device_id,
            erp_app_version: existing.erp_app_version || snapshot.erp_app_version,
            erp_app_version_code: existing.erp_app_version_code || snapshot.erp_app_version_code,
            last_checkin_at: existing.last_checkin_at || snapshot.last_checkin_at,
            registry: visibleMergedRegistries[0] || mergedRegistries[0] || existing.registry || snapshot.registry || null,
            registries: visibleMergedRegistries,
        });
    }

    return Array.from(consolidatedSnapshots.values()).sort((a, b) => {
        const aTime = new Date(a.last_checkin_at || a.created_at || 0).getTime();
        const bTime = new Date(b.last_checkin_at || b.created_at || 0).getTime();
        return bTime - aTime;
    });
}

export async function requestTerminalTakeover(input: RequestTerminalTakeoverInput): Promise<TerminalTakeoverResult> {
    const response = await fetch("/api/terminal-takeover", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${await getAdminAccessToken()}`,
            "Content-Type": "application/json",
            "X-Actor-Source": "cloud-admin-ui",
        },
        body: JSON.stringify({
            tenant_id: input.tenantId,
            terminal_id: input.terminalId,
            registry_id: input.registryId || null,
            device_id: input.newDeviceId,
            device_name: input.deviceName || null,
            reason: input.reason,
            confirm_takeover: input.confirmTakeover,
        }),
    });

    const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;

    if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "No se pudo ejecutar la recuperacion de terminal.");
    }

    return (payload || { status: "success" }) as TerminalTakeoverResult;
}

export async function requestTerminalLocalRebuild(input: RequestTerminalLocalRebuildInput): Promise<TerminalLocalRebuildResult> {
    const endpoint = `${supabaseProjectUrl.replace(/\/$/, "")}/functions/v1/request-terminal-local-rebuild`;
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${await getAdminAccessToken()}`,
            "Content-Type": "application/json",
            "X-Actor-Source": "cloud-admin-ui",
        },
        body: JSON.stringify({
            tenant_id: input.tenantId,
            terminal_id: input.terminalId,
            registry_id: input.registryId || null,
            reason: input.reason,
            confirm_rebuild: input.confirmRebuild,
        }),
    });

    const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;

    if (!response.ok) {
        throw new Error(getTerminalEdgeErrorMessage(
            payload,
            "No se pudo preparar la reconstruccion local del POS.",
            "Reconstruccion local POS",
        ));
    }

    return (payload || { status: "success" }) as TerminalLocalRebuildResult;
}

export async function requestTerminalErpReadiness(input: RequestTerminalErpReadinessInput): Promise<TerminalErpReadinessResult> {
    const endpoint = `${supabaseProjectUrl.replace(/\/$/, "")}/functions/v1/request-pos-erp-readiness`;
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${await getAdminAccessToken()}`,
            "Content-Type": "application/json",
            "X-Actor-Source": "cloud-admin-ui",
        },
        body: JSON.stringify({
            tenant_id: input.tenantId,
            terminal_id: input.terminalId,
            registry_id: input.registryId || null,
            device_id: input.deviceId,
            terminal_name: input.terminalName || null,
        }),
    });

    const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;

    if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "No se pudo preparar el contexto ERP del POS.");
    }

    return (payload || { status: "pending" }) as TerminalErpReadinessResult;
}

export async function requestTerminalErpProfilePrepare(
    input: RequestTerminalErpProfilePrepareInput,
): Promise<TerminalErpReadinessResult> {
    const endpoint = `${supabaseProjectUrl.replace(/\/$/, "")}/functions/v1/request-terminal-erp-profile`;
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${await getAdminAccessToken()}`,
            "Content-Type": "application/json",
            "X-Actor-Source": "cloud-admin-ui",
        },
        body: JSON.stringify({
            tenant_id: input.tenantId,
            terminal_id: input.terminalId,
            registry_id: input.registryId || null,
            device_id: input.deviceId || null,
            terminal_name: input.terminalName || null,
        }),
    });

    const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;

    if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "No se pudo preparar el perfil ERP de la terminal.");
    }

    return (payload || { status: "pending" }) as TerminalErpReadinessResult;
}

export async function getTerminalSyncPending(
    input: RequestTerminalSyncPendingInput,
): Promise<TerminalSyncPendingResult> {
    const endpoint = `${supabaseProjectUrl.replace(/\/$/, "")}/functions/v1/request-terminal-sync-pending`;
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${await getAdminAccessToken()}`,
            "Content-Type": "application/json",
            "X-Actor-Source": "cloud-admin-ui",
        },
        body: JSON.stringify({
            tenant_id: input.tenantId,
            terminal_id: input.terminalId,
        }),
    });

    const payload = await response.json().catch(() => null) as (TerminalSyncPendingResult & { message?: string; error?: string }) | null;

    if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "No se pudieron cargar los documentos pendientes de la terminal.");
    }

    return payload || {
        status: "success",
        documents: [],
        summary: { pending: 0, repairable: 0, functionalErrors: 0 },
    };
}

export async function retryTerminalSyncPending(
    input: RequestTerminalSyncRetryInput,
): Promise<TerminalSyncRetryResult> {
    const endpoint = `${supabaseProjectUrl.replace(/\/$/, "")}/functions/v1/request-terminal-sync-retry`;
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${await getAdminAccessToken()}`,
            "Content-Type": "application/json",
            "X-Actor-Source": "cloud-admin-ui",
        },
        body: JSON.stringify({
            tenant_id: input.tenantId,
            terminal_id: input.terminalId,
            document_id: input.documentId || null,
            document_ids: input.documentIds || [],
        }),
    });

    const payload = await response.json().catch(() => null) as (TerminalSyncRetryResult & { message?: string; error?: string }) | null;

    if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "No se pudieron reintentar los documentos pendientes.");
    }

    return payload || { status: "success" };
}

export async function getTerminalAuthAttempts(
    tenantId: string,
    terminalId: string,
): Promise<TerminalAuthAttempt[]> {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error("Sesión administrativa requerida.");
    const response = await fetch("/api/terminal-auth-attempts", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-Actor-Source": "cloud-admin-ui",
        },
        body: JSON.stringify({
            tenant_id: tenantId,
            terminal_id: terminalId,
        }),
    });

    const payload = await response.json().catch(() => null) as {
        attempts?: TerminalAuthAttempt[];
        message?: string;
        error?: string;
    } | null;

    if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "No se pudieron cargar los intentos rechazados.");
    }

    return Array.isArray(payload?.attempts) ? payload.attempts : [];
}

type RegistryAuthSyncPayload = {
    device_id?: string;
    current_device_id?: string;
    authorized_device_id?: string;
    auth_status?: string;
    last_auth_error?: string | null;
    last_auth_attempt_at?: string;
    requires_pos_reauth?: boolean;
    updated_at: string;
};

const REGISTRY_OPTIONAL_UPDATE_KEYS = new Set([
    "device_id",
    "current_device_id",
    "authorized_device_id",
    "auth_status",
    "last_auth_error",
    "last_auth_attempt_at",
    "requires_pos_reauth",
    "status",
    "is_revoked",
    "revocation_reason",
]);

function parseMissingRegistryColumn(error: unknown): string | null {
    const haystack = getSupabaseErrorHaystack(error);
    if (!haystack) return null;

    const quotedMatch = haystack.match(/Could not find the '([^']+)' column/i)
        || haystack.match(/'([a-z][a-z0-9_]*)'\s+column/i)
        || haystack.match(/column\s+"([a-z][a-z0-9_]*)"/i)
        || haystack.match(/column\s+'([a-z][a-z0-9_]*)'/i)
        || haystack.match(/column\s+tenant_server_registry\.([a-z][a-z0-9_]*)\s+does not exist/i);

    if (quotedMatch?.[1]) {
        const column = quotedMatch[1];
        if (REGISTRY_OPTIONAL_UPDATE_KEYS.has(column)) return column;
    }

    const lowerHaystack = haystack.toLowerCase();
    for (const column of REGISTRY_OPTIONAL_UPDATE_KEYS) {
        if (lowerHaystack.includes(column)) return column;
    }

    return null;
}

async function updateRegistryWithFallback(
    registryId: string,
    tenantId: string,
    payload: Record<string, unknown>,
): Promise<{ droppedColumns: string[] }> {
    const nextPayload: Record<string, unknown> = { ...payload };
    const droppedColumns: string[] = [];
    const maxAttempts = Math.max(5, Object.keys(nextPayload).length + 3);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (Object.keys(nextPayload).length === 0) {
            throw new Error("Registry update failed: no compatible columns remain for this database.");
        }

        const { error } = await supabaseAdmin
            .from("tenant_server_registry")
            .update(nextPayload)
            .eq("id", registryId)
            .eq("tenant_id", tenantId);

        if (!error) return { droppedColumns };

        const missingColumn = parseMissingRegistryColumn(error);
        if (missingColumn && missingColumn in nextPayload) {
            droppedColumns.push(missingColumn);
            delete nextPayload[missingColumn];
            continue;
        }

        throw error;
    }

    throw new Error("Registry update failed after retrying without optional columns.");
}

async function updateRegistryAuthSyncWithFallback(
    registryId: string,
    tenantId: string,
    payload: RegistryAuthSyncPayload,
): Promise<{ droppedColumns: string[] }> {
    return updateRegistryWithFallback(registryId, tenantId, payload as Record<string, unknown>);
}

export async function syncTerminalAuthorizedDevice(input: {
    tenantId: string;
    terminalId: string;
    registryId: string;
    deviceId: string;
}): Promise<TerminalDeviceActionResult> {
    if (isBrowserRuntime) return invokeAdminCommand("sync_terminal_authorized_device", { input });
    const deviceId = input.deviceId.trim();
    const { data: tenant, error: tenantError } = await supabaseAdmin
        .from("tenants")
        .select("id, status, contracted_product")
        .eq("id", input.tenantId)
        .maybeSingle();

    if (tenantError) throw tenantError;
    if (!tenant) throw new Error("Tenant no encontrado.");
    if (!isOperationalTenantStatus(tenant.status)) {
        throw new Error("No se puede sincronizar si el tenant esta suspendido o inactivo.");
    }
    if (tenant.contracted_product !== "POS_ONLY") {
        throw new Error("Sincronizar device autorizado solo aplica a tenants POS_ONLY.");
    }

    const { data: registry, error: registryError } = await supabaseAdmin
        .from("tenant_server_registry")
        .select("id, tenant_id, device_id, current_device_id")
        .eq("tenant_id", input.tenantId)
        .eq("id", input.registryId)
        .maybeSingle();

    if (registryError) throw registryError;
    if (!registry) throw new Error("No hay registro de servidor para sincronizar.");

    const registryDeviceId = registry.device_id?.trim() || registry.current_device_id?.trim() || "";
    if (!registryDeviceId || registryDeviceId !== deviceId) {
        throw new Error("El device solicitado no coincide con el registro online de la terminal.");
    }

    const currentDeviceId = registry.current_device_id?.trim() || "";
    if (registry.device_id?.trim() === deviceId && currentDeviceId === deviceId) {
        return {
            status: "success",
            success: true,
            action: "authorized_device_already_synced",
            authorized_device_id: deviceId,
            message: "El device autorizado ya estaba persistido en Cloud-Admin.",
        };
    }

    const completedAt = new Date().toISOString();
    const { droppedColumns } = await updateRegistryAuthSyncWithFallback(registry.id, input.tenantId, {
        device_id: deviceId,
        current_device_id: deviceId,
        authorized_device_id: deviceId,
        auth_status: "AUTHORIZED",
        last_auth_error: null,
        last_auth_attempt_at: completedAt,
        requires_pos_reauth: false,
        updated_at: completedAt,
    });

    const missingAuthColumns = droppedColumns.includes("authorized_device_id")
        || droppedColumns.includes("auth_status");

    return {
        status: "success",
        success: true,
        action: "authorized_device_synced",
        authorized_device_id: deviceId,
        message: missingAuthColumns
            ? "Device sincronizado en columnas legacy (device_id/current_device_id). Aplica la migracion 202605271015_terminal_device_authorization en Supabase para persistir authorized_device_id."
            : "Device autorizado persistido en Cloud-Admin. El POS puede reintentar conexion.",
    };
}

export async function requestTerminalDeviceAction(
    input: RequestTerminalDeviceActionInput,
): Promise<TerminalDeviceActionResult> {
    if (input.action === "SYNC_AUTHORIZED_DEVICE") {
        if (!input.registryId) {
            throw new Error("registry_id requerido para sincronizar device autorizado.");
        }
        if (!input.deviceId) {
            throw new Error("DEVICE_ID_REQUIRED: device_id requerido para sincronizar device autorizado.");
        }
        return syncTerminalAuthorizedDevice({
            tenantId: input.tenantId,
            terminalId: input.terminalId,
            registryId: input.registryId,
            deviceId: input.deviceId,
        });
    }

    const idempotencyKey = input.action === "TAKEOVER"
        ? input.idempotencyKey || crypto.randomUUID()
        : input.idempotencyKey;
    const { data: sessionData } = await supabase.auth.getSession();
    const actor = sessionData.session?.user;
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error("Sesión administrativa requerida.");
    const response = await fetch("/api/terminal-device-action", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-Actor-Source": "cloud-admin-ui",
            "X-Actor-User-Id": actor?.id || "",
            "X-Actor-Email": actor?.email || "",
            ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: JSON.stringify({
            tenant_id: input.tenantId,
            terminal_id: input.terminalId,
            catalog_terminal_id: input.catalogTerminalId || null,
            store_id: input.storeId || null,
            registry_id: input.registryId || null,
            terminal_name: input.terminalName || null,
            device_name: input.deviceName || null,
            device_id: input.deviceId || null,
            request_id: input.requestId || null,
            expected_authorized_device_id: input.expectedAuthorizedDeviceId || null,
            action: input.action,
            reason: input.action === "TAKEOVER"
                ? "CLOUD_ADMIN_TERMINAL_REAUTHORIZATION"
                : input.reason,
            requested_by: actor?.email || actor?.id || "cloud-admin-ui",
            takeover: input.action === "TAKEOVER",
            rotate_device_token: input.action === "TAKEOVER",
            idempotency_key: idempotencyKey || null,
            confirm_action: true,
        }),
    });

    const payload = await response.json().catch(() => null) as (TerminalDeviceActionResult & { message?: string; error?: string }) | null;

    if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "No se pudo ejecutar la accion de autorizacion.");
    }

    if (input.action === "TAKEOVER") {
        const contractValid = payload?.terminal_id === input.terminalId
            && payload.previous_device_id !== undefined
            && payload.authorized_device_id === input.deviceId
            && payload.new_device_id === input.deviceId
            && payload.takeover_confirmed === true
            && payload.previous_device_revoked === true
            && payload.rotate_device_token === true
            && payload.operation_id === idempotencyKey;
        const requestContractValid = !input.requestId
            || (payload?.request_id === input.requestId && payload.request_status?.toUpperCase() === "APPROVED");
        if (!contractValid || !requestContractValid) {
            throw new Error(
                "ERP_TAKEOVER_CONFIRMATION_INVALID: la respuesta no confirmó terminal, solicitud aprobada, dispositivo autorizado, revocación y rotación de credenciales.",
            );
        }
    }

    return (payload || { status: "success" }) as TerminalDeviceActionResult;
}

export async function rejectTerminalDeviceRequest(
    input: RejectTerminalDeviceRequestInput,
): Promise<TerminalDeviceRequestResult> {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error("Sesión administrativa requerida.");
    const idempotencyKey = input.idempotencyKey || crypto.randomUUID();
    const response = await fetch("/api/terminal-device-request", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
            tenant_id: input.tenantId,
            terminal_id: input.terminalId,
            request_id: input.requestId,
            requested_device_id: input.requestedDeviceId,
            reason: "CLOUD_ADMIN_TERMINAL_DEVICE_REQUEST_REJECTED",
            idempotency_key: idempotencyKey,
        }),
    });
    const payload = await response.json().catch(() => null) as (TerminalDeviceRequestResult & { message?: string; error?: string }) | null;
    if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "No se pudo rechazar la solicitud de dispositivo.");
    }
    if (payload?.request_id !== input.requestId || payload.request_status !== "REJECTED") {
        throw new Error("ERP_REJECTION_CONFIRMATION_INVALID: el ERP no confirmó la solicitud rechazada.");
    }
    return payload;
}

export async function getTerminalDeviceAudit(
    tenantId: string,
    terminalId: string,
    limit = 20,
): Promise<TerminalDeviceAuditEntry[]> {
    if (isBrowserRuntime) return invokeAdminCommand("get_terminal_device_audit", { tenantId, terminalId, limit });
    const { data, error } = await supabaseAdmin
        .from("terminal_device_audit")
        .select("id,terminal_id,terminal_name,old_device_id,new_device_id,performed_by,performed_at,result,action,reason,erp_error_code,metadata")
        .eq("tenant_id", tenantId)
        .eq("terminal_id", terminalId)
        .order("performed_at", { ascending: false })
        .limit(limit);
    if (error) throw error;
    return (data || []) as TerminalDeviceAuditEntry[];
}

export async function requestTerminalReconciliation(
    input: RequestTerminalReconciliationInput,
): Promise<TerminalReconciliationResult> {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error("Sesión administrativa requerida para reconciliar terminales.");

    const response = await fetch("/api/terminal-reconciliation", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            mode: input.mode,
            tenant_id: input.tenantId,
            source_registry_id: input.sourceRegistryId || null,
            target_erp_terminal_id: input.targetErpTerminalId || null,
            target_store_id: input.targetStoreId || null,
            authorized_device_id: input.authorizedDeviceId || null,
            reason: input.reason,
            correlation_id: input.correlationId,
            expected_plan_hash: input.expectedPlanHash || null,
            admin_confirmed: input.adminConfirmed === true,
        }),
    });
    const payload = await response.json().catch(() => null) as TerminalReconciliationResult & { error?: string } | null;
    if (!response.ok) throw new Error(payload?.message || payload?.error || "No se pudo reconciliar la terminal.");
    return payload || { status: "success", correlation_id: input.correlationId };
}

export type TenantPosLicenseSeats = {
    usedSeats: number;
    maxSeats: number;
    licenseUnit: "terminal_id" | "device_id" | string;
};

export async function getTenantPosLicenseSeats(tenantId: string): Promise<TenantPosLicenseSeats> {
    if (isBrowserRuntime) return invokeAdminCommand("get_tenant_pos_license_seats", { tenantId });
    const { data, error } = await supabaseAdmin.rpc("count_tenant_pos_license_seats", {
        p_tenant_id: tenantId,
    });

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    const record = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;

    return {
        usedSeats: Number(record.used_seats ?? 0),
        maxSeats: Number(record.max_seats ?? 1),
        licenseUnit: typeof record.license_unit === "string" ? record.license_unit : "device_id",
    };
}

export async function releaseTerminalLicenseSlot(input: {
    tenantId: string;
    registryId: string;
    deviceId: string;
}): Promise<{ message: string }> {
    if (isBrowserRuntime) return invokeAdminCommand("release_terminal_license_slot", { input });
    const deviceId = input.deviceId.trim();
    const { data: tenant, error: tenantError } = await supabaseAdmin
        .from("tenants")
        .select("id, contracted_product, type")
        .eq("id", input.tenantId)
        .maybeSingle();

    if (tenantError) throw tenantError;
    if (!tenant) throw new Error("Tenant no encontrado.");

    const usesErpCatalog = tenant.contracted_product === "POS_ERP";
    if (usesErpCatalog) {
        throw new Error(
            "POS+ERP controla licencias al crear terminales en el ERP. Elimine la terminal en el ERP para liberar cupo.",
        );
    }

    const { data: registry, error: registryError } = await supabaseAdmin
        .from("tenant_server_registry")
        .select("id, tenant_id, device_id, terminal_id, terminal_name, status, is_revoked, auth_status")
        .eq("tenant_id", input.tenantId)
        .eq("id", input.registryId)
        .maybeSingle();

    if (registryError) throw registryError;
    if (!registry) throw new Error("Registro de terminal no encontrado.");
    if (registry.device_id?.trim() !== deviceId) {
        throw new Error("El device_id no coincide con el registro seleccionado.");
    }

    const usesTerminalSlots = tenant.contracted_product === "POS_ONLY" || tenant.type === "pos_only";
    const terminalId = registry.terminal_id?.trim() || "";
    const terminalName = registry.terminal_name?.trim() || terminalId || "caja";
    const releasedAt = new Date().toISOString();

    const releasePayload = {
        status: "OFFLINE",
        is_revoked: true,
        auth_status: "OLD_DEVICE_REVOKED",
        revocation_reason: "MANUAL_RELEASE_LICENSE_SLOT",
        requires_pos_reauth: false,
        authorized_device_id: null,
        current_device_id: null,
        last_auth_error: null,
        is_primary: false,
        updated_at: releasedAt,
    } as Record<string, unknown>;

    if (usesTerminalSlots && terminalId) {
        const { data: slotRows, error: slotError } = await supabaseAdmin
            .from("tenant_server_registry")
            .select("id, status, is_revoked, auth_status")
            .eq("tenant_id", input.tenantId)
            .eq("terminal_id", terminalId);

        if (slotError) throw slotError;

        let releasedCount = 0;
        for (const row of slotRows || []) {
            const alreadyReleased = row.status === "OFFLINE"
                || row.is_revoked === true
                || row.auth_status === "OLD_DEVICE_REVOKED";
            if (alreadyReleased) continue;

            await updateRegistryWithFallback(row.id, input.tenantId, releasePayload);
            releasedCount += 1;
        }

        try {
            await enforceTenantPosLicenseLimits(input.tenantId);
        } catch (enforceError) {
            console.warn("POS license re-balance after release failed", enforceError);
        }

        const seats = await getTenantPosLicenseSeats(input.tenantId);

        return {
            message: releasedCount > 0
                ? `Cupo de ${terminalName} liberado (${releasedCount} equipo(s)). Cupo usado ahora: ${seats.usedSeats}/${seats.maxSeats}. Active el nuevo Android en la misma caja o con otro nombre unico.`
                : `La caja ${terminalName} ya estaba liberada. Cupo usado: ${seats.usedSeats}/${seats.maxSeats}.`,
        };
    }

    const alreadyReleased = registry.status === "OFFLINE"
        || registry.is_revoked === true
        || registry.auth_status === "OLD_DEVICE_REVOKED";

    if (!alreadyReleased) {
        await updateRegistryWithFallback(registry.id, input.tenantId, releasePayload);
    }

    try {
        await enforceTenantPosLicenseLimits(input.tenantId);
    } catch (enforceError) {
        console.warn("POS license re-balance after release failed", enforceError);
    }

    const seats = await getTenantPosLicenseSeats(input.tenantId);

    return {
        message: alreadyReleased
            ? `Este equipo ya estaba liberado. Cupo usado: ${seats.usedSeats}/${seats.maxSeats}.`
            : `Cupo liberado para ${deviceId}. Cupo usado: ${seats.usedSeats}/${seats.maxSeats}.`,
    };
}

export async function enforceTenantPosLicenseLimits(tenantId: string): Promise<Record<string, unknown>> {
    if (isBrowserRuntime) return invokeAdminCommand("enforce_tenant_pos_license_limits", { tenantId });
    const { data, error } = await supabaseAdmin.rpc("enforce_tenant_pos_license_limits", {
        p_tenant_id: tenantId,
    });

    if (error) throw error;
    return (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
}

/** Quita lifecycle BLOCKED dejado por readiness ERP fallido en tenants POS_ONLY. */
export async function releasePosOnlyProvisioningBlock(tenantId: string): Promise<void> {
    if (isBrowserRuntime) return invokeAdminCommand("release_pos_only_provisioning_block", { tenantId });
    const { error } = await supabaseAdmin
        .from("tenants")
        .update({
            lifecycle_status: "CLOUD_READY",
            provisioning_status: "CLOUD_STAGING_REQUIRED",
        })
        .eq("id", tenantId);

    if (error) throw error;
}

export async function getTerminalFiscalDebug(
    input: RequestTerminalFiscalReadinessInput,
): Promise<TerminalFiscalReadiness> {
    const endpoint = `${supabaseProjectUrl.replace(/\/$/, "")}/functions/v1/request-terminal-fiscal-debug`;
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${await getAdminAccessToken()}`,
            "Content-Type": "application/json",
            "X-Actor-Source": "cloud-admin-ui",
        },
        body: JSON.stringify({
            tenant_id: input.tenantId,
            terminal_id: input.terminalId,
            registry_id: input.registryId || null,
        }),
    });

    const payload = await response.json().catch(() => null) as TerminalFiscalReadinessResult & { error?: string } | null;

    if (!response.ok) {
        throw new Error(getTerminalEdgeErrorMessage(
            payload,
            "No se pudo verificar el mapping fiscal de la terminal.",
            "Mapping fiscal de terminal",
        ));
    }

    return payload?.readiness || payload?.fiscal_readiness || { status: "MISSING" };
}

export async function getTerminalFiscalReadiness(
    input: RequestTerminalFiscalReadinessInput,
): Promise<TerminalFiscalReadiness> {
    const endpoint = `${supabaseProjectUrl.replace(/\/$/, "")}/functions/v1/request-terminal-fiscal-readiness`;
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${await getAdminAccessToken()}`,
            "Content-Type": "application/json",
            "X-Actor-Source": "cloud-admin-ui",
        },
        body: JSON.stringify({
            tenant_id: input.tenantId,
            terminal_id: input.terminalId,
            registry_id: input.registryId || null,
        }),
    });

    const payload = await response.json().catch(() => null) as TerminalFiscalReadinessResult & { error?: string } | null;

    if (!response.ok) {
        throw new Error(getTerminalEdgeErrorMessage(
            payload,
            "No se pudo cargar la configuracion fiscal de la terminal.",
            "Configuracion fiscal de terminal",
        ));
    }

    return payload?.readiness || payload?.fiscal_readiness || { status: "MISSING" };
}

export async function requestTerminalFiscalConfig(
    input: RequestTerminalFiscalConfigInput,
): Promise<TerminalFiscalConfigResult> {
    const endpoint = `${supabaseProjectUrl.replace(/\/$/, "")}/functions/v1/request-terminal-fiscal-config`;
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${await getAdminAccessToken()}`,
            "Content-Type": "application/json",
            "X-Actor-Source": "cloud-admin-ui",
        },
        body: JSON.stringify({
            tenant_id: input.tenantId,
            terminal_id: input.terminalId,
            registry_id: input.registryId || null,
            terminal_name: input.terminalName || null,
            mode: input.mode,
            config: input.config || null,
        }),
    });

    const payload = await response.json().catch(() => null) as TerminalFiscalConfigResult & { error?: string } | null;

    if (!response.ok) {
        throw new Error(getTerminalEdgeErrorMessage(
            payload,
            "No se pudo configurar fiscalmente la terminal.",
            "Configuracion fiscal de terminal",
        ));
    }

    return payload || { status: "success", mode: input.mode };
}

export async function getDashboardStats(): Promise<DashboardStats> {
    if (isBrowserRuntime) return invokeAdminCommand("get_dashboard_stats");
    const [tenantsRes, terminalsRes, subscriptionRows, ticketRows] = await Promise.all([
        supabaseAdmin.from("tenants").select("id,name,status,created_at,last_sync_received_at,cloud_channel"),
        supabaseAdmin.schema("public").from("terminals").select("id", { count: "exact", head: true }),
        getDashboardSubscriptions(),
        getDashboardTickets(),
    ]);

    if (tenantsRes.error) throw tenantsRes.error;
    if (terminalsRes.error) throw terminalsRes.error;

    const tenantRows = ((tenantsRes.data as Array<Pick<Tenant, "id" | "name" | "status" | "created_at" | "last_sync_received_at" | "cloud_channel">>) || []);
    const tenantsById = new Map(tenantRows.map((tenant) => [tenant.id, tenant]));
    const activeTenants = tenantRows.filter((tenant) => tenant.status === "ACTIVE").length;
    const trialTenants = tenantRows.filter((tenant) => tenant.status === "TRIAL").length;
    const suspendedTenants = tenantRows.filter((tenant) => tenant.status === "SUSPENDED").length;
    const today = startOfDay(new Date());
    const activeSubscriptions = subscriptionRows.filter((subscription) => subscription.is_active).length;
    const expiringSubscriptions = subscriptionRows
        .filter((subscription) => subscription.is_active && Boolean(subscription.end_date))
        .map((subscription) => {
            const endDate = startOfDay(new Date(subscription.end_date as string));
            const daysRemaining = Math.ceil((endDate.getTime() - today.getTime()) / 86400000);
            const tenant = tenantsById.get(subscription.tenant_id);

            return {
                tenantId: subscription.tenant_id,
                tenantName: tenant?.name || "Tenant no identificado",
                planName: subscription.plan_name || "Plan activo",
                endDate: subscription.end_date as string,
                daysRemaining,
            };
        })
        .filter((subscription) => subscription.daysRemaining >= 0 && subscription.daysRemaining <= 30)
        .sort((a, b) => a.daysRemaining - b.daysRemaining)
        .slice(0, 5);
    const openTickets = ticketRows.filter((ticket) => !["Cerrado", "Resuelto"].includes(ticket.status)).length;
    const criticalTickets = ticketRows.filter((ticket) => {
        const isOpen = !["Cerrado", "Resuelto"].includes(ticket.status);
        return isOpen && ticket.priority.toLowerCase().startsWith("cr");
    }).length;
    const recentTickets = ticketRows
        .slice(0, 5)
        .map((ticket) => ({
            id: ticket.id,
            subject: ticket.subject,
            priority: ticket.priority,
            status: ticket.status,
            tenantName: ticket.tenant_id ? tenantsById.get(ticket.tenant_id)?.name || "Sin tenant asignado" : "Sin tenant asignado",
            createdAt: ticket.created_at,
        }));
    const inactivityThreshold = Date.now() - (3 * 86400000);
    const inactiveTenants = tenantRows
        .filter((tenant) => ['ACTIVE', 'TRIAL'].includes(tenant.status) && tenant.cloud_channel !== 'NONE')
        .map((tenant) => {
            const lastActivityAt = tenant.last_sync_received_at || tenant.created_at;
            return {
                tenantId: tenant.id,
                tenantName: tenant.name,
                lastActivityAt: tenant.last_sync_received_at || null,
                daysInactive: Math.max(0, Math.floor((Date.now() - new Date(lastActivityAt).getTime()) / 86400000)),
                status: tenant.status,
                activityTimestamp: new Date(lastActivityAt).getTime(),
            };
        })
        .filter((tenant) => tenant.activityTimestamp < inactivityThreshold)
        .sort((a, b) => a.activityTimestamp - b.activityTimestamp)
        .slice(0, 10)
        .map((tenant) => ({
            tenantId: tenant.tenantId,
            tenantName: tenant.tenantName,
            lastActivityAt: tenant.lastActivityAt,
            daysInactive: tenant.daysInactive,
            status: tenant.status,
        }));

    return {
        totalTenants: tenantRows.length,
        activeTenants,
        trialTenants,
        suspendedTenants,
        terminals: terminalsRes.count || 0,
        activeSubscriptions,
        openTickets,
        criticalTickets,
        tenantGrowth: buildTenantGrowth(tenantRows),
        recentTickets,
        expiringSubscriptions,
        inactiveTenants,
        supportSatisfaction: buildSupportSatisfaction(ticketRows),
        lastUpdatedAt: new Date().toISOString(),
    };
}

function startOfDay(value: Date): Date {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

type DashboardSubscriptionRow = {
    tenant_id: string;
    is_active: boolean;
    end_date?: string | null;
    plan_name?: string | null;
};

type DashboardTicketRow = {
    id: string;
    subject: string;
    priority: string;
    status: string;
    tenant_id?: string | null;
    customer_rating?: number | null;
    created_at: string;
};

async function getDashboardSubscriptions(): Promise<DashboardSubscriptionRow[]> {
    const { data, error } = await supabaseAdmin
        .from("subscriptions")
        .select("tenant_id,is_active,end_date,plan_name");

    if (!error) return (data as DashboardSubscriptionRow[]) || [];

    const code = (error as { code?: string }).code;
    if (code !== "42703" && code !== "PGRST204") {
        console.warn("Dashboard subscriptions unavailable:", error);
        return [];
    }

    const fallback = await supabaseAdmin
        .from("subscriptions")
        .select("tenant_id,is_active,plan_name");

    if (fallback.error) {
        console.warn("Dashboard subscriptions fallback unavailable:", fallback.error);
        return [];
    }

    return ((fallback.data as DashboardSubscriptionRow[]) || []).map((subscription) => ({
        ...subscription,
        end_date: null,
    }));
}

async function getDashboardTickets(): Promise<DashboardTicketRow[]> {
    const { data, error } = await supabaseAdmin
        .from("support_tickets")
        .select("id,subject,priority,status,tenant_id,customer_rating,created_at")
        .order("created_at", { ascending: false });

    if (error) {
        console.warn("Dashboard support tickets unavailable:", error);
        return [];
    }

    return (data as DashboardTicketRow[]) || [];
}

function buildSupportSatisfaction(tickets: DashboardTicketRow[]): DashboardSupportSatisfaction {
    const ratings = tickets
        .map((ticket) => ticket.customer_rating)
        .filter((rating): rating is number => typeof rating === "number" && rating >= 1 && rating <= 5);
    const totalResponses = ratings.length;
    const excellent = ratings.filter((rating) => rating === 5).length;
    const good = ratings.filter((rating) => rating >= 3 && rating <= 4).length;
    const bad = ratings.filter((rating) => rating <= 2).length;

    const percentage = (count: number) => totalResponses ? Math.round((count / totalResponses) * 100) : 0;

    return {
        totalResponses,
        excellent: {
            count: excellent,
            percentage: percentage(excellent),
        },
        good: {
            count: good,
            percentage: percentage(good),
        },
        bad: {
            count: bad,
            percentage: percentage(bad),
        },
    };
}

function buildTenantGrowth(tenants: Array<Pick<Tenant, "created_at">>): DashboardTrendPoint[] {
    const formatter = new Intl.DateTimeFormat("es-DO", { month: "short" });
    const now = new Date();
    const buckets: DashboardTrendPoint[] = [];

    for (let index = 5; index >= 0; index -= 1) {
        const month = new Date(now.getFullYear(), now.getMonth() - index, 1);
        buckets.push({
            name: formatter.format(month).replace(".", ""),
            value: 0,
        });
    }

    tenants.forEach((tenant) => {
        const createdAt = new Date(tenant.created_at);
        const diffMonths = (now.getFullYear() - createdAt.getFullYear()) * 12 + now.getMonth() - createdAt.getMonth();

        if (diffMonths >= 0 && diffMonths < buckets.length) {
            buckets[buckets.length - 1 - diffMonths].value += 1;
        }
    });

    return buckets;
}

export async function suspendTenant(id: string): Promise<void> {
    if (isBrowserRuntime) return invokeAdminCommand("suspend_tenant", { id });
    const { error } = await supabaseAdmin
        .from("tenants")
        .update({ status: "SUSPENDED" })
        .eq("id", id);
    if (error) throw error;
}

export async function reactivateTenant(id: string): Promise<void> {
    if (isBrowserRuntime) return invokeAdminCommand("reactivate_tenant", { id });
    const { error } = await supabaseAdmin
        .from("tenants")
        .update({ status: "ACTIVE" })
        .eq("id", id);
    if (error) throw error;
}

export async function updateTenantCredentials(
    tenantId: string,
    payload: { email?: string; password?: string }
): Promise<void> {
    if (isBrowserRuntime) return invokeAdminCommand("update_tenant_credentials", { tenantId, update: payload });
    const { email, password } = payload;
    if (!email && !password) return;

    // 1. Get the current tenant to get the current email
    const { data: tenant, error: fetchErr } = await supabaseAdmin
        .from("tenants")
        .select("email")
        .eq("id", tenantId)
        .single();

    if (fetchErr) throw fetchErr;

    // 2. Find the user in Auth by current email or tenant_id
    const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
    if (listErr) throw listErr;

    const authUser = users.find((u) => u.email === (tenant as { email: string }).email || u.user_metadata?.tenant_id === tenantId);
    if (!authUser) throw new Error("Usuario de autenticación no encontrado para este tenant");

    // 3. Update Auth
    const updateData: { email?: string; password?: string; email_confirm?: boolean } = {};
    if (email && email.trim().toLowerCase() !== (tenant as { email: string }).email) {
        updateData.email = email.trim().toLowerCase();
        updateData.email_confirm = true;
    }
    if (password && password.trim()) {
        updateData.password = password.trim();
    }

    if (Object.keys(updateData).length > 0) {
        const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, updateData);
        if (authErr) throw authErr;
    }

    // 4. Update DB if email changed
    if (email && email.trim().toLowerCase() !== (tenant as { email: string }).email) {
        const { error: dbErr } = await supabaseAdmin
            .from("tenants")
            .update({ email: email.trim().toLowerCase() })
            .eq("id", tenantId);
        if (dbErr) throw dbErr;
    }
}

export async function toggleTerminalActiveStatus(terminalId: string, isActive: boolean): Promise<void> {
    if (isBrowserRuntime) return invokeAdminCommand("toggle_terminal_active_status", { terminalId, isActive });
    const { data: terminal, error: getErr } = await supabaseAdmin
        .schema("public")
        .from("erp_terminals")
        .select("config")
        .eq("id", terminalId)
        .single();
    
    if (getErr) throw getErr;

    const config = terminal.config || {};
    config.is_active = isActive;

    const { error: setErr } = await supabaseAdmin
        .schema("public")
        .from("erp_terminals")
        .update({ config })
        .eq("id", terminalId);
    
    if (setErr) throw setErr;
}

export async function registerTenantServerEndpoint(payload: {
    tenantId: string;
    deviceId: string;
    terminalId: string;
    terminalName?: string;
    hostname?: string;
    protocol?: string;
    port?: number;
    localIp: string;
    localIps?: string[];
    endpointUrl?: string;
    isPrimary?: boolean;
    appVersion?: string;
    appVersionCode?: number;
}): Promise<void> {
    if (isBrowserRuntime) return invokeAdminCommand("register_tenant_server_endpoint", { input: payload });
    const { error } = await supabaseAdmin.rpc("register_tenant_server_endpoint", {
        p_tenant_id: payload.tenantId,
        p_device_id: payload.deviceId,
        p_terminal_id: payload.terminalId,
        p_terminal_name: payload.terminalName || null,
        p_hostname: payload.hostname || null,
        p_protocol: payload.protocol || 'http',
        p_port: payload.port || 3001,
        p_local_ip: payload.localIp,
        p_local_ips: payload.localIps || [payload.localIp],
        p_endpoint_url: payload.endpointUrl || null,
        p_is_primary: payload.isPrimary !== false,
        p_app_version: payload.appVersion || null,
        p_app_version_code: payload.appVersionCode || null,
        p_status: 'ONLINE',
        p_last_seen_at: new Date().toISOString()
    });

    if (error) throw error;
}

export const tenantService = {
    createTenant,
    verifyTenantEmail,
    changeTenantPassword,
    getTenants,
    updateTenantTaxId,
    updateTenant,
    deleteTenant,
    getDistributors,
    getTenantTerminalOverview,
    requestTerminalTakeover,
    requestTerminalLocalRebuild,
    requestTerminalErpReadiness,
    requestTerminalErpProfilePrepare,
    getTerminalSyncPending,
    retryTerminalSyncPending,
    getTerminalAuthAttempts,
    rejectTerminalDeviceRequest,
    getTerminalDeviceAudit,
    requestTerminalDeviceAction,
    requestTerminalReconciliation,
    syncTerminalAuthorizedDevice,
    enforceTenantPosLicenseLimits,
    getTenantPosLicenseSeats,
    releaseTerminalLicenseSlot,
    releasePosOnlyProvisioningBlock,
    getTerminalFiscalDebug,
    getTerminalFiscalReadiness,
    requestTerminalFiscalConfig,
    getDashboardStats,
    suspendTenant,
    reactivateTenant,
    updateTenantCredentials,
    toggleTerminalActiveStatus,
    registerTenantServerEndpoint,
};
