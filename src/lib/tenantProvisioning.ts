import type {
    CloudChannel,
    ContractedProduct,
    DataMaster,
    PosVariant,
    PosRuntime,
    TenantLifecycleStatus,
    TenantProvisioningStatus,
    TenantType,
} from "../types.js";
import { deriveTenantSemanticsFromTenant, type TenantSemanticConfig } from "./tenantProducts.js";
import { buildTenantAuthMetadataPayload } from "./tenantAuthMetadata.js";

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

export interface SupabaseAdminClient {
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

export interface ProvisionTenantInput {
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
    contractedProduct?: ContractedProduct;
    posVariant?: PosVariant;
    offlineMode?: boolean;
    explicitOffline?: boolean;
    cloudDisabledReason?: string | null;
    posRuntime?: PosRuntime;
    cloudChannel?: CloudChannel;
    dataMaster?: DataMaster;
    cloudSyncEnabled?: boolean;
    erpCoreEnabled?: boolean;
    erpUiEnabled?: boolean;
    customerErpAccess?: boolean;
    backupEnabled?: boolean;
    lifecycleStatus?: TenantLifecycleStatus;
    provisioningStatus?: TenantProvisioningStatus;
    maxPosTerminals?: number;
    maxErpUsers?: number;
    initialPassword?: string;
}

export interface ProvisionTenantResult {
    tenantId: string;
    tempPassword: string;
}

function normalizeOptional(value?: string | null): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function normalizeTenantLicenseLimit(value?: number): number {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 1;
    return Math.max(1, Math.trunc(numericValue));
}

export function getTenantLicenseProvisioningMismatch(
    tenant: unknown,
    expectedMaxPosTerminals: number,
    expectedMaxErpUsers: number,
): string | null {
    if (!tenant || typeof tenant !== "object") {
        return "No se pudo verificar el tenant recién creado.";
    }

    const row = tenant as Record<string, unknown>;
    if (Number(row.max_pos_terminals) !== expectedMaxPosTerminals) {
        return `Las licencias POS no se guardaron correctamente (${String(row.max_pos_terminals)} de ${expectedMaxPosTerminals}).`;
    }
    if (Number(row.max_erp_users) !== expectedMaxErpUsers) {
        return `Las licencias ERP no se guardaron correctamente (${String(row.max_erp_users)} de ${expectedMaxErpUsers}).`;
    }
    return null;
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

function normalizeTenantSemantics(input: ProvisionTenantInput): TenantSemanticConfig {
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

export async function provisionTenant(
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
        contractedProduct,
        posVariant,
        offlineMode,
        explicitOffline,
        cloudDisabledReason,
        posRuntime,
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
        initialPassword,
    }: ProvisionTenantInput,
): Promise<ProvisionTenantResult> {
    const accessEmail = email.trim().toLowerCase();
    const contactMail = contactEmail.trim().toLowerCase();
    const tempPassword = initialPassword?.trim() || generateTempPassword();
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
        posVariant,
        offlineMode,
        explicitOffline,
        cloudDisabledReason,
        posRuntime,
        cloudChannel,
        dataMaster,
        cloudSyncEnabled,
        erpCoreEnabled,
        erpUiEnabled,
        customerErpAccess,
        backupEnabled,
        lifecycleStatus,
        provisioningStatus,
        initialPassword,
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
            Array.isArray(tenantRows) ? tenantRows[0] : null,
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
        buildTenantAuthMetadataPayload(tenantId, {
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
        }),
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
