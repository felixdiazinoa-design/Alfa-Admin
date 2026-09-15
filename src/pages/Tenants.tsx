import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Plus, Power, Edit3, Loader2, X, Boxes, Monitor, Wifi, WifiOff, Trash2, RefreshCcw, KeyRound, ShieldCheck, Ban, CheckCircle2, Unlink, Puzzle } from 'lucide-react';
import type { CloudAdminPermissions, Distributor, Tenant, TerminalAuthAttempt, TerminalFiscalReadiness, TerminalSyncDocument, TerminalSyncPendingResult, TenantTerminalErpReadiness, TenantTerminalSnapshot } from '../types';
import { tenantService, type TerminalDeviceAuditEntry, type TenantPosLicenseSeats, type TerminalReconciliationResult } from '../lib/tenantService';
import { TenantProductsModal } from '../components/TenantProductsModal';
import { ErpModuleStoreModal } from '../components/ErpModuleStoreModal';
import { hasCloudAdminPermission } from '../lib/cloudAdminPermissions';
import { getLatestAvailablePosApkRelease, type PosApkReleaseReference } from '../lib/posApkReleases';
import {
    deriveProductsFromTenant,
    deriveTenantConfigFromProducts,
    deriveTenantSemanticsFromProducts,
    deriveTenantSemanticsFromTenant,
    getActiveProductLabels,
    getDefaultTenantProducts,
    getTenantTypeLabel,
    normalizeTenantProductSelection,
    type TenantSemanticConfig,
    type TenantProductSelection
} from '../lib/tenantProducts';
import {
    buildTerminalIdentitySummary,
    CANONICAL_ERP_IDENTITY_REQUIRED_MESSAGE,
    getAttemptDeviceId,
    getDeviceRoleClasses,
    getDeviceRoleLabel,
    getRegistryEndpointRole,
    getTerminalAuthStatus,
    getTerminalAuthorizedDeviceId,
    getTerminalPersistedAuthorizedDeviceId,
    getTerminalPosReportedDeviceId,
    hasCanonicalErpBinding,
    isPendingDeviceUnauthorizedAttempt,
    summarizeTerminalFiscalDebug,
} from '../lib/terminalIdentity';
import { buildTerminalReconciliationPreview } from '../lib/terminalReconciliation';

type TerminalTabKey = 'summary' | 'devices' | 'erp' | 'sync' | 'fiscal' | 'attempts';
type TerminalRequestFilter = 'ALL' | 'PENDING';

type ReconciliationDraft = {
    erpTerminalUuid: string;
    targetTerminalName: string;
    storeId: string;
    authorizedDeviceId: string;
    reason: string;
    adminConfirmed: boolean;
    correlationId: string;
    serverPreview: TerminalReconciliationResult | null;
};

const buildTenantSlug = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

export const Tenants: React.FC<{ permissions?: Partial<CloudAdminPermissions> | null }> = ({ permissions }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [distributors, setDistributors] = useState<Distributor[]>([]);
    const [loading, setLoading] = useState(true);
    const [distributorsLoading, setDistributorsLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isEditSubmitting, setIsEditSubmitting] = useState(false);
    const [isCreateProductsModalOpen, setIsCreateProductsModalOpen] = useState(false);
    const [isEditProductsModalOpen, setIsEditProductsModalOpen] = useState(false);
    const [createProductsModalVersion, setCreateProductsModalVersion] = useState(0);
    const [editProductsModalVersion, setEditProductsModalVersion] = useState(0);
    const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
    const [moduleStoreTenant, setModuleStoreTenant] = useState<Tenant | null>(null);
    const [activeModuleCounts, setActiveModuleCounts] = useState<Record<string, number>>({});
    const [selectedTenantForTerminals, setSelectedTenantForTerminals] = useState<Tenant | null>(null);
    const [tenantTerminals, setTenantTerminals] = useState<TenantTerminalSnapshot[]>([]);
    const [terminalSearchTerm, setTerminalSearchTerm] = useState('');
    const [terminalStoreFilter, setTerminalStoreFilter] = useState('ALL');
    const [terminalRequestFilter, setTerminalRequestFilter] = useState<TerminalRequestFilter>('ALL');
    const [terminalTabs, setTerminalTabs] = useState<Record<string, TerminalTabKey>>({});
    const [latestPosApkRelease, setLatestPosApkRelease] = useState<PosApkReleaseReference | null>(null);
    const [terminalAdvancedOpen, setTerminalAdvancedOpen] = useState<Record<string, boolean>>({});
    const [isTerminalModalOpen, setIsTerminalModalOpen] = useState(false);
    const [isTerminalModalLoading, setIsTerminalModalLoading] = useState(false);
    const [takeoverTerminal, setTakeoverTerminal] = useState<TenantTerminalSnapshot | null>(null);
    const [isTakeoverModalOpen, setIsTakeoverModalOpen] = useState(false);
    const [isTakeoverSubmitting, setIsTakeoverSubmitting] = useState(false);
    const [rebuildTerminal, setRebuildTerminal] = useState<TenantTerminalSnapshot | null>(null);
    const [isRebuildModalOpen, setIsRebuildModalOpen] = useState(false);
    const [isRebuildSubmitting, setIsRebuildSubmitting] = useState(false);
    const [erpReadinessSubmittingKey, setErpReadinessSubmittingKey] = useState<string | null>(null);
    const [authAttemptsByTerminal, setAuthAttemptsByTerminal] = useState<Record<string, TerminalAuthAttempt[]>>({});
    const [authAttemptsErrorByTerminal, setAuthAttemptsErrorByTerminal] = useState<Record<string, string>>({});
    const [deviceAuditByTerminal, setDeviceAuditByTerminal] = useState<Record<string, TerminalDeviceAuditEntry[]>>({});
    const [authAttemptsLoadingKey, setAuthAttemptsLoadingKey] = useState<string | null>(null);
    const [deviceActionSubmittingKey, setDeviceActionSubmittingKey] = useState<string | null>(null);
    const deviceActionInFlightRef = useRef(false);
    const [manualDeviceIds, setManualDeviceIds] = useState<Record<string, string>>({});
    const [reconciliationDrafts, setReconciliationDrafts] = useState<Record<string, ReconciliationDraft>>({});
    const [reconciliationSubmittingKey, setReconciliationSubmittingKey] = useState<string | null>(null);
    const [posLicenseSeats, setPosLicenseSeats] = useState<TenantPosLicenseSeats | null>(null);
    const [fiscalReadinessByTerminal, setFiscalReadinessByTerminal] = useState<Record<string, TerminalFiscalReadiness>>({});
    const [fiscalReadinessLoadingKey, setFiscalReadinessLoadingKey] = useState<string | null>(null);
    const [syncPendingByTerminal, setSyncPendingByTerminal] = useState<Record<string, TerminalSyncPendingResult>>({});
    const [syncPendingLoadingKey, setSyncPendingLoadingKey] = useState<string | null>(null);
    const [syncRetrySubmittingKey, setSyncRetrySubmittingKey] = useState<string | null>(null);
    const [deletingTenantId, setDeletingTenantId] = useState<string | null>(null);
    const [updatingStatusTenantId, setUpdatingStatusTenantId] = useState<string | null>(null);
    const [provisionedCredentials, setProvisionedCredentials] = useState<{
        email: string;
        tempPassword: string;
    } | null>(null);

    const [formData, setFormData] = useState({
        name: '',
        slug: '',
        email: '',
        taxId: '',
        contactName: '',
        contactEmail: '',
        city: '',
        capturedByDistributorId: '',
        servicedByDistributorId: '',
        products: getDefaultTenantProducts() as TenantProductSelection,
    });
    const [isSlugManuallyEdited, setIsSlugManuallyEdited] = useState(false);
    const [editFormData, setEditFormData] = useState({
        name: '',
        legalName: '',
        taxId: '',
        phone: '',
        email: '',
        password: '',
        products: getDefaultTenantProducts() as TenantProductSelection,
    });
    const [takeoverFormData, setTakeoverFormData] = useState({
        terminalId: '',
        registryId: '',
        newDeviceId: '',
        deviceName: '',
        reason: '',
        confirmTakeover: false,
    });
    const [rebuildFormData, setRebuildFormData] = useState({
        reason: '',
        confirmRebuild: false,
    });
    const canViewErpModules = hasCloudAdminPermission(permissions, 'licenses_view');
    const canManageErpModules = hasCloudAdminPermission(permissions, 'licenses_manage');
    const canReauthorizeTerminals = hasCloudAdminPermission(permissions, 'terminal_reauthorization');

    const getErrorMessage = (error: unknown) => {
        if (typeof error === 'string') return error;
        if (error instanceof Error) return error.message;
        if (
            typeof error === 'object'
            && error !== null
            && 'error' in error
            && (error as { error?: unknown }).error === 'DEVICE_ID_REQUIRED'
        ) {
            return 'DEVICE_ID_REQUIRED: selecciona o confirma el device_id autorizado actual antes de llamar ERP.';
        }
        if (
            typeof error === 'object'
            && error !== null
            && 'message' in error
            && typeof (error as { message?: unknown }).message === 'string'
        ) {
            return (error as { message: string }).message;
        }
        if (
            typeof error === 'object'
            && error !== null
            && 'error_description' in error
            && typeof (error as { error_description?: unknown }).error_description === 'string'
        ) {
            return (error as { error_description: string }).error_description;
        }
        return 'Error desconocido';
    };

    const [searchParams] = useSearchParams();

    useEffect(() => {
        void fetchTenants();
        void fetchDistributors();

        if (searchParams.get('create') === 'true') {
            setIsModalOpen(true);
            // Optional: clear the param so it doesn't re-open on refresh if desired, 
            // but usually it's fine. If we want to clear:
            // const newParams = new URLSearchParams(searchParams);
            // newParams.delete('create');
            // setSearchParams(newParams, { replace: true });
        }
    }, [searchParams]);

    const fetchTenants = async () => {
        setLoading(true);
        try {
            const data = await tenantService.getTenants();
            setTenants(data || []);
        } catch (err) {
            console.error('Error fetching tenants:', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchDistributors = async () => {
        setDistributorsLoading(true);
        try {
            const data = await tenantService.getDistributors();
            setDistributors(data || []);
        } catch (err) {
            console.error('Error fetching distributors:', err);
        } finally {
            setDistributorsLoading(false);
        }
    };

    const filteredTenants = tenants.filter((tenant) => {
        const normalizedSearch = searchTerm.toLowerCase();
        return tenant.name.toLowerCase().includes(normalizedSearch)
            || (tenant.tax_id && tenant.tax_id.toLowerCase().includes(normalizedSearch))
            || (tenant.contact_name && tenant.contact_name.toLowerCase().includes(normalizedSearch))
            || (tenant.city && tenant.city.toLowerCase().includes(normalizedSearch));
    });

    const activateTrialTenant = async (tenant: Tenant) => {
        if (!confirm(`¿Deseas activar la empresa "${tenant.name}"?`)) return;

        setUpdatingStatusTenantId(tenant.id);
        try {
            await tenantService.reactivateTenant(tenant.id);
            await fetchTenants();
        } catch (err) {
            console.error('Error activating tenant:', err);
            alert('Hubo un error al activar la empresa');
        } finally {
            setUpdatingStatusTenantId(null);
        }
    };

    const toggleTenantStatus = async (tenant: Tenant) => {
        const isCurrentlyActive = tenant.status === 'ACTIVE';
        const newStatusLabel = isCurrentlyActive ? 'SUSPENDER' : 'REACTIVAR';

        if (!confirm(`¿Estás seguro que deseas ${newStatusLabel} esta empresa?`)) return;

        setUpdatingStatusTenantId(tenant.id);
        try {
            if (isCurrentlyActive) {
                await tenantService.suspendTenant(tenant.id);
            } else {
                await tenantService.reactivateTenant(tenant.id);
            }
            await fetchTenants();
        } catch (err) {
            console.error('Error toggling status:', err);
            alert('Hubo un error al actualizar el estatus');
        } finally {
            setUpdatingStatusTenantId(null);
        }
    };

    const handleDeleteTenant = async (tenant: Tenant) => {
        const confirmed = confirm(
            `Vas a eliminar definitivamente el tenant "${tenant.name}". Esta accion borra su registro, suscripcion, esquema de base de datos y usuario de acceso si existe. ¿Deseas continuar?`,
        );
        if (!confirmed) return;

        const typedName = prompt(`Para confirmar, escribe exactamente el nombre del tenant: ${tenant.name}`);
        if (typedName !== tenant.name) {
            alert('El nombre no coincide. No se elimino el tenant.');
            return;
        }

        setDeletingTenantId(tenant.id);
        try {
            await tenantService.deleteTenant(tenant);
            await fetchTenants();
            alert(`Tenant "${tenant.name}" eliminado correctamente.`);
        } catch (err: unknown) {
            console.error('Error deleting tenant:', err);
            await fetchTenants();
            alert('Error al eliminar el Tenant: ' + getErrorMessage(err));
        } finally {
            setDeletingTenantId(null);
        }
    };

    const closeCreateModal = () => {
        setIsModalOpen(false);
        setIsCreateProductsModalOpen(false);
    };

    const closeEditModal = () => {
        setIsEditModalOpen(false);
        setIsEditProductsModalOpen(false);
        setEditingTenant(null);
    };

    const openCreateProductsModal = () => {
        setCreateProductsModalVersion((current) => current + 1);
        setIsCreateProductsModalOpen(true);
    };

    const openEditProductsModal = () => {
        setEditProductsModalVersion((current) => current + 1);
        setIsEditProductsModalOpen(true);
    };

    const handleCreateTenant = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            const slug = buildTenantSlug(formData.slug || formData.name);
            if (!slug) {
                throw new Error('El identificador tecnico del tenant es requerido.');
            }
            const products = normalizeTenantProductSelection(formData.products);
            const productConfig = deriveTenantConfigFromProducts(products);
            const semanticConfig = deriveTenantSemanticsFromProducts(products);

            const { tenantId, tempPassword } = await tenantService.createTenant({
                name: formData.name,
                slug,
                email: formData.email,
                contactName: formData.contactName,
                contactEmail: formData.contactEmail,
                city: formData.city,
                capturedByDistributorId: formData.capturedByDistributorId || undefined,
                servicedByDistributorId: formData.servicedByDistributorId || undefined,
                plan: 'TRIAL',
                type: productConfig.type,
                cloudSync: productConfig.cloudSync,
                contractedProduct: semanticConfig.contractedProduct,
                posVariant: semanticConfig.posVariant,
                offlineMode: semanticConfig.offlineMode,
                explicitOffline: semanticConfig.explicitOffline,
                cloudDisabledReason: semanticConfig.cloudDisabledReason,
                posRuntime: semanticConfig.posRuntime,
                cloudChannel: semanticConfig.cloudChannel,
                dataMaster: semanticConfig.dataMaster,
                cloudSyncEnabled: semanticConfig.cloudSyncEnabled,
                erpCoreEnabled: semanticConfig.erpCoreEnabled,
                erpUiEnabled: semanticConfig.erpUiEnabled,
                customerErpAccess: semanticConfig.customerErpAccess,
                backupEnabled: semanticConfig.backupEnabled,
                lifecycleStatus: semanticConfig.lifecycleStatus,
                provisioningStatus: semanticConfig.provisioningStatus,
                maxPosTerminals: products.pos_licenses,
                maxErpUsers: products.erp_users,
            });

            if (formData.taxId.trim()) {
                await tenantService.updateTenantTaxId(tenantId, formData.taxId);
            }

            setProvisionedCredentials({
                email: formData.email.trim().toLowerCase(),
                tempPassword,
            });

            setFormData({
                name: '',
                slug: '',
                email: '',
                taxId: '',
                contactName: '',
                contactEmail: '',
                city: '',
                capturedByDistributorId: '',
                servicedByDistributorId: '',
                products: getDefaultTenantProducts(),
            });
            setIsSlugManuallyEdited(false);
            closeCreateModal();
            await fetchTenants();
        } catch (err: unknown) {
            console.error('Error provisioning tenant:', err);
            alert('Error al aprovisionar el Tenant: ' + getErrorMessage(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    const normalizeOptional = (value: string) => {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    };

    const openEditModal = (tenant: Tenant) => {
        setEditingTenant(tenant);
        setEditFormData({
            name: tenant.name || '',
            legalName: tenant.legal_name || '',
            taxId: tenant.tax_id || '',
            phone: tenant.phone || '',
            email: tenant.email || '',
            password: '',
            products: deriveProductsFromTenant(tenant.type, tenant.cloud_sync, tenant.max_pos_terminals, tenant.max_erp_users, {
                posVariant: tenant.pos_variant,
                offlineMode: tenant.offline_mode,
                explicitOffline: tenant.explicit_offline,
                cloudChannel: tenant.cloud_channel,
            }),
        });
        setIsEditModalOpen(true);
    };

    const openTerminalModal = async (tenant: Tenant) => {
        setSelectedTenantForTerminals(tenant);
        setTenantTerminals([]);
        setTerminalSearchTerm('');
        setTerminalStoreFilter('ALL');
        setTerminalRequestFilter('ALL');
        setAuthAttemptsByTerminal({});
        setAuthAttemptsErrorByTerminal({});
        setDeviceAuditByTerminal({});
        setFiscalReadinessByTerminal({});
        setPosLicenseSeats(null);
        setSyncPendingByTerminal({});
        setTerminalAdvancedOpen({});
        setIsTerminalModalOpen(true);
        setIsTerminalModalLoading(true);

        try {
            try {
                await tenantService.enforceTenantPosLicenseLimits(tenant.id);
            } catch (enforceErr) {
                console.warn('POS license enforcement skipped or failed:', enforceErr);
            }

            const [data, availableRelease, seats] = await Promise.all([
                tenantService.getTenantTerminalOverview(tenant.id),
                getLatestAvailablePosApkRelease().catch((releaseErr) => {
                    console.warn('Latest POS APK release unavailable; terminal catalog will continue loading:', releaseErr);
                    return null;
                }),
                tenantService.getTenantPosLicenseSeats(tenant.id).catch(() => null),
            ]);
            setTenantTerminals(data);
            setPosLicenseSeats(seats);
            setLatestPosApkRelease(availableRelease);
            if (canReauthorizeTerminals) {
                await Promise.all(data
                    .filter((terminal) => hasCanonicalErpBinding(terminal))
                    .map((terminal) => loadTerminalAuthAttempts(tenant.id, terminal)));
            }
        } catch (err) {
            console.error('Error fetching tenant terminals:', err);
            alert('No se pudieron cargar las terminales de este tenant.');
        } finally {
            setIsTerminalModalLoading(false);
        }
    };

    const closeTerminalModal = () => {
        setIsTerminalModalOpen(false);
        setSelectedTenantForTerminals(null);
        setTenantTerminals([]);
        setTerminalSearchTerm('');
        setTerminalStoreFilter('ALL');
        setTerminalRequestFilter('ALL');
        setAuthAttemptsByTerminal({});
        setAuthAttemptsErrorByTerminal({});
        setDeviceAuditByTerminal({});
        setFiscalReadinessByTerminal({});
        setLatestPosApkRelease(null);
        setPosLicenseSeats(null);
        setSyncPendingByTerminal({});
        setTerminalAdvancedOpen({});
        closeTakeoverModal();
        closeRebuildModal();
    };

    const getTenantSemantics = (tenant: Tenant): TenantSemanticConfig => {
        const fallback = deriveTenantSemanticsFromTenant(tenant.type, tenant.cloud_sync, tenant.max_pos_terminals, tenant.max_erp_users, {
            posVariant: tenant.pos_variant,
            offlineMode: tenant.offline_mode,
            explicitOffline: tenant.explicit_offline,
            cloudChannel: tenant.cloud_channel,
        });
        return {
            contractedProduct: tenant.contracted_product || fallback.contractedProduct,
            posVariant: tenant.pos_variant || fallback.posVariant,
            offlineMode: tenant.offline_mode ?? fallback.offlineMode,
            explicitOffline: tenant.explicit_offline ?? fallback.explicitOffline,
            cloudDisabledReason: tenant.cloud_disabled_reason ?? fallback.cloudDisabledReason,
            posRuntime: tenant.pos_runtime || fallback.posRuntime,
            cloudChannel: tenant.cloud_channel || fallback.cloudChannel,
            dataMaster: tenant.data_master || fallback.dataMaster,
            cloudSyncEnabled: tenant.cloud_sync_enabled ?? fallback.cloudSyncEnabled,
            erpCoreEnabled: tenant.erp_core_enabled ?? fallback.erpCoreEnabled,
            erpUiEnabled: tenant.erp_ui_enabled ?? fallback.erpUiEnabled,
            customerErpAccess: tenant.customer_erp_access ?? fallback.customerErpAccess,
            backupEnabled: tenant.backup_enabled ?? fallback.backupEnabled,
            lifecycleStatus: tenant.lifecycle_status || fallback.lifecycleStatus,
            provisioningStatus: tenant.provisioning_status || fallback.provisioningStatus,
        };
    };

    const isLocalPosTenant = (tenant?: Tenant | null) => {
        if (!tenant) return false;
        const semantics = getTenantSemantics(tenant);
        return semantics.contractedProduct === 'POS_ONLY' && semantics.posRuntime !== 'SLAVE';
    };

    const isExplicitOfflinePosTenant = (tenant?: Tenant | null) => {
        if (!tenant) return false;
        const semantics = getTenantSemantics(tenant);
        return semantics.contractedProduct === 'POS_ONLY'
            && (semantics.posVariant === 'POS_ONLY_OFFLINE' || semantics.offlineMode || semantics.cloudChannel === 'NONE');
    };

    const isCloudRecoverableLocalPosTenant = (tenant?: Tenant | null) => (
        isLocalPosTenant(tenant) && !isExplicitOfflinePosTenant(tenant)
    );

    const isFiscalEligibleTenant = (tenant?: Tenant | null) => {
        if (!tenant) return false;
        const semantics = getTenantSemantics(tenant);
        return semantics.contractedProduct === 'POS_ERP' || semantics.cloudChannel === 'ERP_ACTIVE';
    };

    const terminalRequiresCanonicalErp = () => isFiscalEligibleTenant(selectedTenantForTerminals);
    const isCanonicalTerminalActionBlocked = (terminal: TenantTerminalSnapshot) => (
        terminalRequiresCanonicalErp() && !hasCanonicalErpBinding(terminal)
    );
    const getTerminalTakeoverId = (terminal: TenantTerminalSnapshot) => {
        if (terminalRequiresCanonicalErp()) return hasCanonicalErpBinding(terminal) ? terminal.erp_terminal_uuid!.trim() : '';
        return terminal.registry?.terminal_id?.trim()
            || terminal.terminal_id?.trim()
            || terminal.catalog_terminal_id?.trim()
            || terminal.id
            || '';
    };

    const getTakeoverSelectionKey = (terminalId: string, registryId?: string | null) => (
        registryId ? `registry:${registryId}` : `terminal:${terminalId}`
    );

    const getTakeoverOptions = () => tenantTerminals.flatMap((terminal) => {
        const registries = terminal.registries?.length
            ? terminal.registries
            : terminal.registry
                ? [terminal.registry]
                : [];

        if (registries.length === 0) {
            const terminalId = getTerminalTakeoverId(terminal);
            return [{
                key: getTakeoverSelectionKey(terminalId),
                terminal,
                terminalId,
                registryId: '',
                label: `${terminal.name} · ${terminalId || 'Sin ID'} · ${terminal.device_token || 'N/D'}`,
            }];
        }

        return registries.map((registry) => {
            const terminalId = getTerminalTakeoverId(terminal) || registry.terminal_id || '';
            const deviceId = registry.current_device_id || registry.device_id || terminal.device_token || 'N/D';
            return {
                key: getTakeoverSelectionKey(terminalId, registry.id),
                terminal: { ...terminal, registry },
                terminalId,
                registryId: registry.id || '',
                label: `${terminal.name} · Terminal ${terminalId || 'Sin ID'} · ${deviceId}`,
            };
        });
    });

    const getTerminalKey = (terminal: TenantTerminalSnapshot) => `${terminal.id}-${terminal.registry?.id || 'catalog'}`;

    const getAttemptTime = (attempt: TerminalAuthAttempt) => attempt.attempted_at || attempt.created_at || null;
    const getDeviceRequestStatusLabel = (attempt: TerminalAuthAttempt) => {
        const status = (attempt.resolution_status || attempt.status || 'PENDING').toUpperCase();
        if (status === 'PENDING') return 'PENDIENTE';
        if (status === 'APPROVED' || status === 'RESOLVED') return 'APROBADA';
        if (status === 'REJECTED') return 'RECHAZADA';
        if (status === 'EXPIRED' || status === 'IGNORED') return 'EXPIRADA';
        return status;
    };
    const getAuthStatusLabel = (status: string) => {
        switch (status) {
            case 'AUTHORIZED': return 'Autorizado';
            case 'DEVICE_MISMATCH': return 'Device rechazado';
            case 'TAKEOVER_PENDING': return 'Takeover pendiente';
            case 'TAKEOVER_COMPLETED': return 'Takeover completado';
            case 'REAUTH_COMPLETED': return 'Reauth completado';
            case 'OLD_DEVICE_REVOKED': return 'Equipo revocado';
            case 'TOKEN_ROTATION_REQUIRED': return 'Rotacion requerida';
            case 'ERP_AUTH_ERROR': return 'Error auth ERP';
            case 'ERP_REPAIR_PENDING': return 'Reparacion ERP pendiente';
            case 'ERP_REPAIR_FAILED': return 'Reparacion ERP fallida';
            case 'WAITING_ERP_CONFIRMATION': return 'Esperando confirmacion ERP';
            case 'BOUND_AUTH_MISMATCH': return 'Bound auth mismatch';
            case 'LICENSE_EXCEEDED': return 'Sin licencia POS';
            default: return status || 'N/D';
        }
    };

    const getAuthStatusClasses = (status: string) => {
        if (['AUTHORIZED', 'TAKEOVER_COMPLETED', 'REAUTH_COMPLETED'].includes(status)) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
        if (['DEVICE_MISMATCH', 'ERP_AUTH_ERROR', 'LICENSE_EXCEEDED', 'ERP_REPAIR_FAILED', 'BOUND_AUTH_MISMATCH'].includes(status)) {
            return 'border-red-200 bg-red-50 text-red-700';
        }
        if (['TAKEOVER_PENDING', 'TOKEN_ROTATION_REQUIRED', 'ERP_REPAIR_PENDING', 'WAITING_ERP_CONFIRMATION'].includes(status)) return 'border-amber-200 bg-amber-50 text-amber-700';
        if (status === 'OLD_DEVICE_REVOKED') return 'border-slate-200 bg-slate-100 text-slate-700';
        return 'border-slate-200 bg-slate-50 text-slate-600';
    };

    const isDeviceIdentityAligned = (
        authorizedDeviceId: string,
        reportedDeviceId: string,
        erpDeviceId?: string,
        requireErpConfirmation = false,
    ) => {
        if (!authorizedDeviceId) return false;
        const posMatches = Boolean(reportedDeviceId && authorizedDeviceId === reportedDeviceId);
        const erpMatches = Boolean(erpDeviceId && erpDeviceId !== 'N/D' && authorizedDeviceId === erpDeviceId);
        return requireErpConfirmation ? posMatches && erpMatches : posMatches || erpMatches;
    };

    const getEffectiveAuthStatus = (
        status: string,
        authorizedDeviceId: string,
        reportedDeviceId: string,
        erpDeviceId?: string,
        requireErpConfirmation = false,
    ) => {
        const normalized = status.toUpperCase();
        if (authorizedDeviceId && requireErpConfirmation) {
            if (normalized === 'TAKEOVER_COMPLETED') return 'WAITING_ERP_CONFIRMATION';
            if (!erpDeviceId || erpDeviceId === 'N/D') {
                return ['AUTHORIZED', 'REAUTH_COMPLETED'].includes(normalized)
                    ? 'WAITING_ERP_CONFIRMATION'
                    : normalized || 'ERP_REPAIR_PENDING';
            }
            if (authorizedDeviceId !== erpDeviceId) return 'BOUND_AUTH_MISMATCH';
            if (reportedDeviceId && reportedDeviceId !== authorizedDeviceId) return 'DEVICE_MISMATCH';
            if (normalized === 'REAUTH_COMPLETED') return 'REAUTH_COMPLETED';
        }
        if (
            isDeviceIdentityAligned(authorizedDeviceId, reportedDeviceId, erpDeviceId, requireErpConfirmation)
            && ['DEVICE_MISMATCH', 'TAKEOVER_PENDING', 'ERP_AUTH_ERROR'].includes(normalized)
        ) {
            return requireErpConfirmation ? 'REAUTH_COMPLETED' : 'AUTHORIZED';
        }
        return normalized || 'AUTHORIZED';
    };

    const getFiscalReadiness = (terminal: TenantTerminalSnapshot) => (
        fiscalReadinessByTerminal[getTerminalKey(terminal)]
        || terminal.registry?.fiscal_readiness
        || null
    );

    const getFiscalStatusClasses = (status: string) => {
        if (status === 'READY') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
        if (status === 'DEMO_READY') return 'border-blue-200 bg-blue-50 text-blue-700';
        if (status === 'ERROR') return 'border-red-200 bg-red-50 text-red-700';
        return 'border-amber-200 bg-amber-50 text-amber-800';
    };

    const getReadinessValue = (readiness: TenantTerminalErpReadiness | null | undefined, keys: string[]) => {
        if (!readiness) return null;
        for (const key of keys) {
            const value = readiness[key];
            if (typeof value === 'string' && value.trim()) return value.trim();
            if (typeof value === 'number') return String(value);
        }
        return null;
    };

    const getReadinessCheckValue = (readiness: TenantTerminalErpReadiness | null | undefined, keys: string[]) => {
        const checks = readiness?.checks;
        if (!checks || typeof checks !== 'object') return null;

        for (const key of keys) {
            const value = checks[key];
            if (typeof value === 'boolean') return value;
            if (typeof value === 'number') return value > 0;
            if (typeof value === 'string') {
                const normalized = value.trim().toLowerCase();
                if (['true', 'ready', 'active', 'available', 'ok', 'yes'].includes(normalized)) return true;
                if (['false', 'missing', 'draft', 'empty', 'no'].includes(normalized)) return false;
            }
            if (value && typeof value === 'object') {
                const record = value as Record<string, unknown>;
                const ready = record.ready ?? record.exists ?? record.available ?? record.enabled;
                if (typeof ready === 'boolean') return ready;
                const count = record.count ?? record.total;
                if (typeof count === 'number') return count > 0;
            }
        }

        return null;
    };

    const getReadinessProfileStatus = (readiness: TenantTerminalErpReadiness | null | undefined) => (
        getReadinessValue(readiness, ['profileStatus', 'profile_status']) || ''
    ).toUpperCase();

    const isErpProfileIncomplete = (readiness: TenantTerminalErpReadiness | null | undefined) => {
        const profileStatus = getReadinessProfileStatus(readiness);
        const profileCheck = getReadinessCheckValue(readiness, ['profile']);
        return profileStatus === 'DRAFT' || profileCheck === false;
    };

    const getSyncDocumentValue = (document: TerminalSyncDocument, keys: string[]) => {
        for (const key of keys) {
            const value = document[key];
            if (typeof value === 'string' && value.trim()) return value.trim();
            if (typeof value === 'number') return String(value);
        }
        return '';
    };

    const getSyncDocumentId = (document: TerminalSyncDocument) => (
        getSyncDocumentValue(document, ['id', 'document_id', 'documentId', 'uuid'])
    );

    const getSyncDocumentFolio = (document: TerminalSyncDocument) => (
        getSyncDocumentValue(document, ['folio', 'document_no', 'documentNo', 'sequence', 'ncf']) || 'Documento sin folio'
    );

    const getSyncDocumentErrorCode = (document: TerminalSyncDocument) => (
        getSyncDocumentValue(document, ['error_code', 'errorCode', 'code']).toUpperCase()
    );

    const getSyncDocumentCreatedAt = (document: TerminalSyncDocument) => (
        getSyncDocumentValue(document, ['created_at', 'createdAt', 'date', 'timestamp'])
    );

    const isRepairableSyncDocument = (document: TerminalSyncDocument, fallbackReadiness?: TenantTerminalErpReadiness | null) => {
        const documentReadiness = document.readiness
            || (document.erp_readiness && typeof document.erp_readiness === 'object' ? document.erp_readiness as TenantTerminalErpReadiness : null);
        const readiness = documentReadiness || fallbackReadiness || null;
        return getSyncDocumentErrorCode(document) === 'ERP_CONTEXT_MISSING'
            && (isErpProfileIncomplete(readiness) || document.retryable === true);
    };

    const getErpReadinessStatus = (terminal: TenantTerminalSnapshot) => (
        terminal.registry?.erp_readiness?.status?.toString().toLowerCase() || 'missing'
    );

    const getReadinessBadgeClasses = (status: string) => {
        if (status === 'ready') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
        if (status === 'pending') return 'border-blue-200 bg-blue-50 text-blue-700';
        if (status === 'missing_catalog') return 'border-amber-200 bg-amber-50 text-amber-700';
        if (status === 'error') return 'border-red-200 bg-red-50 text-red-700';
        return 'border-slate-200 bg-slate-50 text-slate-600';
    };

    const getReadinessLabel = (status: string) => {
        if (status === 'ready') return 'ERP listo';
        if (status === 'pending') return 'ERP pendiente';
        if (status === 'missing_catalog') return 'Catalogo faltante';
        if (status === 'error') return 'ERP con error';
        return 'ERP sin validar';
    };

    const getOperationalStatusLabel = (status: string) => {
        if (status === 'OPERATIVE') return 'Operativa';
        if (status === 'ATTENTION') return 'Requiere atención';
        if (status === 'AUTH_REQUIRED') return 'Requiere autorización';
        if (status === 'OFFLINE') return 'Offline';
        return 'Pendiente de autorizacion';
    };

    const getOperationalStatusClasses = (status: string) => {
        if (status === 'OPERATIVE') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
        if (status === 'ATTENTION') return 'border-amber-200 bg-amber-50 text-amber-700';
        if (status === 'AUTH_REQUIRED') return 'border-red-200 bg-red-50 text-red-700';
        if (status === 'OFFLINE') return 'border-slate-200 bg-slate-100 text-slate-600';
        return 'border-blue-200 bg-blue-50 text-blue-700';
    };

    const getCheckLabel = (value: boolean | null, readyLabel: string, missingLabel: string) => {
        if (value === true) return readyLabel;
        if (value === false) return missingLabel;
        return 'N/D';
    };

    const openTakeoverModal = (terminal: TenantTerminalSnapshot) => {
        if (isCanonicalTerminalActionBlocked(terminal)) {
            alert(CANONICAL_ERP_IDENTITY_REQUIRED_MESSAGE);
            return;
        }
        setTakeoverTerminal(terminal);
        setTakeoverFormData({
            terminalId: getTerminalTakeoverId(terminal),
            registryId: terminal.registry?.id || '',
            newDeviceId: '',
            deviceName: terminal.name || '',
            reason: '',
            confirmTakeover: false,
        });
        setIsTakeoverModalOpen(true);
    };

    const closeTakeoverModal = () => {
        setIsTakeoverModalOpen(false);
        setTakeoverTerminal(null);
        setTakeoverFormData({
            terminalId: '',
            registryId: '',
            newDeviceId: '',
            deviceName: '',
            reason: '',
            confirmTakeover: false,
        });
    };

    const openRebuildModal = (terminal: TenantTerminalSnapshot) => {
        if (isCanonicalTerminalActionBlocked(terminal)) {
            alert(CANONICAL_ERP_IDENTITY_REQUIRED_MESSAGE);
            return;
        }
        setRebuildTerminal(terminal);
        setRebuildFormData({
            reason: '',
            confirmRebuild: false,
        });
        setIsRebuildModalOpen(true);
    };

    const closeRebuildModal = () => {
        setIsRebuildModalOpen(false);
        setRebuildTerminal(null);
        setRebuildFormData({
            reason: '',
            confirmRebuild: false,
        });
    };

    const getTerminalOperationalDeviceId = (terminal: TenantTerminalSnapshot) => (
        getTerminalPosReportedDeviceId(terminal)
        || getTerminalAuthorizedDeviceId(terminal)
        || terminal.device_token
        || ''
    );

    const requestErpReadinessForTerminal = async (
        terminal: TenantTerminalSnapshot,
        options?: { deviceId?: string; terminalName?: string; silent?: boolean },
    ) => {
        if (!selectedTenantForTerminals) return null;

        const terminalId = getTerminalTakeoverId(terminal);
        const deviceId = options?.deviceId || getTerminalOperationalDeviceId(terminal);

        if (!terminalId || !deviceId) {
            if (!options?.silent) {
                alert('Esta terminal necesita terminal_id y device_id antes de preparar el contexto ERP.');
            }
            return null;
        }

        const result = await tenantService.requestTerminalErpReadiness({
            tenantId: selectedTenantForTerminals.id,
            terminalId,
            registryId: terminal.registry?.id || null,
            deviceId,
            terminalName: options?.terminalName || terminal.name,
        });

        const data = await tenantService.getTenantTerminalOverview(selectedTenantForTerminals.id);
        setTenantTerminals(data);
        return result;
    };

    const handleRetryErpReadiness = async (terminal: TenantTerminalSnapshot) => {
        const key = getTerminalKey(terminal);
        setErpReadinessSubmittingKey(key);

        try {
            const result = await requestErpReadinessForTerminal(terminal);
            alert(result?.message || (result?.status === 'ready'
                ? 'Contexto ERP listo para operar.'
                : 'POS vinculado, pero el contexto ERP aun no esta listo.'));
        } catch (err: unknown) {
            console.error('Error requesting POS ERP readiness:', err);
            alert(getErrorMessage(err));
        } finally {
            setErpReadinessSubmittingKey(null);
        }
    };

    const handlePrepareErpProfile = async (terminal: TenantTerminalSnapshot) => {
        if (!selectedTenantForTerminals) return null;
        const terminalId = getTerminalTakeoverId(terminal);
        if (!terminalId) {
            alert('Esta terminal necesita terminal_id para preparar el perfil ERP.');
            return null;
        }

        const key = getTerminalKey(terminal);
        setErpReadinessSubmittingKey(key);
        try {
            const result = await tenantService.requestTerminalErpProfilePrepare({
                tenantId: selectedTenantForTerminals.id,
                terminalId,
                registryId: terminal.registry?.id || null,
                deviceId: getTerminalOperationalDeviceId(terminal) || null,
                terminalName: terminal.name,
            });
            await refreshTerminalModalData();
            void loadTerminalSyncPending(selectedTenantForTerminals.id, terminal);
            alert(result.message || (result.status === 'ready' ? 'Perfil ERP preparado correctamente.' : 'Perfil ERP solicitado, pero aun no esta listo.'));
            return result;
        } catch (err: unknown) {
            console.error('Error preparing ERP profile:', err);
            alert(getErrorMessage(err));
            return null;
        } finally {
            setErpReadinessSubmittingKey(null);
        }
    };

    const handlePrepareAndRetryDocument = async (terminal: TenantTerminalSnapshot, document: TerminalSyncDocument) => {
        if (!selectedTenantForTerminals) return;
        const terminalId = getTerminalTakeoverId(terminal);
        const documentId = getSyncDocumentId(document);
        if (!terminalId || !documentId) {
            alert('No se pudo identificar la terminal o el documento pendiente.');
            return;
        }

        const key = `${getTerminalKey(terminal)}-${documentId}`;
        setSyncRetrySubmittingKey(key);
        try {
            const readiness = terminal.registry?.erp_readiness || document.readiness || null;
            if (isErpProfileIncomplete(readiness)) {
                const prepareResult = await tenantService.requestTerminalErpProfilePrepare({
                    tenantId: selectedTenantForTerminals.id,
                    terminalId,
                    registryId: terminal.registry?.id || null,
                    deviceId: getTerminalOperationalDeviceId(terminal) || null,
                    terminalName: terminal.name,
                });
                const preparedReadiness = prepareResult.erp_readiness || prepareResult as TenantTerminalErpReadiness;
                if (isErpProfileIncomplete(preparedReadiness) || prepareResult.status === 'error') {
                    alert(prepareResult.message || 'El perfil ERP sigue incompleto. No se reintentara el documento.');
                    await refreshTerminalModalData();
                    return;
                }
            }

            const result = await tenantService.retryTerminalSyncPending({
                tenantId: selectedTenantForTerminals.id,
                terminalId,
                documentId,
            });
            await refreshTerminalModalData();
            await loadTerminalSyncPending(selectedTenantForTerminals.id, terminal);
            alert(result.message || 'Documento reenviado correctamente.');
        } catch (err: unknown) {
            console.error('Error preparing and retrying document:', err);
            alert(getErrorMessage(err));
        } finally {
            setSyncRetrySubmittingKey(null);
        }
    };

    const handleRetryTerminalPending = async (terminal: TenantTerminalSnapshot) => {
        if (!selectedTenantForTerminals) return;
        const terminalId = getTerminalTakeoverId(terminal);
        if (!terminalId) {
            alert('Esta terminal necesita terminal_id para reintentar pendientes.');
            return;
        }

        if (isErpProfileIncomplete(terminal.registry?.erp_readiness || null)) {
            alert('No se permite reintento masivo mientras el perfil ERP siga incompleto.');
            return;
        }

        const key = getTerminalKey(terminal);
        const pending = syncPendingByTerminal[key];
        const documentIds = (pending?.documents || [])
            .filter((document) => isRepairableSyncDocument(document, terminal.registry?.erp_readiness || null))
            .map(getSyncDocumentId)
            .filter(Boolean);

        if (!documentIds.length) {
            alert('No hay documentos reparables para esta terminal.');
            return;
        }

        setSyncRetrySubmittingKey(`${key}-bulk`);
        try {
            const result = await tenantService.retryTerminalSyncPending({
                tenantId: selectedTenantForTerminals.id,
                terminalId,
                documentIds,
            });
            await refreshTerminalModalData();
            await loadTerminalSyncPending(selectedTenantForTerminals.id, terminal);
            alert(result.message || 'Pendientes reenviados correctamente.');
        } catch (err: unknown) {
            console.error('Error retrying terminal pending documents:', err);
            alert(getErrorMessage(err));
        } finally {
            setSyncRetrySubmittingKey(null);
        }
    };

    const loadTerminalAuthAttempts = async (tenantId: string, terminal: TenantTerminalSnapshot) => {
        const key = getTerminalKey(terminal);
        const terminalId = getTerminalTakeoverId(terminal);
        if (!terminalId) return;

        setAuthAttemptsLoadingKey(key);
        setAuthAttemptsErrorByTerminal((current) => ({ ...current, [key]: '' }));
        try {
            const [attempts, audit] = await Promise.all([
                tenantService.getTerminalAuthAttempts(tenantId, terminalId),
                tenantService.getTerminalDeviceAudit(tenantId, terminalId).catch((auditError) => {
                    console.warn('Error fetching terminal device audit:', auditError);
                    return [];
                }),
            ]);
            setAuthAttemptsByTerminal((current) => ({
                ...current,
                [key]: attempts,
            }));
            setAuthAttemptsErrorByTerminal((current) => ({ ...current, [key]: '' }));
            setDeviceAuditByTerminal((current) => ({
                ...current,
                [key]: audit,
            }));
        } catch (err) {
            console.warn('Error fetching terminal auth attempts:', err);
            setAuthAttemptsErrorByTerminal((current) => ({
                ...current,
                [key]: getErrorMessage(err),
            }));
            setAuthAttemptsByTerminal((current) => ({
                ...current,
                [key]: [],
            }));
            setDeviceAuditByTerminal((current) => ({ ...current, [key]: [] }));
        } finally {
            setAuthAttemptsLoadingKey((current) => current === key ? null : current);
        }
    };

    const handleEnforcePosLicenseLimits = async () => {
        if (!selectedTenantForTerminals) return;
        try {
            await tenantService.enforceTenantPosLicenseLimits(selectedTenantForTerminals.id);
            await refreshTerminalModalData();
            alert('Limite de licencias POS aplicado. Los equipos excedentes quedaron marcados como sin licencia.');
        } catch (err: unknown) {
            console.error('Error enforcing POS license limits:', err);
            alert(getErrorMessage(err));
        }
    };

    const refreshTerminalModalData = async () => {
        if (!selectedTenantForTerminals) return;
        try {
            await tenantService.enforceTenantPosLicenseLimits(selectedTenantForTerminals.id);
        } catch (enforceErr) {
            console.warn('POS license enforcement skipped or failed:', enforceErr);
        }
        const [data, seats] = await Promise.all([
            tenantService.getTenantTerminalOverview(selectedTenantForTerminals.id),
            tenantService.getTenantPosLicenseSeats(selectedTenantForTerminals.id).catch(() => null),
        ]);
        setTenantTerminals(data);
        setPosLicenseSeats(seats);
    };

    const updateReconciliationDraft = (
        terminalKey: string,
        draft: ReconciliationDraft,
        changes: Partial<ReconciliationDraft>,
    ) => {
        setReconciliationDrafts((current) => ({
            ...current,
            [terminalKey]: {
                ...draft,
                ...changes,
                serverPreview: 'serverPreview' in changes ? changes.serverPreview ?? null : null,
            },
        }));
    };

    const handleTerminalReconciliation = async (
        terminal: TenantTerminalSnapshot,
        draft: ReconciliationDraft,
        mode: 'DRY_RUN' | 'EXECUTE' | 'ROLLBACK',
    ) => {
        if (!selectedTenantForTerminals || !terminal.registry?.id) return;
        const key = getTerminalKey(terminal);
        const correlationId = draft.correlationId || crypto.randomUUID();
        setReconciliationSubmittingKey(key);
        try {
            const result = await tenantService.requestTerminalReconciliation({
                mode,
                tenantId: selectedTenantForTerminals.id,
                sourceRegistryId: terminal.registry.id,
                targetErpTerminalId: draft.erpTerminalUuid,
                targetStoreId: draft.storeId,
                authorizedDeviceId: draft.authorizedDeviceId,
                reason: draft.reason,
                correlationId,
                expectedPlanHash: mode === 'EXECUTE' ? draft.serverPreview?.plan_hash : null,
                adminConfirmed: draft.adminConfirmed,
            });
            setReconciliationDrafts((current) => ({
                ...current,
                [key]: { ...draft, correlationId, serverPreview: result },
            }));
            if (mode === 'EXECUTE') {
                alert(result.idempotent_replay
                    ? 'La reconciliación ya había sido aplicada; no se repitieron escrituras.'
                    : 'Reconciliación completada. El POS puede pulsar “Reintentar autorización”.');
                await refreshTerminalModalData();
            } else if (mode === 'ROLLBACK') {
                alert('Rollback completado; se restauraron únicamente el vínculo y los estados de devices.');
                await refreshTerminalModalData();
            }
        } catch (error) {
            console.error('Error reconciling terminal identity:', error);
            alert(getErrorMessage(error));
        } finally {
            setReconciliationSubmittingKey(null);
        }
    };

    const loadTerminalSyncPending = async (tenantId: string, terminal: TenantTerminalSnapshot) => {
        const key = getTerminalKey(terminal);
        const terminalId = getTerminalTakeoverId(terminal);
        if (!terminalId) return;

        setSyncPendingLoadingKey(key);
        try {
            const result = await tenantService.getTerminalSyncPending({ tenantId, terminalId });
            setSyncPendingByTerminal((current) => ({
                ...current,
                [key]: result,
            }));
        } catch (err) {
            console.warn('Error fetching terminal sync pending:', err);
            setSyncPendingByTerminal((current) => ({
                ...current,
                [key]: {
                    status: 'error',
                    documents: [],
                    summary: { pending: 0, repairable: 0, functionalErrors: 0 },
                    message: getErrorMessage(err),
                },
            }));
        } finally {
            setSyncPendingLoadingKey((current) => current === key ? null : current);
        }
    };

    const loadTerminalFiscalReadiness = async (tenantId: string, terminal: TenantTerminalSnapshot) => {
        const key = getTerminalKey(terminal);
        const terminalId = getTerminalTakeoverId(terminal);
        if (!terminalId) return;

        setFiscalReadinessLoadingKey(key);
        try {
            const readiness = await tenantService.getTerminalFiscalDebug({
                tenantId,
                terminalId,
                registryId: terminal.registry?.id || null,
            });
            setFiscalReadinessByTerminal((current) => ({
                ...current,
                [key]: readiness,
            }));
        } catch (err) {
            console.warn('Error fetching terminal fiscal readiness:', err);
            setFiscalReadinessByTerminal((current) => ({
                ...current,
                [key]: {
                    status: 'ERROR',
                    message: getErrorMessage(err),
                    checked_at: new Date().toISOString(),
                },
            }));
        } finally {
            setFiscalReadinessLoadingKey((current) => current === key ? null : current);
        }
    };

    const handleAuthorizeDeviceForTerminal = async (
        terminal: TenantTerminalSnapshot,
        requestedDeviceIdInput: string,
        authorizedDeviceIdInput?: string | null,
        request?: TerminalAuthAttempt | null,
    ) => {
        if (!selectedTenantForTerminals) return;
        if (!canReauthorizeTerminals) {
            alert('No tienes permiso para reautorizar dispositivos de terminales.');
            return;
        }
        if (deviceActionInFlightRef.current) {
            alert('Ya existe una autorización de terminal en curso. Espera a que finalice y se recargue el estado canónico.');
            return;
        }
        if (isCanonicalTerminalActionBlocked(terminal)) {
            alert(CANONICAL_ERP_IDENTITY_REQUIRED_MESSAGE);
            return;
        }

        const requestedDeviceId = requestedDeviceIdInput.trim();
        const terminalId = getTerminalTakeoverId(terminal);
        if (!terminalId || !requestedDeviceId) {
            alert('DEVICE_ID_REQUIRED: esta terminal necesita terminal_id y device_id del POS autorizado para autorizar.');
            return;
        }

        const requiresErpConfirmation = selectedTenantForTerminals.contracted_product === 'POS_ERP';
        const authorizedDeviceId = authorizedDeviceIdInput || getTerminalAuthorizedDeviceId(terminal) || 'N/D';
        const confirmed = confirm(
            `Terminal a transferir: ${terminal.name} / ${terminalId}\n`
            + `Dispositivo actualmente autorizado: ${authorizedDeviceId}\n`
            + `Nuevo dispositivo: ${requestedDeviceId}\n\n`
            + 'El dispositivo anterior será bloqueado y todas sus credenciales/tokens serán revocados. '
            + (requiresErpConfirmation
                ? 'ALFA-RMS debe confirmar explícitamente el takeover y la rotación; de lo contrario ALFA-Admin no mostrará éxito. '
                : '')
            + '\n\n¿Confirmas esta reautorización?',
        );
        if (!confirmed) return;

        const key = `${getTerminalKey(terminal)}-TAKEOVER-${requestedDeviceId}`;
        const operationId = crypto.randomUUID();
        deviceActionInFlightRef.current = true;
        setDeviceActionSubmittingKey(key);
        try {
            const result = await tenantService.requestTerminalDeviceAction({
                tenantId: selectedTenantForTerminals.id,
                terminalId,
                catalogTerminalId: terminal.catalog_terminal_id,
                storeId: terminal.erp_store_id,
                registryId: terminal.registry?.id || null,
                terminalName: terminal.name,
                deviceName: request?.device_name
                    || (typeof request?.metadata?.device_name === 'string' ? request.metadata.device_name : null),
                deviceId: requestedDeviceId,
                requestId: request?.id || null,
                expectedAuthorizedDeviceId: authorizedDeviceId !== 'N/D' ? authorizedDeviceId : null,
                action: 'TAKEOVER',
                reason: 'CLOUD_ADMIN_TERMINAL_REAUTHORIZATION',
                idempotencyKey: operationId,
            });
            const canonicalData = await tenantService.getTenantTerminalOverview(selectedTenantForTerminals.id);
            const canonicalTerminal = canonicalData.find((item) => getTerminalTakeoverId(item) === terminalId);
            const canonicalAuthorizedDevice = canonicalTerminal ? getTerminalAuthorizedDeviceId(canonicalTerminal) : null;
            if (!canonicalTerminal || canonicalAuthorizedDevice !== requestedDeviceId) {
                throw new Error(
                    `ERP_CANONICAL_STATE_MISMATCH: el ERP/overview reporta ${canonicalAuthorizedDevice || 'N/D'} como autorizado; se esperaba ${requestedDeviceId}.`,
                );
            }
            setTenantTerminals(canonicalData);
            setAuthAttemptsByTerminal((current) => ({ ...current, [getTerminalKey(terminal)]: [] }));
            setDeviceAuditByTerminal((current) => ({ ...current, [getTerminalKey(terminal)]: [] }));
            await loadTerminalAuthAttempts(selectedTenantForTerminals.id, canonicalTerminal);
            alert(`${result.message || 'Device autorizado. Reintenta conexion desde el POS.'}\n\nOperación: ${result.operation_id || operationId}`);
        } catch (err: unknown) {
            console.error('Error authorizing terminal device:', err);
            alert(getErrorMessage(err));
        } finally {
            deviceActionInFlightRef.current = false;
            setDeviceActionSubmittingKey(null);
        }
    };

    const handleAuthorizeDeviceForManualInput = async (terminal: TenantTerminalSnapshot, deviceId: string) => {
        await handleAuthorizeDeviceForTerminal(terminal, deviceId, getTerminalAuthorizedDeviceId(terminal));
    };

    const handleReauthorizeAttempt = async (terminal: TenantTerminalSnapshot, attempt: TerminalAuthAttempt) => {
        const requestedDeviceId = getAttemptDeviceId(attempt);
        if (!requestedDeviceId) {
            alert('El intento rechazado no tiene terminal o device_id suficiente para reautorizar.');
            return;
        }
        if (!attempt.id) {
            alert('El ERP no devolvió un identificador canónico para esta solicitud. No se puede aprobar de forma segura.');
            return;
        }
        await handleAuthorizeDeviceForTerminal(
            terminal,
            requestedDeviceId,
            attempt.authorized_device_id || getTerminalAuthorizedDeviceId(terminal),
            attempt,
        );
    };

    const handleRejectDeviceRequest = async (terminal: TenantTerminalSnapshot, attempt: TerminalAuthAttempt) => {
        if (!selectedTenantForTerminals || !attempt.id) return;
        if (!canReauthorizeTerminals) {
            alert('No tienes permiso para rechazar solicitudes de dispositivos.');
            return;
        }
        if (deviceActionInFlightRef.current) {
            alert('Ya existe una operación de terminal en curso. Espera a que finalice.');
            return;
        }
        const terminalId = getTerminalTakeoverId(terminal);
        const requestedDeviceId = getAttemptDeviceId(attempt);
        if (!terminalId || !requestedDeviceId) return;
        if (!confirm(`¿Rechazar la solicitud de ${requestedDeviceId} para ${terminal.name}? El dispositivo seguirá sin autorización.`)) return;

        const key = `${getTerminalKey(terminal)}-REJECT-${attempt.id}`;
        deviceActionInFlightRef.current = true;
        setDeviceActionSubmittingKey(key);
        try {
            await tenantService.rejectTerminalDeviceRequest({
                tenantId: selectedTenantForTerminals.id,
                terminalId,
                requestId: attempt.id,
                requestedDeviceId,
            });
            await loadTerminalAuthAttempts(selectedTenantForTerminals.id, terminal);
            alert('Solicitud de dispositivo rechazada por el ERP.');
        } catch (err: unknown) {
            console.error('Error rejecting terminal device request:', err);
            alert(getErrorMessage(err));
        } finally {
            deviceActionInFlightRef.current = false;
            setDeviceActionSubmittingKey(null);
        }
    };

    const handleRepairErpDeviceMapping = async (terminal: TenantTerminalSnapshot) => {
        if (!selectedTenantForTerminals) return;
        if (isCanonicalTerminalActionBlocked(terminal)) {
            alert(CANONICAL_ERP_IDENTITY_REQUIRED_MESSAGE);
            return;
        }
        const terminalId = getTerminalTakeoverId(terminal);
        const deviceId = getTerminalAuthorizedDeviceId(terminal);
        if (!terminalId || !deviceId) {
            alert('DEVICE_ID_REQUIRED: esta terminal necesita terminal_id y device_id autorizado actual para reparar el enlace ERP.');
            return;
        }

        const key = `${getTerminalKey(terminal)}-REPAIR-ERP`;
        setDeviceActionSubmittingKey(key);
        try {
            const result = await tenantService.requestTerminalDeviceAction({
                tenantId: selectedTenantForTerminals.id,
                terminalId,
                catalogTerminalId: terminal.catalog_terminal_id,
                storeId: terminal.erp_store_id,
                registryId: terminal.registry?.id || null,
                terminalName: terminal.name,
                deviceId,
                action: 'TAKEOVER',
                reason: 'ERP_DEVICE_MAPPING_REPAIR',
            });
            alert(result.message || 'Terminal revalidada correctamente en Cloud y ERP. El POS debe reintentar conexion.');
            await refreshTerminalModalData();
        } catch (err: unknown) {
            console.error('Error repairing ERP terminal device mapping:', err);
            alert(getErrorMessage(err));
        } finally {
            setDeviceActionSubmittingKey(null);
        }
    };

    const handleSyncAuthorizedDevice = async (terminal: TenantTerminalSnapshot) => {
        if (!selectedTenantForTerminals) return;
        const terminalId = getTerminalTakeoverId(terminal);
        const deviceId = terminal.registry?.device_id?.trim() || getTerminalAuthorizedDeviceId(terminal);
        if (!terminalId || !deviceId) {
            alert('DEVICE_ID_REQUIRED: esta terminal necesita terminal_id y device_id en el registro para sincronizar autorizacion.');
            return;
        }

        const confirmed = confirm(
            `Se persistirá ${deviceId} como device autorizado en ALFA-Admin para ${terminal.name}. `
            + 'El POS puede reintentar conexion sin rotar credenciales. ¿Deseas continuar?',
        );
        if (!confirmed) return;

        const key = `${getTerminalKey(terminal)}-SYNC-AUTH`;
        setDeviceActionSubmittingKey(key);
        try {
            const result = await tenantService.requestTerminalDeviceAction({
                tenantId: selectedTenantForTerminals.id,
                terminalId,
                catalogTerminalId: terminal.catalog_terminal_id,
                storeId: terminal.erp_store_id,
                registryId: terminal.registry?.id || null,
                terminalName: terminal.name,
                deviceId,
                action: 'SYNC_AUTHORIZED_DEVICE',
                reason: 'REGISTRY_DEVICE_SYNC',
            });
            alert(result.message || 'Device autorizado sincronizado en ALFA-Admin.');
            await refreshTerminalModalData();
        } catch (err: unknown) {
            console.error('Error syncing authorized device:', err);
            alert(getErrorMessage(err));
        } finally {
            setDeviceActionSubmittingKey(null);
        }
    };

    const handleReleasePosOnlyProvisioningBlock = async () => {
        if (!selectedTenantForTerminals) return;
        if (selectedTenantForTerminals.contracted_product !== 'POS_ONLY') {
            alert('Esta accion solo aplica a tenants POS_ONLY.');
            return;
        }
        if (selectedTenantForTerminals.lifecycle_status !== 'BLOCKED') {
            alert('El tenant no tiene lifecycle BLOCKED.');
            return;
        }

        const confirmed = confirm(
            'Se quitara lifecycle BLOCKED dejado por un readiness ERP fallido. '
            + 'El POS deberia dejar de mostrar acceso suspendido si dependia de ese campo. ¿Deseas continuar?',
        );
        if (!confirmed) return;

        try {
            await tenantService.releasePosOnlyProvisioningBlock(selectedTenantForTerminals.id);
            alert('Bloqueo de aprovisionamiento liberado para POS_ONLY.');
            const data = await tenantService.getTenants();
            setTenants(data || []);
            const refreshed = (data || []).find((row) => row.id === selectedTenantForTerminals.id);
            if (refreshed) setSelectedTenantForTerminals(refreshed);
            await refreshTerminalModalData();
        } catch (err: unknown) {
            console.error('Error releasing POS_ONLY provisioning block:', err);
            alert(getErrorMessage(err));
        }
    };

    const handleRotateTerminalCredentials = async (terminal: TenantTerminalSnapshot) => {
        if (!selectedTenantForTerminals) return;
        if (isCanonicalTerminalActionBlocked(terminal)) {
            alert(CANONICAL_ERP_IDENTITY_REQUIRED_MESSAGE);
            return;
        }
        const terminalId = getTerminalTakeoverId(terminal);
        const deviceId = getTerminalAuthorizedDeviceId(terminal);
        if (!terminalId || !deviceId) {
            alert('DEVICE_ID_REQUIRED: esta terminal necesita terminal_id y device_id autorizado actual para rotar credenciales.');
            return;
        }

        const confirmed = confirm(`Se invalidara el token anterior de ${deviceId}. El POS debera reautenticarse para recibir un nuevo syncToken. ¿Deseas continuar?`);
        if (!confirmed) return;

        const key = `${getTerminalKey(terminal)}-ROTATE`;
        setDeviceActionSubmittingKey(key);
        try {
            const result = await tenantService.requestTerminalDeviceAction({
                tenantId: selectedTenantForTerminals.id,
                terminalId,
                catalogTerminalId: terminal.catalog_terminal_id,
                storeId: terminal.erp_store_id,
                registryId: terminal.registry?.id || null,
                terminalName: terminal.name,
                deviceId,
                action: 'ROTATE_TOKEN',
                reason: 'TOKEN_ROTATION_REQUIRED',
            });
            alert(result.message || 'Credenciales rotadas correctamente. El POS debe reintentar autenticacion.');
            await refreshTerminalModalData();
        } catch (err: unknown) {
            console.error('Error rotating terminal credentials:', err);
            alert(getErrorMessage(err));
        } finally {
            setDeviceActionSubmittingKey(null);
        }
    };

    const handleReleaseTerminalLicenseSlot = async (
        terminal: TenantTerminalSnapshot,
        registryId: string,
        deviceId: string,
    ) => {
        if (!selectedTenantForTerminals) return;

        const isPosOnlySlots = selectedTenantForTerminals.contracted_product === 'POS_ONLY';
        const confirmed = confirm(
            isPosOnlySlots
                ? `Se liberara la caja completa "${terminal.name}" (todos los equipos de esa caja). `
                    + 'En POS_ONLY cada licencia es una caja distinta (Caja 1, Caja 2, ...). '
                    + 'Luego active el nuevo Android reutilizando el mismo nombre de caja o creando otra caja libre. ¿Deseas continuar?'
                : `Se liberara el cupo de licencia usado por ${deviceId} (${terminal.name}). `
                    + 'Ese registro quedara OFFLINE/revocado y otro Android con un device_id nuevo podra tomar la licencia. ¿Deseas continuar?',
        );
        if (!confirmed) return;

        const key = `${getTerminalKey(terminal)}-RELEASE-${deviceId}`;
        setDeviceActionSubmittingKey(key);
        try {
            const result = await tenantService.releaseTerminalLicenseSlot({
                tenantId: selectedTenantForTerminals.id,
                registryId,
                deviceId,
            });
            alert(result.message);
            await refreshTerminalModalData();
        } catch (err: unknown) {
            console.error('Error releasing terminal license slot:', err);
            alert(getErrorMessage(err));
        } finally {
            setDeviceActionSubmittingKey(null);
        }
    };

    const handleRevokePreviousDevice = async (terminal: TenantTerminalSnapshot, deviceId: string) => {
        if (!selectedTenantForTerminals) return;
        if (isCanonicalTerminalActionBlocked(terminal)) {
            alert(CANONICAL_ERP_IDENTITY_REQUIRED_MESSAGE);
            return;
        }
        const terminalId = getTerminalTakeoverId(terminal);
        if (!terminalId || !deviceId) return;

        const confirmed = confirm(`Se marcara ${deviceId} como equipo revocado para ${terminal.name}. No se borrara data operacional. ¿Deseas continuar?`);
        if (!confirmed) return;

        const key = `${getTerminalKey(terminal)}-REVOKE-${deviceId}`;
        setDeviceActionSubmittingKey(key);
        try {
            const result = await tenantService.requestTerminalDeviceAction({
                tenantId: selectedTenantForTerminals.id,
                terminalId,
                catalogTerminalId: terminal.catalog_terminal_id,
                storeId: terminal.erp_store_id,
                registryId: terminal.registry?.id || null,
                terminalName: terminal.name,
                deviceId,
                action: 'REVOKE_DEVICE',
                reason: 'MANUAL_REVOKE_DEVICE',
            });
            alert(result.message || 'Equipo anterior marcado como revocado.');
            await refreshTerminalModalData();
        } catch (err: unknown) {
            console.error('Error revoking terminal device:', err);
            alert(getErrorMessage(err));
        } finally {
            setDeviceActionSubmittingKey(null);
        }
    };

    const handleClearTerminalDevices = async (terminal: TenantTerminalSnapshot) => {
        if (!selectedTenantForTerminals) return;
        if (isCanonicalTerminalActionBlocked(terminal)) {
            alert(CANONICAL_ERP_IDENTITY_REQUIRED_MESSAGE);
            return;
        }
        const terminalId = getTerminalTakeoverId(terminal);
        if (!terminalId) {
            alert('Esta terminal necesita terminal_id para limpiar devices.');
            return;
        }

        const confirmation = prompt(
            `Esta accion eliminara solo autorizaciones de devices de ${terminal.name} (${terminalId}). `
            + 'No borra ventas, maestros, secuencias ni configuracion fiscal. Escribe LIMPIAR para confirmar.',
        );
        if (confirmation !== 'LIMPIAR') return;

        const key = `${getTerminalKey(terminal)}-CLEAR-DEVICES`;
        setDeviceActionSubmittingKey(key);
        try {
            const result = await tenantService.requestTerminalDeviceAction({
                tenantId: selectedTenantForTerminals.id,
                terminalId,
                catalogTerminalId: terminal.catalog_terminal_id,
                storeId: terminal.erp_store_id,
                registryId: terminal.registry?.id || null,
                terminalName: terminal.name,
                action: 'CLEAR_TERMINAL_DEVICES',
                reason: 'LAB_DEVICE_BINDING_RESET',
            });
            const cleared = result.cleared_registry_count ?? 0;
            alert(result.message || `Devices limpiados. Registros eliminados: ${cleared}.`);
            await refreshTerminalModalData();
        } catch (err: unknown) {
            console.error('Error clearing terminal devices:', err);
            alert(getErrorMessage(err));
        } finally {
            setDeviceActionSubmittingKey(null);
        }
    };

    const handleTakeoverTerminalChange = (selectionKey: string) => {
        const selectedOption = getTakeoverOptions().find((option) => option.key === selectionKey) || null;
        setTakeoverTerminal(selectedOption?.terminal || null);
        setTakeoverFormData((current) => ({
            ...current,
            terminalId: selectedOption?.terminalId || '',
            registryId: selectedOption?.registryId || '',
            deviceName: selectedOption?.terminal?.name || current.deviceName,
        }));
    };

    const handleTerminalTakeover = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedTenantForTerminals || !takeoverTerminal) return;

        if (!isCloudRecoverableLocalPosTenant(selectedTenantForTerminals)) {
            alert(isExplicitOfflinePosTenant(selectedTenantForTerminals)
                ? 'Este POS está en modo offline/sin Cloud Staging. No tiene recuperación cloud desde ALFA-Admin.'
                : 'La recuperacion de terminal solo aplica a POS configurado como local. POS + ERP mantiene el flujo actual.');
            return;
        }

        const newDeviceId = takeoverFormData.newDeviceId.trim();
        const reason = takeoverFormData.reason.trim();

        if (!takeoverFormData.terminalId || !newDeviceId || !reason) {
            alert('Selecciona terminal, indica el nuevo device_id y registra el motivo del cambio.');
            return;
        }

        if (!takeoverFormData.confirmTakeover) {
            alert('Confirma que la tablet anterior quedara revocada antes de ejecutar la recuperacion.');
            return;
        }

        setIsTakeoverSubmitting(true);
        try {
            const result = await tenantService.requestTerminalTakeover({
                tenantId: selectedTenantForTerminals.id,
                terminalId: takeoverFormData.terminalId,
                registryId: takeoverFormData.registryId || takeoverTerminal.registry?.id || null,
                newDeviceId,
                deviceName: takeoverFormData.deviceName.trim() || undefined,
                reason,
                confirmTakeover: takeoverFormData.confirmTakeover,
            });
            let readinessMessage = '';
            try {
                const readiness = await requestErpReadinessForTerminal(takeoverTerminal, {
                    deviceId: newDeviceId,
                    terminalName: takeoverFormData.deviceName.trim() || takeoverTerminal.name,
                    silent: true,
                });
                readinessMessage = readiness?.status === 'ready'
                    ? '\n\nContexto ERP listo para operar.'
                    : '\n\nPOS vinculado, pero el contexto ERP aun no esta listo.';
            } catch (readinessError) {
                console.warn('Terminal takeover completed but ERP readiness failed:', readinessError);
                readinessMessage = '\n\nLa terminal fue reasignada, pero no se pudo validar el contexto ERP.';
            }
            alert(`${result.message || 'Terminal reasignada correctamente. La tablet anterior fue revocada. Inicia sesion/autentica la nueva tablet para continuar.'}${readinessMessage}`);
            closeTakeoverModal();
            const data = await tenantService.getTenantTerminalOverview(selectedTenantForTerminals.id);
            setTenantTerminals(data);
        } catch (err: unknown) {
            console.error('Error requesting terminal takeover:', err);
            alert(getErrorMessage(err));
        } finally {
            setIsTakeoverSubmitting(false);
        }
    };

    const handleTerminalLocalRebuild = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedTenantForTerminals || !rebuildTerminal) return;

        if (!isCloudRecoverableLocalPosTenant(selectedTenantForTerminals)) {
            alert(isExplicitOfflinePosTenant(selectedTenantForTerminals)
                ? 'Este POS está en modo offline/sin Cloud Staging. No tiene reconstrucción cloud desde ALFA-Admin.'
                : 'La reconstruccion local solo aplica a POS configurado como local. POS + ERP mantiene el flujo actual.');
            return;
        }

        const terminalId = getTerminalTakeoverId(rebuildTerminal);
        const reason = rebuildFormData.reason.trim();
        const currentDeviceId = getTerminalOperationalDeviceId(rebuildTerminal);

        if (!terminalId || !reason) {
            alert('Selecciona una terminal y registra el motivo de la reconstruccion.');
            return;
        }

        if (!currentDeviceId) {
            alert('Esta terminal no tiene device_id autorizado para reconstruir la base local.');
            return;
        }

        if (!rebuildFormData.confirmRebuild) {
            alert('Confirma que se forzara un bootstrap completo sin revocar el dispositivo actual.');
            return;
        }

        setIsRebuildSubmitting(true);
        try {
            const result = await tenantService.requestTerminalLocalRebuild({
                tenantId: selectedTenantForTerminals.id,
                terminalId,
                registryId: rebuildTerminal.registry?.id || null,
                reason,
                confirmRebuild: rebuildFormData.confirmRebuild,
            });
            let readinessMessage = '';
            try {
                const readiness = await requestErpReadinessForTerminal(rebuildTerminal, { silent: true });
                readinessMessage = readiness?.status === 'ready'
                    ? '\n\nContexto ERP listo para operar.'
                    : '\n\nPOS vinculado, pero el contexto ERP aun no esta listo.';
            } catch (readinessError) {
                console.warn('Local rebuild completed but ERP readiness failed:', readinessError);
                readinessMessage = '\n\nLa reconstruccion fue preparada, pero no se pudo validar el contexto ERP.';
            }
            alert(`${result.message || 'Reconstruccion local preparada. El POS debera descargar nuevamente su estado desde el ERP sin cambiar de dispositivo.'}${readinessMessage}`);
            closeRebuildModal();
            const data = await tenantService.getTenantTerminalOverview(selectedTenantForTerminals.id);
            setTenantTerminals(data);
        } catch (err: unknown) {
            console.error('Error requesting terminal local rebuild:', err);
            alert(getErrorMessage(err));
        } finally {
            setIsRebuildSubmitting(false);
        }
    };

    const handleUpdateTenant = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingTenant) return;

        setIsEditSubmitting(true);
        try {
            const products = normalizeTenantProductSelection(editFormData.products);
            const productConfig = deriveTenantConfigFromProducts(products);
            const semanticConfig = deriveTenantSemanticsFromProducts(products);

            await tenantService.updateTenant(editingTenant.id, {
                name: editFormData.name.trim(),
                legal_name: normalizeOptional(editFormData.legalName),
                tax_id: normalizeOptional(editFormData.taxId),
                phone: normalizeOptional(editFormData.phone),
                type: productConfig.type,
                cloud_sync: productConfig.cloudSync,
                max_pos_terminals: editFormData.products.pos_licenses,
                max_erp_users: editFormData.products.erp_users,
                contracted_product: semanticConfig.contractedProduct,
                pos_variant: semanticConfig.posVariant,
                offline_mode: semanticConfig.offlineMode,
                explicit_offline: semanticConfig.explicitOffline,
                cloud_disabled_reason: semanticConfig.cloudDisabledReason,
                pos_runtime: semanticConfig.posRuntime,
                cloud_channel: semanticConfig.cloudChannel,
                data_master: semanticConfig.dataMaster,
                cloud_sync_enabled: semanticConfig.cloudSyncEnabled,
                erp_core_enabled: semanticConfig.erpCoreEnabled,
                erp_ui_enabled: semanticConfig.erpUiEnabled,
                customer_erp_access: semanticConfig.customerErpAccess,
                backup_enabled: semanticConfig.backupEnabled,
                lifecycle_status: semanticConfig.lifecycleStatus,
                provisioning_status: semanticConfig.provisioningStatus,
            });

            if (editFormData.email.trim().toLowerCase() !== editingTenant.email || editFormData.password.trim()) {
                await tenantService.updateTenantCredentials(editingTenant.id, {
                    email: editFormData.email.trim().toLowerCase(),
                    password: editFormData.password.trim() || undefined,
                });
            }

            closeEditModal();
            await fetchTenants();
        } catch (err: unknown) {
            console.error('Error updating tenant:', err);
            alert('Error al actualizar el Tenant: ' + getErrorMessage(err));
        } finally {
            setIsEditSubmitting(false);
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'ACTIVE': return <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold uppercase transition-colors">Activo</span>;
            case 'SUSPENDED': return <span className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-bold uppercase transition-colors">Suspendido</span>;
            case 'TRIAL': return <span className="bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-xs font-bold uppercase transition-colors">Prueba</span>;
            default: return null;
        }
    };

    const renderProductSummary = (products: TenantProductSelection) => {
        const normalizedProducts = normalizeTenantProductSelection(products);
        const labels = getActiveProductLabels(normalizedProducts);
        const semantics = deriveTenantSemanticsFromProducts(normalizedProducts);
        let solutionLabel = 'Selecciona productos';

        try {
            solutionLabel = getTenantTypeLabel(deriveTenantConfigFromProducts(products).type);
        } catch {
            solutionLabel = 'Selecciona al menos un producto principal';
        }

        return (
            <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                    {labels.map((label) => (
                        <span key={label} className="px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-black uppercase tracking-wide border border-blue-100">
                            {label}
                        </span>
                    ))}
                </div>
                <p className="text-xs text-slate-500">
                    Solucion base: <span className="font-bold text-slate-700">{solutionLabel}</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-600">
                        Contrato: <span className="font-black text-slate-800">{semantics.contractedProduct}</span>
                    </span>
                    <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-600">
                        Variante POS: <span className="font-black text-slate-800">{semantics.posVariant}</span>
                    </span>
                    <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-600">
                        Canal cloud: <span className="font-black text-slate-800">{semantics.cloudChannel}</span>
                    </span>
                    <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-600">
                        Fuente datos: <span className="font-black text-slate-800">{semantics.dataMaster}</span>
                    </span>
                    <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-600">
                        ERP cliente: <span className="font-black text-slate-800">{semantics.customerErpAccess ? 'SI' : 'NO'}</span>
                    </span>
                </div>
                {semantics.contractedProduct === 'POS_ONLY' && semantics.cloudChannel === 'POS_CLOUD_STAGING' ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                        POS_ONLY SaaS: incluye Cloud Staging, respaldo, recuperacion y core interno. El cliente no ve ERP.
                    </div>
                ) : null}
                {semantics.posVariant === 'POS_ONLY_OFFLINE' ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                        POS Offline explicito: no tendra respaldo cloud, recuperacion SaaS ni preparacion automatica para ERP.
                    </div>
                ) : null}
            </div>
        );
    };
    const formatDateTime = (value?: string | null) => {
        if (!value) return 'N/D';
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return 'N/D';
        return parsed.toLocaleString('es-DO');
    };

    const renderTenantSemanticsGrid = (tenant: Tenant) => {
        const semantics = getTenantSemantics(tenant);
        const fields = [
            ['Producto contratado', semantics.contractedProduct],
            ['Variante POS', semantics.posVariant],
            ['Runtime POS', semantics.posRuntime],
            ['Canal cloud', semantics.cloudChannel],
            ['Fuente de datos', semantics.dataMaster],
            ['Cloud Sync', semantics.cloudSyncEnabled ? 'ACTIVO' : 'INACTIVO'],
            ['ERP Core interno', semantics.erpCoreEnabled ? 'PREPARADO' : 'NO PREPARADO'],
            ['Acceso ERP cliente', semantics.customerErpAccess ? 'SI' : 'NO'],
            ['ERP UI', semantics.erpUiEnabled ? 'SI' : 'NO'],
            ['Modo offline', semantics.offlineMode ? 'SI' : 'NO'],
            ['Lifecycle', semantics.lifecycleStatus],
            ['Provisioning', semantics.provisioningStatus],
            ['Ultimo sync recibido', formatDateTime(tenant.last_sync_received_at)],
            ['Ultimo backup', formatDateTime(tenant.last_backup_at)],
            ['Listo activar ERP', tenant.ready_for_erp_activation ? 'SI' : 'NO'],
            ['Eventos pendientes', String(tenant.pending_events_count ?? 0)],
            ['Eventos bloqueados', String(tenant.blocked_events_count ?? 0)],
        ];

        return (
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
                <div className="flex flex-col gap-1 mb-4">
                    <p className="text-sm font-black text-slate-800">Semantica comercial y tecnica</p>
                    <p className="text-xs text-slate-500">
                        El contrato controla acceso ERP; el canal cloud controla sincronizacion, staging y recuperacion.
                    </p>
                </div>
                {semantics.contractedProduct === 'POS_ONLY' && semantics.cloudChannel === 'NONE' ? (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                        Este POS esta en modo offline/sin Cloud Staging. No tendra respaldo cloud, recuperacion SaaS ni preparacion automatica para activar ERP.
                    </div>
                ) : null}
                {semantics.contractedProduct === 'POS_ONLY' && semantics.cloudChannel === 'POS_CLOUD_STAGING' ? (
                    <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                        POS_ONLY SaaS correcto: opera local con SQLite, sincroniza al cloud/core para respaldo y staging, y mantiene ERP visible apagado para el cliente.
                    </div>
                ) : null}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {fields.map(([label, value]) => (
                        <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p>
                            <p className="mt-1 text-sm font-bold text-slate-800 break-words">{value}</p>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const getRegistryStatusLabel = (terminal: TenantTerminalSnapshot) => {
        if (terminal.registry?.is_revoked || terminal.registry?.auth_status === 'OLD_DEVICE_REVOKED') return 'REVOCADA';
        const registryStatus = (terminal.registry?.status || '').toUpperCase();
        if (registryStatus === 'ONLINE') return 'ONLINE';
        if (registryStatus === 'OFFLINE') return 'OFFLINE';
        return terminal.is_active ? 'ACTIVA' : 'INACTIVA';
    };

    const getRegistryStatusClassName = (statusLabel: string) => {
        if (statusLabel === 'ONLINE') return 'bg-emerald-100 text-emerald-700';
        if (statusLabel === 'REVOCADA') return 'bg-rose-100 text-rose-700';
        return 'bg-slate-100 text-slate-500';
    };

    const getEffectiveApkVersion = (terminal: TenantTerminalSnapshot) => {
        const registryDeviceId = (terminal.registry?.current_device_id || terminal.registry?.device_id || '').trim().toUpperCase();
        const erpDeviceId = (terminal.erp_current_device_id || '').trim().toUpperCase();
        const canUseErpVersion = Boolean(terminal.erp_app_version || terminal.erp_app_version_code)
            && (!registryDeviceId || !erpDeviceId || registryDeviceId === erpDeviceId);

        if (canUseErpVersion) {
            return {
                version: terminal.erp_app_version?.trim() || '',
                versionCode: terminal.erp_app_version_code ?? null,
                source: 'ERP',
            };
        }

        return {
            version: terminal.registry?.app_version?.trim() || '',
            versionCode: terminal.registry?.app_version_code ?? null,
            source: 'Cloud-Admin',
        };
    };

    const getApkVersionKey = (terminal: TenantTerminalSnapshot) => {
        const apkVersion = getEffectiveApkVersion(terminal);
        const version = apkVersion.version;
        const versionCode = apkVersion.versionCode ? String(apkVersion.versionCode) : '';
        if (!version && !versionCode) return '';
        return `${version}::${versionCode}`;
    };

    const formatApkVersion = (terminal: TenantTerminalSnapshot) => {
        const { version, versionCode } = getEffectiveApkVersion(terminal);
        if (!version && !versionCode) return 'N/D';
        if (version && versionCode) return `APK v${version} (${versionCode})`;
        if (version) return `APK v${version}`;
        return `Build ${versionCode}`;
    };

    const getApkVersionSourceLabel = (terminal: TenantTerminalSnapshot) => {
        const apkVersion = getEffectiveApkVersion(terminal);
        if (!apkVersion.version && !apkVersion.versionCode) return '';
        return apkVersion.source;
    };

    const referenceVersionCandidate = (() => {
        if (latestPosApkRelease) {
            return {
                key: `${latestPosApkRelease.version_name}::${latestPosApkRelease.version_code}`,
                label: `APK v${latestPosApkRelease.version_name} (${latestPosApkRelease.version_code})`,
                source: 'APK POS',
            };
        }

        const primary = tenantTerminals.find((terminal) => terminal.registry?.is_primary && getApkVersionKey(terminal));
        if (primary) {
            return {
                key: getApkVersionKey(primary),
                label: formatApkVersion(primary),
                source: primary.name,
            };
        }

        const versionCounter = new Map<string, { count: number; label: string; source: string }>();
        for (const terminal of tenantTerminals) {
            const key = getApkVersionKey(terminal);
            if (!key) continue;

            const current = versionCounter.get(key);
            versionCounter.set(key, {
                count: (current?.count || 0) + 1,
                label: current?.label || formatApkVersion(terminal),
                source: current?.source || terminal.name,
            });
        }

        const mostCommonVersion = Array.from(versionCounter.entries()).sort((a, b) => b[1].count - a[1].count)[0];
        return mostCommonVersion
            ? {
                key: mostCommonVersion[0],
                label: mostCommonVersion[1].label,
                source: mostCommonVersion[1].source,
            }
            : null;
    })();

    const referenceVersionKey = referenceVersionCandidate?.key || '';
    const registryTerminals = tenantTerminals.flatMap((terminal) => (
        terminal.registries?.length
            ? terminal.registries.map((registry) => ({ ...terminal, registry }))
            : [terminal]
    ));
    const outOfVersionCount = registryTerminals.filter((terminal) => {
        const terminalVersionKey = getApkVersionKey(terminal);
        return Boolean(referenceVersionKey && terminalVersionKey && terminalVersionKey !== referenceVersionKey);
    }).length;
    const missingVersionCount = registryTerminals.filter((terminal) => !getApkVersionKey(terminal)).length;

    const normalizeIp = (value?: string | null) => (value || '').trim();

    const parseEndpointHost = (value?: string | null) => {
        const rawValue = (value || '').trim();
        if (!rawValue) return null;

        try {
            const normalized = rawValue.includes('://') ? rawValue : `http://${rawValue}`;
            const parsed = new URL(normalized);
            return parsed.hostname || null;
        } catch {
            return null;
        }
    };

    const isIpv4 = (value: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(value);

    const isPrivateLanIp = (value: string) => {
        if (!isIpv4(value)) return false;
        if (value.startsWith('10.')) return true;
        if (value.startsWith('192.168.')) return true;

        const [firstOctet, secondOctet] = value.split('.').map((part) => Number(part));
        return firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31;
    };

    const isLikelyVirtualIp = (value: string) => {
        if (!isIpv4(value)) return false;

        return (
            value.startsWith('127.')
            || value.startsWith('169.254.')
            || value.startsWith('10.0.2.')
            || value.startsWith('10.0.3.')
            || value === '10.0.2.2'
            || value === '10.0.3.2'
            || value.startsWith('192.168.56.')
            || value.startsWith('192.168.58.')
            || value.startsWith('192.168.59.')
            || value.startsWith('192.168.122.')
            || value === '192.168.64.1'
        );
    };

    const getReportedIps = (terminal: TenantTerminalSnapshot) => {
        const endpointHost = parseEndpointHost(terminal.registry?.endpoint_url);
        return Array.from(
            new Set(
                [
                    terminal.registry?.local_ip,
                    ...(terminal.registry?.local_ips || []),
                    endpointHost,
                ]
                    .map((value) => normalizeIp(value))
                    .filter(Boolean)
            )
        );
    };

    const getLanIps = (terminal: TenantTerminalSnapshot) =>
        getReportedIps(terminal).filter((ip) => isPrivateLanIp(ip) && !isLikelyVirtualIp(ip));


    const getPreferredLanIp = (terminal: TenantTerminalSnapshot) => {
        const endpointHost = normalizeIp(parseEndpointHost(terminal.registry?.endpoint_url));
        if (endpointHost && getLanIps(terminal).includes(endpointHost)) return endpointHost;

        const primaryIp = normalizeIp(terminal.registry?.local_ip);
        if (primaryIp && getLanIps(terminal).includes(primaryIp)) return primaryIp;

        return getLanIps(terminal)[0] || primaryIp || endpointHost || 'N/D';
    };

    const onlineTerminalCount = registryTerminals.filter((terminal) => getRegistryStatusLabel(terminal) === 'ONLINE').length;
    const offlineTerminalCount = registryTerminals.filter((terminal) => getRegistryStatusLabel(terminal) === 'OFFLINE').length;
    const revokedTerminalCount = registryTerminals.filter((terminal) => getRegistryStatusLabel(terminal) === 'REVOCADA').length;
    const masterTerminalCount = registryTerminals.filter((terminal) => terminal.registry?.is_primary && getRegistryStatusLabel(terminal) === 'ONLINE').length;
    const clientTerminalCount = registryTerminals.filter((terminal) => !terminal.registry?.is_primary).length;
    const publishedEndpointCount = registryTerminals.filter((terminal) => Boolean(terminal.registry)).length;
    const terminalLicenseLimit = posLicenseSeats?.maxSeats ?? selectedTenantForTerminals?.max_pos_terminals;
    const activeLicensedTerminalCount = posLicenseSeats?.usedSeats ?? 0;
    const licenseCountUnit = posLicenseSeats?.licenseUnit === 'erp_terminal'
        ? 'terminales ERP'
        : posLicenseSeats?.licenseUnit === 'terminal_id'
            ? 'cajas'
            : 'equipos';
    const isTerminalLicenseOverLimit = typeof terminalLicenseLimit === 'number' && activeLicensedTerminalCount > terminalLicenseLimit;
    const hasFreeLicenseSlot = typeof terminalLicenseLimit === 'number' && activeLicensedTerminalCount < terminalLicenseLimit;
    const licenseExceededDeviceCount = registryTerminals.filter(
        (terminal) => (terminal.registry?.auth_status || '').toUpperCase() === 'LICENSE_EXCEEDED',
    ).length;
    const erpReadyTerminalCount = registryTerminals.filter((terminal) => getErpReadinessStatus(terminal) === 'ready').length;
    const terminalStoreOptions = Array.from(new Map(
        tenantTerminals.map((terminal) => {
            const storeKey = terminal.erp_store_id || 'UNASSIGNED';
            const storeLabel = terminal.erp_store_name || 'Sin sucursal vinculada';
            return [storeKey, storeLabel];
        }),
    ).entries()).sort((a, b) => a[1].localeCompare(b[1], 'es'));
    const normalizedTerminalSearch = terminalSearchTerm.trim().toLocaleLowerCase('es');
    const hasPendingDeviceRequest = (terminal: TenantTerminalSnapshot) => {
        const authorizedDeviceId = getTerminalAuthorizedDeviceId(terminal);
        return (authAttemptsByTerminal[getTerminalKey(terminal)] || []).some((attempt) => {
            const requestedDeviceId = getAttemptDeviceId(attempt);
            return isPendingDeviceUnauthorizedAttempt(attempt)
                && requestedDeviceId !== authorizedDeviceId;
        });
    };
    const pendingDeviceRequestTerminalCount = tenantTerminals.filter(hasPendingDeviceRequest).length;
    const visibleTenantTerminals = tenantTerminals
        .filter((terminal) => {
            const storeKey = terminal.erp_store_id || 'UNASSIGNED';
            if (terminalStoreFilter !== 'ALL' && terminalStoreFilter !== storeKey) return false;
            if (terminalRequestFilter === 'PENDING' && !hasPendingDeviceRequest(terminal)) return false;
            if (!normalizedTerminalSearch) return true;

            return [
                terminal.name,
                terminal.terminal_id,
                terminal.terminal_code,
                terminal.erp_store_name,
                terminal.registry?.device_id,
                terminal.registry?.current_device_id,
            ].some((value) => value?.toLocaleLowerCase('es').includes(normalizedTerminalSearch));
        })
        .sort((a, b) => {
            const storeComparison = (a.erp_store_name || 'Sin sucursal vinculada')
                .localeCompare(b.erp_store_name || 'Sin sucursal vinculada', 'es');
            return storeComparison || a.name.localeCompare(b.name, 'es');
        });
    const editingTenantHasActiveErp = editingTenant
        ? deriveProductsFromTenant(editingTenant.type, editingTenant.cloud_sync, editingTenant.max_pos_terminals, editingTenant.max_erp_users, {
            posVariant: editingTenant.pos_variant,
            offlineMode: editingTenant.offline_mode,
            explicitOffline: editingTenant.explicit_offline,
            cloudChannel: editingTenant.cloud_channel,
        }).erp
        : false;
    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-black text-slate-800">Gestión de Tenants</h2>
                    <p className="text-slate-500 text-sm">Administra las cuentas de clientes y empresas suscritas.</p>
                </div>
                <button
                    onClick={() => setIsModalOpen(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-colors focus:ring-4 focus:ring-blue-100"
                >
                    <Plus size={20} />
                    Nuevo Tenant
                </button>
            </div>

            {provisionedCredentials && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h3 className="text-sm font-black uppercase tracking-wider text-emerald-800">Credenciales temporales</h3>
                            <p className="mt-1 text-sm text-emerald-700">
                                Entrega estas credenciales por un canal seguro y fuerza el cambio de contrasena en el primer acceso.
                            </p>
                            <p className="mt-3 text-sm text-slate-700">
                                <span className="font-bold">Email:</span> {provisionedCredentials.email}
                            </p>
                            <p className="text-sm text-slate-700">
                                <span className="font-bold">Clave temporal:</span> {provisionedCredentials.tempPassword}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setProvisionedCredentials(null)}
                            className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-emerald-700 transition-colors hover:bg-emerald-100"
                        >
                            Ocultar
                        </button>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <div className="relative w-96">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar por nombre, RNC, contacto o ciudad..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all"
                        />
                    </div>
                    <div className="flex gap-2 text-sm text-slate-600 font-medium items-center">
                        {loading ? <Loader2 className="animate-spin text-blue-500" size={16} /> : null}
                        <span>Total: {filteredTenants.length}</span>
                    </div>
                </div>

                <table className="w-full text-left">
                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-bold tracking-wider">
                        <tr>
                            <th className="px-6 py-4">Empresa / ID</th>
                            <th className="px-6 py-4">RNC / Cédula</th>
                            <th className="px-6 py-4">Contacto</th>
                            <th className="px-6 py-4 text-center">Estado</th>
                            <th className="px-6 py-4 text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                        {filteredTenants.length === 0 && !loading && (
                            <tr>
                                <td colSpan={5} className="px-6 py-8 text-center text-slate-500 italic">No se encontraron tenants.</td>
                            </tr>
                        )}
                        {filteredTenants.map((tenant) => {
                            const semantics = getTenantSemantics(tenant);
                            return (
                            <tr key={tenant.id} className="hover:bg-slate-50 transition-colors">
                                <td className="px-6 py-4">
                                    <div className="font-bold text-slate-800">{tenant.name}</div>
                                    <div className="text-xs text-slate-400 font-mono mt-0.5">{tenant.id}</div>
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                        {getActiveProductLabels(deriveProductsFromTenant(tenant.type, tenant.cloud_sync, tenant.max_pos_terminals, tenant.max_erp_users, {
                                            posVariant: tenant.pos_variant,
                                            offlineMode: tenant.offline_mode,
                                            explicitOffline: tenant.explicit_offline,
                                            cloudChannel: tenant.cloud_channel,
                                        })).map((label) => (
                                            <span key={label} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-wide">
                                                {label}
                                            </span>
                                        ))}
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-black uppercase tracking-wide">
                                            {semantics.contractedProduct}
                                        </span>
                                        <span className="px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 text-[10px] font-black uppercase tracking-wide">
                                            {semantics.cloudChannel}
                                        </span>
                                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-wide">
                                            ERP cliente: {semantics.customerErpAccess ? 'SI' : 'NO'}
                                        </span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 font-mono text-slate-600">{tenant.tax_id || 'N/A'}</td>
                                <td className="px-6 py-4">
                                    <div className="font-semibold text-slate-700">{tenant.contact_name || 'Sin persona de contacto'}</div>
                                    <div className="text-xs text-slate-500">{tenant.contact_email || tenant.email}</div>
                                    <div className="text-xs text-slate-400">{tenant.city || 'Ciudad no definida'}</div>
                                </td>
                                <td className="px-6 py-4 text-center">{getStatusBadge(tenant.status)}</td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={() => void openTerminalModal(tenant)}
                                            className="p-2 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"
                                            title="Ver terminales"
                                        >
                                            <Monitor size={18} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => openEditModal(tenant)}
                                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                            title="Editar"
                                        >
                                            <Edit3 size={18} />
                                        </button>
                                        {tenant.status === 'TRIAL' ? (
                                            <button
                                                type="button"
                                                onClick={() => void activateTrialTenant(tenant)}
                                                disabled={updatingStatusTenantId === tenant.id}
                                                className="p-2 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                                title="Activar empresa"
                                            >
                                                {updatingStatusTenantId === tenant.id ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => toggleTenantStatus(tenant)}
                                                disabled={updatingStatusTenantId === tenant.id}
                                                className={`p-2 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${tenant.status === 'ACTIVE' ? 'text-slate-400 hover:text-red-600 hover:bg-red-50' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'}`}
                                                title={tenant.status === 'ACTIVE' ? 'Forzar Suspensión' : 'Reactivar'}
                                            >
                                                {updatingStatusTenantId === tenant.id ? <Loader2 size={18} className="animate-spin" /> : <Power size={18} />}
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => void handleDeleteTenant(tenant)}
                                            disabled={deletingTenantId === tenant.id}
                                            className="p-2 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                            title="Eliminar tenant"
                                        >
                                            {deletingTenantId === tenant.id ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        )})}
                    </tbody>
                </table>
            </div>

            {isModalOpen && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <h3 className="font-black text-lg text-slate-800">Aprovisionar Nueva Empresa</h3>
                            <button onClick={closeCreateModal} className="text-slate-400 hover:text-slate-700 transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleCreateTenant} className="p-6 space-y-5">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Nombre Comercial <span className="text-red-500">*</span></label>
                                <input
                                    required
                                    type="text"
                                    value={formData.name}
                                    onChange={e => {
                                        const name = e.target.value;
                                        setFormData({
                                            ...formData,
                                            name,
                                            slug: isSlugManuallyEdited ? formData.slug : buildTenantSlug(name),
                                        });
                                    }}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                    placeholder="Ej. Supermercado El Sol"
                                />
                                <p className="text-xs text-slate-500 mt-1">El nombre comercial puede repetirse; el identificador tecnico debe ser unico.</p>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Identificador técnico <span className="text-red-500">*</span></label>
                                <input
                                    required
                                    type="text"
                                    value={formData.slug}
                                    onChange={e => {
                                        setIsSlugManuallyEdited(true);
                                        setFormData({ ...formData, slug: buildTenantSlug(e.target.value) });
                                    }}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800 font-mono"
                                    placeholder="mercasend_srl_prod"
                                />
                                <p className="text-xs text-slate-500 mt-1">Usa letras, numeros y guion bajo. Ej.: mercasend_srl_prod.</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">RNC / Cédula</label>
                                    <input
                                        type="text"
                                        value={formData.taxId}
                                        onChange={e => setFormData({ ...formData, taxId: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                        placeholder="Opcional"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Email de Acceso <span className="text-red-500">*</span></label>
                                    <input
                                        required
                                        type="email"
                                        value={formData.email}
                                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                        placeholder="admin@empresa.com"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Persona de Contacto <span className="text-red-500">*</span></label>
                                    <input
                                        required
                                        type="text"
                                        value={formData.contactName}
                                        onChange={e => setFormData({ ...formData, contactName: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                        placeholder="Nombre y apellido"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Mail de Contacto <span className="text-red-500">*</span></label>
                                    <input
                                        required
                                        type="email"
                                        value={formData.contactEmail}
                                        onChange={e => setFormData({ ...formData, contactEmail: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                        placeholder="contacto@empresa.com"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Ciudad <span className="text-red-500">*</span></label>
                                    <input
                                        required
                                        type="text"
                                        value={formData.city}
                                        onChange={e => setFormData({ ...formData, city: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                        placeholder="Santo Domingo"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">
                                        Distribuidor que Captó
                                        {distributorsLoading ? ' (cargando...)' : ''}
                                    </label>
                                    <select
                                        value={formData.capturedByDistributorId}
                                        onChange={e => setFormData({ ...formData, capturedByDistributorId: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                    >
                                        <option value="">Sin asignar</option>
                                        {distributors.map((distributor) => (
                                            <option key={distributor.id} value={distributor.id}>
                                                {distributor.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">
                                        Distribuidor que da Servicio
                                        {distributorsLoading ? ' (cargando...)' : ''}
                                    </label>
                                    <select
                                        value={formData.servicedByDistributorId}
                                        onChange={e => setFormData({ ...formData, servicedByDistributorId: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                    >
                                        <option value="">Sin asignar</option>
                                        {distributors.map((distributor) => (
                                            <option key={distributor.id} value={distributor.id}>
                                                {distributor.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {distributors.length === 0 && !distributorsLoading && (
                                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                    No hay distribuidores activos. Puedes crear tenants sin asignación y completar este dato después.
                                </p>
                            )}

                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <p className="text-sm font-black text-slate-800">Productos Activos</p>
                                        <p className="text-xs text-slate-500 mt-1">Define la combinación inicial de productos y addons para este tenant.</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={openCreateProductsModal}
                                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 text-sm font-bold text-slate-700 hover:border-blue-200 hover:text-blue-700 transition-colors"
                                    >
                                        <Boxes size={16} />
                                        Gestionar Productos
                                    </button>
                                </div>
                                <div className="mt-4">
                                    {renderProductSummary(formData.products)}
                                </div>
                            </div>

                            <div className="pt-4 flex gap-3">
                                <button
                                    type="button"
                                    onClick={closeCreateModal}
                                    className="flex-1 px-4 py-3 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="flex-1 px-4 py-3 text-white bg-blue-600 hover:bg-blue-700 rounded-xl font-bold shadow-sm transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
                                >
                                    {isSubmitting ? <><Loader2 size={18} className="animate-spin" /> Creando Esquema...</> : 'Confirmar Registro'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {isTerminalModalOpen && selectedTenantForTerminals && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
                        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-start bg-slate-50">
                            <div>
                                <h3 className="font-black text-lg text-slate-800">Terminales Activas del Tenant</h3>
                                <p className="text-sm text-slate-500 mt-1">
                                    {selectedTenantForTerminals.name} · {selectedTenantForTerminals.email}
                                </p>
                                <p className="text-xs text-slate-400 font-mono mt-1">{selectedTenantForTerminals.id}</p>
                            </div>
                            <button type="button" onClick={closeTerminalModal} className="text-slate-400 hover:text-slate-700 transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto space-y-6">
                            {(isTerminalLicenseOverLimit || licenseExceededDeviceCount > 0) ? (
                                <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <div>
                                        <p className="text-sm font-black text-red-800">Limite de terminales POS excedido</p>
                                        <p className="mt-1 text-sm text-red-700">
                                            Este tenant tiene contratada{typeof terminalLicenseLimit === 'number' && terminalLicenseLimit === 1 ? '' : 's'}
                                            {' '}
                                            {terminalLicenseLimit ?? 1} equipo(s) POS contratado(s), pero hay {activeLicensedTerminalCount} Android/caja(s) online
                                            {licenseExceededDeviceCount > 0
                                                ? ` y ${licenseExceededDeviceCount} equipo(s) marcado(s) sin licencia.`
                                                : '.'}
                                            {hasFreeLicenseSlot
                                                ? ' Hay cupo libre para activar otro equipo/caja.'
                                                : ' Libere una caja completa con Liberar cupo antes de activar otra.'}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => void handleEnforcePosLicenseLimits()}
                                        className="inline-flex items-center justify-center rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-bold text-red-800 shadow-sm hover:bg-red-100 transition-colors"
                                    >
                                        Aplicar limite de licencias
                                    </button>
                                </div>
                            ) : null}

                            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                                <div className={`rounded-2xl border px-4 py-4 ${isTerminalLicenseOverLimit ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                                    <p className={`text-xs font-bold uppercase tracking-wider ${isTerminalLicenseOverLimit ? 'text-red-700' : 'text-slate-500'}`}>Licencia POS</p>
                                    <p className={`mt-2 text-3xl font-black ${isTerminalLicenseOverLimit ? 'text-red-700' : 'text-slate-800'}`}>
                                        {activeLicensedTerminalCount}
                                        {typeof terminalLicenseLimit === 'number' && (
                                            <span className={`text-sm font-bold ml-2 ${isTerminalLicenseOverLimit ? 'text-red-500' : 'text-slate-400'}`}>
                                                / {terminalLicenseLimit} permitida{terminalLicenseLimit === 1 ? '' : 's'}
                                            </span>
                                        )}
                                    </p>
                                    <p className="mt-2 text-[11px] font-semibold text-slate-500">
                                        {tenantTerminals.length} grupo(s) · {publishedEndpointCount} registro(s) · cuenta {licenseCountUnit} autorizadas
                                    </p>
                                    {selectedTenantForTerminals?.contracted_product === 'POS_ONLY' ? (
                                        <p className="mt-1 text-[10px] text-slate-500">
                                            POS_ONLY: 1 licencia = 1 caja (nombre unico). Liberar cupo libera toda la caja.
                                        </p>
                                    ) : selectedTenantForTerminals?.contracted_product === 'POS_ERP' ? (
                                        <p className="mt-1 text-[10px] text-slate-500">
                                            POS+ERP: el limite se controla al crear terminales en el ERP. Vincular cajas POS no consume licencias adicionales.
                                        </p>
                                    ) : null}
                                </div>
                                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4">
                                    <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Endpoints Online</p>
                                    <p className="mt-2 text-3xl font-black text-emerald-700">{onlineTerminalCount}</p>
                                </div>
                                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
                                    <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Fuera de versión</p>
                                    <p className="mt-2 text-3xl font-black text-amber-700">{outOfVersionCount}</p>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Clientes / cajas</p>
                                    <p className="mt-2 text-3xl font-black text-slate-800">{clientTerminalCount}</p>
                                </div>
                                <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4">
                                    <p className="text-xs font-bold uppercase tracking-wider text-blue-700">ERP listo</p>
                                    <p className="mt-2 text-3xl font-black text-blue-700">{erpReadyTerminalCount}</p>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                                <p>
                                    Esta vista combina el catálogo de terminales del tenant con el registry de endpoints publicados en cloud. La máscara de red aún no se persiste, por eso se muestra como <span className="font-bold">N/D</span>.
                                </p>
                                <p className="mt-2">
                                    Use <span className="font-bold">IP LAN recomendada</span> o <span className="font-bold">Endpoint publicado</span> para conectar nuevas cajas. Las IPs virtuales o de emulador se separan como descartadas.
                                </p>
                                <p className="mt-2">
                                    {referenceVersionCandidate
                                        ? <>Versión de referencia: <span className="font-bold">v {referenceVersionCandidate.label}</span> desde <span className="font-bold">{referenceVersionCandidate.source}</span>.</>
                                        : <>Aún no hay versión de APK reportada por las terminales de este tenant.</>}
                                    {missingVersionCount > 0 ? <> <span className="font-bold">{missingVersionCount}</span> terminal(es) todavía no reportan versión.</> : null}
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-4">
                                    <p className="text-xs font-bold uppercase tracking-wider text-violet-700">Server master</p>
                                    <p className="mt-2 text-3xl font-black text-violet-700">{masterTerminalCount}</p>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Con endpoint cloud</p>
                                    <p className="mt-2 text-3xl font-black text-slate-800">{publishedEndpointCount}</p>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Revocadas / offline</p>
                                    <p className="mt-2 text-3xl font-black text-slate-800">{revokedTerminalCount + offlineTerminalCount}</p>
                                </div>
                            </div>

                            {renderTenantSemanticsGrid(selectedTenantForTerminals)}

                            {tenantTerminals.length > 0 ? (
                                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                    <div className="flex flex-col gap-3 md:flex-row md:items-center">
                                        <div className="relative flex-1">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                                            <input
                                                type="search"
                                                value={terminalSearchTerm}
                                                onChange={(event) => setTerminalSearchTerm(event.target.value)}
                                                placeholder="Buscar sucursal, terminal, código o dispositivo"
                                                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
                                            />
                                        </div>
                                        <select
                                            value={terminalStoreFilter}
                                            onChange={(event) => setTerminalStoreFilter(event.target.value)}
                                            aria-label="Filtrar terminales por sucursal"
                                            className="min-w-64 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-700 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
                                        >
                                            <option value="ALL">Todas las sucursales ({tenantTerminals.length})</option>
                                            {terminalStoreOptions.map(([storeId, storeName]) => (
                                                <option key={storeId} value={storeId}>
                                                    {storeName} ({tenantTerminals.filter((terminal) => (terminal.erp_store_id || 'UNASSIGNED') === storeId).length})
                                                </option>
                                            ))}
                                        </select>
                                        {canReauthorizeTerminals ? (
                                            <select
                                                value={terminalRequestFilter}
                                                onChange={(event) => setTerminalRequestFilter(event.target.value as TerminalRequestFilter)}
                                                aria-label="Filtrar terminales por solicitudes de dispositivo"
                                                className="min-w-64 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-700 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
                                            >
                                                <option value="ALL">Todas las solicitudes</option>
                                                <option value="PENDING">Con solicitudes pendientes ({pendingDeviceRequestTerminalCount})</option>
                                            </select>
                                        ) : null}
                                    </div>
                                    <p className="mt-2 text-xs font-semibold text-slate-500">
                                        Mostrando {visibleTenantTerminals.length} de {tenantTerminals.length} terminal(es), ordenadas por sucursal.
                                    </p>
                                </div>
                            ) : null}

                            {isTerminalModalLoading ? (
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-12 text-center text-slate-500 flex items-center justify-center gap-3">
                                    <Loader2 className="animate-spin text-violet-500" size={20} />
                                    Cargando terminales...
                                </div>
                            ) : tenantTerminals.length === 0 ? (
                                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center text-slate-500">
                                    No hay terminales ni endpoints reportados para este tenant.
                                </div>
                            ) : visibleTenantTerminals.length === 0 ? (
                                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center text-slate-500">
                                    {terminalRequestFilter === 'PENDING'
                                        ? 'No hay terminales con solicitudes pendientes que coincidan con los filtros seleccionados.'
                                        : 'No hay terminales que coincidan con la búsqueda o sucursal seleccionada.'}
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 gap-6">
                                    {visibleTenantTerminals.map((terminal) => {
                                        const hasOnlineRegistry = (terminal.registries || []).some((reg) => (
                                            getRegistryStatusLabel({ ...terminal, registry: reg }) === 'ONLINE'
                                        ));
                                        const erpReadiness = terminal.registry?.erp_readiness || null;
                                        const erpReadinessStatus = getErpReadinessStatus(terminal);
                                        const erpTenantId = getReadinessValue(erpReadiness, ['erpTenantId', 'erp_tenant_id']);
                                        const profileStatus = getReadinessValue(erpReadiness, ['profileStatus', 'profile_status']) || (erpReadinessStatus === 'ready' ? 'READY' : 'MISSING');
                                        const tenantReady = getReadinessCheckValue(erpReadiness, ['tenant']);
                                        const companyReady = getReadinessCheckValue(erpReadiness, ['company']);
                                        const storeReady = getReadinessCheckValue(erpReadiness, ['store']);
                                        const terminalReady = getReadinessCheckValue(erpReadiness, ['terminal']);
                                        const profileReady = getReadinessCheckValue(erpReadiness, ['profile']);
                                        const taxesReady = getReadinessCheckValue(erpReadiness, ['taxes', 'tax']);
                                        const paymentMethodsReady = getReadinessCheckValue(erpReadiness, ['paymentMethods', 'payment_methods', 'payments']);
                                        const warehousesReady = getReadinessCheckValue(erpReadiness, ['warehouses', 'warehouse']);
                                        const documentSeriesReady = getReadinessCheckValue(erpReadiness, ['documentSeries', 'document_series', 'series', 'sequences', 'sequencesReady', 'sequences_ready']);
                                        const itemsReady = getReadinessCheckValue(erpReadiness, ['items', 'catalog', 'catalogReady', 'catalog_ready', 'itemsReady', 'items_ready']);
                                        const profileIncomplete = isErpProfileIncomplete(erpReadiness);
                                        const lastSyncAt = getReadinessValue(erpReadiness, ['lastSyncEventAt', 'last_sync_event_at', 'lastSyncAt', 'last_sync_at']);
                                        const lastSyncType = getReadinessValue(erpReadiness, ['lastSyncEventType', 'last_sync_event_type', 'lastSyncStatus', 'last_sync_status']);
                                        const isReadinessSubmitting = erpReadinessSubmittingKey === getTerminalKey(terminal);
                                        const terminalKey = getTerminalKey(terminal);
                                        const terminalSyncPending = syncPendingByTerminal[terminalKey];
                                        const syncPending = {
                                            ...terminalSyncPending,
                                            status: terminalSyncPending?.status || 'idle',
                                            documents: terminalSyncPending?.documents || [],
                                            summary: { pending: 0, repairable: 0, functionalErrors: 0 },
                                            ...(terminalSyncPending?.summary ? { summary: terminalSyncPending.summary } : {}),
                                        };
                                        const repairableSyncCount = syncPending.documents.filter((document) => isRepairableSyncDocument(document, erpReadiness)).length;
                                        const functionalSyncErrorCount = Math.max(syncPending.summary.functionalErrors, syncPending.summary.pending - repairableSyncCount);
                                        const isSyncLoading = syncPendingLoadingKey === terminalKey;
                                        const syncBulkSubmitting = syncRetrySubmittingKey === `${terminalKey}-bulk`;
                                        const authAttempts = authAttemptsByTerminal[terminalKey] || [];
                                        const authAttemptsError = authAttemptsErrorByTerminal[terminalKey] || '';
                                        const deviceAudit = deviceAuditByTerminal[terminalKey] || [];
                                        const authStatus = getTerminalAuthStatus(terminal, authAttempts);
                                        const identity = buildTerminalIdentitySummary(terminal, authAttempts);
                                        const canonicalActionBlocked = isCanonicalTerminalActionBlocked(terminal);
                                        const reconciliationDraft = reconciliationDrafts[terminalKey] || {
                                            erpTerminalUuid: '',
                                            targetTerminalName: '',
                                            storeId: '',
                                            authorizedDeviceId: terminal.registry?.current_device_id || terminal.registry?.device_id || '',
                                            reason: '',
                                            adminConfirmed: false,
                                            correlationId: '',
                                            serverPreview: null,
                                        };
                                        const reconciliationPreview = buildTerminalReconciliationPreview(terminal, reconciliationDraft);
                                        const canonicalTerminalOptions = tenantTerminals.filter((candidate) => (
                                            candidate.id !== terminal.id && hasCanonicalErpBinding(candidate)
                                        ));
                                        const serverReconciliationPlan = reconciliationDraft.serverPreview?.plan;
                                        const isReconciliationSubmitting = reconciliationSubmittingKey === terminalKey;
                                        const authorizedDeviceId = identity.authorizedDeviceId !== 'N/D' ? identity.authorizedDeviceId : '';
                                        const posReportedDeviceId = identity.posReportedDeviceId !== 'N/D' ? identity.posReportedDeviceId : '';
                                        const erpCurrentDeviceId = identity.erpCurrentDeviceId !== 'N/D' ? identity.erpCurrentDeviceId : '';
                                        const requiresErpConfirmation = selectedTenantForTerminals.contracted_product === 'POS_ERP';
                                        const deviceIdentityAligned = isDeviceIdentityAligned(authorizedDeviceId, posReportedDeviceId, erpCurrentDeviceId, requiresErpConfirmation);
                                        const needsErpDeviceRepair = Boolean(
                                            requiresErpConfirmation
                                            && authorizedDeviceId
                                            && (!erpCurrentDeviceId || authorizedDeviceId !== erpCurrentDeviceId)
                                        );
                                        const effectiveAuthStatus = getEffectiveAuthStatus(
                                            authStatus,
                                            authorizedDeviceId,
                                            posReportedDeviceId,
                                            erpCurrentDeviceId,
                                            requiresErpConfirmation,
                                        );
                                        const authStatusClasses = getAuthStatusClasses(effectiveAuthStatus);
                                        const actionableAuthAttempts = authAttempts.filter((attempt) => {
                                            const requestedDeviceId = getAttemptDeviceId(attempt);
                                            return isPendingDeviceUnauthorizedAttempt(attempt)
                                                && requestedDeviceId !== authorizedDeviceId;
                                        });
                                        const lastRejectedDeviceId = identity.lastRejectedDeviceId !== 'N/D' ? identity.lastRejectedDeviceId : '';
                                        const lastAuthAttempt = authAttempts[0] || null;
                                        const lastAuthAttemptAt = terminal.registry?.last_auth_attempt_at || (lastAuthAttempt ? getAttemptTime(lastAuthAttempt) : null);
                                        const lastAuthError = terminal.registry?.last_auth_error || lastAuthAttempt?.reason || lastAuthAttempt?.message || '';
                                        const isAuthAttemptsLoading = authAttemptsLoadingKey === terminalKey;
                                        const rotateSubmittingKey = `${terminalKey}-ROTATE`;
                                        const syncAuthSubmittingKey = `${terminalKey}-SYNC-AUTH`;
                                        const repairErpSubmittingKey = `${terminalKey}-REPAIR-ERP`;
                                        const persistedAuthorizedDeviceId = getTerminalPersistedAuthorizedDeviceId(terminal);
                                        const needsAuthorizedDeviceSync = Boolean(
                                            terminal.registry?.device_id?.trim()
                                            && !persistedAuthorizedDeviceId,
                                        );
                                        const posOnlyProvisioningBlocked = selectedTenantForTerminals.contracted_product === 'POS_ONLY'
                                            && selectedTenantForTerminals.lifecycle_status === 'BLOCKED';
                                        const revokeDeviceId = terminal.registry?.previous_device_id || lastRejectedDeviceId;
                                        const revokeSubmittingKey = revokeDeviceId ? `${terminalKey}-REVOKE-${revokeDeviceId}` : '';
                                        const clearDevicesSubmittingKey = `${terminalKey}-CLEAR-DEVICES`;
                                        const fiscalReadiness = getFiscalReadiness(terminal);
                                        const fiscalDebug = summarizeTerminalFiscalDebug(fiscalReadiness);
                                        const fiscalStatus = fiscalDebug.fiscalReadiness;
                                        const fiscalStatusClasses = getFiscalStatusClasses(fiscalStatus);
                                        const isFiscalLoading = fiscalReadinessLoadingKey === terminalKey;
                                        const hasActionableAuthIssue = needsErpDeviceRepair || (!deviceIdentityAligned && (
                                            !['AUTHORIZED', 'TAKEOVER_COMPLETED', 'REAUTH_COMPLETED'].includes(effectiveAuthStatus)
                                            || actionableAuthAttempts.length > 0
                                        ));
                                        const hasActionableErpIssue = profileIncomplete && (syncPending.summary.pending > 0 || erpReadinessStatus === 'error');
                                        const hasActionableSyncIssue = syncPending.summary.pending > 0 && (repairableSyncCount > 0 || functionalSyncErrorCount > 0);
                                        const hasActionableFiscalIssue = isFiscalEligibleTenant(selectedTenantForTerminals) && fiscalStatus === 'ERROR';
                                        const hasAdvancedSignal = hasActionableAuthIssue || hasActionableErpIssue || hasActionableSyncIssue || hasActionableFiscalIssue;
                                        const isAdvancedOpen = Boolean(terminalAdvancedOpen[terminalKey]);
                                        const showHistoricalAuthDetails = isAdvancedOpen || hasActionableAuthIssue;
                                        const displayRejectedDeviceId = showHistoricalAuthDetails ? identity.lastRejectedDeviceId : 'N/D';
                                        const displayLastAuthError = showHistoricalAuthDetails ? lastAuthError : '';
                                        const displayLastAuthAttemptAt = showHistoricalAuthDetails ? lastAuthAttemptAt : null;
                                        const hasVisibleMismatchWarning = Boolean(identity.mismatchWarning && hasActionableAuthIssue);
                                        const operationalStatus = !hasOnlineRegistry
                                            ? 'OFFLINE'
                                            : hasActionableAuthIssue
                                                ? 'AUTH_REQUIRED'
                                                : hasActionableErpIssue || hasActionableSyncIssue || hasActionableFiscalIssue
                                                    ? 'ATTENTION'
                                                    : authorizedDeviceId || erpReadinessStatus === 'ready' || posReportedDeviceId
                                                        ? 'OPERATIVE'
                                                        : 'PENDING';
                                        const requestedTerminalTab = terminalTabs[terminalKey] || 'summary';
                                        const baseTerminalTabOptions: Array<{ key: TerminalTabKey; label: string; count?: number }> = [
                                            { key: 'summary', label: 'Resumen' },
                                            { key: 'devices', label: 'Dispositivos' },
                                            ...(canReauthorizeTerminals
                                                ? [{ key: 'attempts' as TerminalTabKey, label: 'Solicitudes', count: actionableAuthAttempts.length }]
                                                : []),
                                        ];
                                        const advancedTerminalTabOptions: Array<{ key: TerminalTabKey; label: string; count?: number }> = [
                                            { key: 'erp', label: 'Preparacion ERP' },
                                            { key: 'sync', label: 'Sync', count: syncPending.summary.pending },
                                            ...(isFiscalEligibleTenant(selectedTenantForTerminals) ? [{ key: 'fiscal' as TerminalTabKey, label: 'Fiscal' }] : []),
                                        ];
                                        const terminalTabOptions = isAdvancedOpen
                                            ? [...baseTerminalTabOptions, ...advancedTerminalTabOptions]
                                            : baseTerminalTabOptions;
                                        const activeTerminalTab = terminalTabOptions.some((tab) => tab.key === requestedTerminalTab)
                                            ? requestedTerminalTab
                                            : 'summary';
                                        const detectedAuthorizationDeviceId = lastRejectedDeviceId
                                            || (posReportedDeviceId && posReportedDeviceId !== authorizedDeviceId ? posReportedDeviceId : '');
                                        const manualDeviceId = manualDeviceIds[terminalKey]?.trim() || '';
                                        const authorizationDeviceId = detectedAuthorizationDeviceId || manualDeviceId;
                                        const manualAuthorizeKey = authorizationDeviceId ? `${terminalKey}-TAKEOVER-${authorizationDeviceId}` : '';

                                        return (
                                            <div key={`${terminal.id}`} className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
                                                <div className="bg-slate-50 border-b border-slate-100 p-5 flex items-center justify-between">
                                                    <div className="flex items-center gap-4">
                                                        <div className={`rounded-2xl p-3 ${hasOnlineRegistry ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                                                            {hasOnlineRegistry ? <Wifi size={20} /> : <WifiOff size={20} />}
                                                        </div>
                                                        <div>
                                                            <p className={`text-[10px] font-black uppercase tracking-wider ${terminal.erp_store_name ? 'text-blue-600' : 'text-amber-600'}`}>
                                                                {terminal.erp_store_name ? 'Sucursal' : 'Contexto pendiente'}
                                                            </p>
                                                            <div className="mt-0.5 flex flex-wrap items-center gap-3">
                                                                <h4 className="font-black text-slate-800 text-lg">
                                                                    <span>{terminal.erp_store_name || 'Sin sucursal vinculada'}</span>
                                                                    <span className="mx-2 text-slate-300">·</span>
                                                                    <span>{terminal.name}</span>
                                                                </h4>
                                                                <span className={`font-bold text-xs px-2.5 py-1 rounded-lg ${
                                                                    (terminal.registries || []).length > 1 ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                                                                }`}>
                                                                    {terminal.registries?.length || 0} Registro(s)
                                                                </span>
                                                            </div>
                                                            <p className="text-xs text-slate-500 font-mono mt-0.5">
                                                                Terminal ID: {terminal.terminal_id || 'N/D'}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col items-end gap-2">
                                                        <span className={`px-3 py-1 rounded-full border text-[11px] font-bold uppercase ${getOperationalStatusClasses(operationalStatus)}`}>
                                                            {getOperationalStatusLabel(operationalStatus)}
                                                        </span>
                                                        {hasAdvancedSignal ? (
                                                            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-bold uppercase text-amber-700">
                                                                Revisar soporte
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                </div>

                                                <div className="p-5 space-y-5">
                                                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-1">
                                                        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                                                            <div className="flex min-w-0 gap-1 overflow-x-auto">
                                                            {terminalTabOptions.map((tab) => {
                                                                const isActive = activeTerminalTab === tab.key;
                                                                return (
                                                                    <button
                                                                        key={tab.key}
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setTerminalTabs((current) => ({
                                                                                ...current,
                                                                                [terminalKey]: tab.key,
                                                                            }));
                                                                            if (tab.key === 'attempts' && !authAttemptsByTerminal[terminalKey]) {
                                                                                void loadTerminalAuthAttempts(selectedTenantForTerminals.id, terminal);
                                                                            }
                                                                            if (tab.key === 'fiscal' && !fiscalReadinessByTerminal[terminalKey]) {
                                                                                void loadTerminalFiscalReadiness(selectedTenantForTerminals.id, terminal);
                                                                            }
                                                                            if (tab.key === 'sync' && !terminalSyncPending) {
                                                                                void loadTerminalSyncPending(selectedTenantForTerminals.id, terminal);
                                                                            }
                                                                        }}
                                                                        className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-colors ${
                                                                            isActive
                                                                                ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-100'
                                                                                : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'
                                                                        }`}
                                                                    >
                                                                        {tab.label}
                                                                        {typeof tab.count === 'number' && tab.count > 0 ? (
                                                                            <span className={`rounded-full px-2 py-0.5 text-[10px] ${
                                                                                isActive ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
                                                                            }`}>
                                                                                {tab.count}
                                                                            </span>
                                                                        ) : null}
                                                                    </button>
                                                                );
                                                            })}
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => setTerminalAdvancedOpen((current) => ({
                                                                    ...current,
                                                                    [terminalKey]: !isAdvancedOpen,
                                                                }))}
                                                                className={`inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-bold transition-colors ${
                                                                    isAdvancedOpen
                                                                        ? 'bg-slate-900 text-white hover:bg-slate-800'
                                                                        : 'bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 hover:text-slate-900'
                                                                }`}
                                                            >
                                                                {isAdvancedOpen ? 'Ocultar soporte avanzado' : 'Soporte avanzado'}
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {activeTerminalTab === 'summary' ? (
                                                    <div className={`rounded-2xl border px-4 py-4 ${authStatusClasses}`}>
                                                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                                            <div>
                                                                <p className="text-xs font-bold uppercase tracking-wider">Identidad y autorizacion</p>
                                                                <p className="mt-1 text-sm font-bold">{getAuthStatusLabel(effectiveAuthStatus)}</p>
                                                                <p className="mt-1 text-xs opacity-80">
                                                                    ALFA-Admin muestra autorización, heartbeat del POS y device actual reportado por ALFA-RMS por separado.
                                                                </p>
                                                            </div>
                                                            {(isAdvancedOpen || hasActionableAuthIssue || posOnlyProvisioningBlocked || needsAuthorizedDeviceSync || detectedAuthorizationDeviceId || !hasOnlineRegistry) ? (
                                                            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                                                                {posOnlyProvisioningBlocked ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => void handleReleasePosOnlyProvisioningBlock()}
                                                                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-900 shadow-sm hover:bg-amber-100 transition-colors"
                                                                    >
                                                                        <ShieldCheck size={16} />
                                                                        Quitar bloqueo POS
                                                                    </button>
                                                                ) : null}
                                                                {needsAuthorizedDeviceSync && selectedTenantForTerminals.contracted_product !== 'POS_ERP' ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => void handleSyncAuthorizedDevice(terminal)}
                                                                        disabled={deviceActionSubmittingKey === syncAuthSubmittingKey}
                                                                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-900 shadow-sm hover:bg-emerald-100 transition-colors disabled:opacity-60"
                                                                    >
                                                                        {deviceActionSubmittingKey === syncAuthSubmittingKey ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                                                                        Persistir device autorizado
                                                                    </button>
                                                                ) : null}
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void loadTerminalAuthAttempts(selectedTenantForTerminals.id, terminal)}
                                                                    disabled={isAuthAttemptsLoading}
                                                                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-current bg-white/80 px-4 py-2 text-sm font-bold shadow-sm hover:bg-white transition-colors disabled:opacity-60"
                                                                >
                                                                    {isAuthAttemptsLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
                                                                    Actualizar intentos
                                                                </button>
                                                                {detectedAuthorizationDeviceId && canReauthorizeTerminals ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => void handleAuthorizeDeviceForManualInput(terminal, detectedAuthorizationDeviceId)}
                                                                        disabled={canonicalActionBlocked || deviceActionSubmittingKey === manualAuthorizeKey}
                                                                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-900 shadow-sm hover:bg-amber-100 transition-colors disabled:opacity-60"
                                                                    >
                                                                        {deviceActionSubmittingKey === manualAuthorizeKey ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                                                                        Autorizar device detectado
                                                                    </button>
                                                                ) : null}
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void handleRotateTerminalCredentials(terminal)}
                                                                    disabled={!canReauthorizeTerminals || canonicalActionBlocked || !authorizedDeviceId || deviceActionSubmittingKey !== null}
                                                                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-bold text-blue-700 shadow-sm hover:bg-blue-50 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                                                                >
                                                                    {deviceActionSubmittingKey === rotateSubmittingKey ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                                                                    Rotar credenciales
                                                                </button>
                                                                {needsErpDeviceRepair ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => void handleRepairErpDeviceMapping(terminal)}
                                                                        disabled={canonicalActionBlocked || !authorizedDeviceId || deviceActionSubmittingKey === repairErpSubmittingKey}
                                                                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                                                                    >
                                                                        {deviceActionSubmittingKey === repairErpSubmittingKey ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                                                                        Reparar enlace ERP
                                                                    </button>
                                                                ) : null}
                                                            </div>
                                                            ) : null}
                                                        </div>
                                                        {hasVisibleMismatchWarning ? (
                                                            <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-3 py-3 text-sm font-semibold text-red-800">
                                                                {identity.mismatchWarning}
                                                            </div>
                                                        ) : null}
                                                        {identity.reconciliationWarning ? (
                                                            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                                                                <p className="font-bold">{identity.reconciliationWarning}</p>
                                                                <p className="mt-1">{CANONICAL_ERP_IDENTITY_REQUIRED_MESSAGE}</p>
                                                                <details className="mt-3 rounded-lg border border-amber-200 bg-white/70 p-3">
                                                                    <summary className="cursor-pointer font-bold">Vista previa de reconciliación (dry-run)</summary>
                                                                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                                                                        <select
                                                                            value={reconciliationDraft.erpTerminalUuid}
                                                                            onChange={(event) => {
                                                                                const target = canonicalTerminalOptions.find((candidate) => candidate.erp_terminal_uuid === event.target.value);
                                                                                updateReconciliationDraft(terminalKey, reconciliationDraft, {
                                                                                    erpTerminalUuid: event.target.value,
                                                                                    targetTerminalName: target?.name || '',
                                                                                    storeId: target?.erp_store_id || '',
                                                                                });
                                                                            }}
                                                                            className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs"
                                                                        >
                                                                            <option value="">Terminal ERP destino…</option>
                                                                            {canonicalTerminalOptions.map((candidate) => (
                                                                                <option key={candidate.erp_terminal_uuid} value={candidate.erp_terminal_uuid || ''}>
                                                                                    {candidate.name} · {candidate.erp_terminal_uuid}
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                        <select
                                                                            value={reconciliationDraft.storeId}
                                                                            onChange={(event) => updateReconciliationDraft(terminalKey, reconciliationDraft, { storeId: event.target.value })}
                                                                            className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs"
                                                                        >
                                                                            <option value="">Sucursal ERP destino…</option>
                                                                            {canonicalTerminalOptions
                                                                                .filter((candidate) => candidate.erp_store_id)
                                                                                .map((candidate) => (
                                                                                    <option key={`${candidate.erp_terminal_uuid}-${candidate.erp_store_id}`} value={candidate.erp_store_id || ''}>
                                                                                        {candidate.name} · {candidate.erp_store_id}
                                                                                    </option>
                                                                                ))}
                                                                        </select>
                                                                        <input
                                                                            value={reconciliationDraft.authorizedDeviceId}
                                                                            onChange={(event) => updateReconciliationDraft(terminalKey, reconciliationDraft, { authorizedDeviceId: event.target.value })}
                                                                            placeholder="Device ID autorizado resultante"
                                                                            className="rounded-lg border border-amber-200 bg-white px-3 py-2 font-mono text-xs"
                                                                        />
                                                                        <input
                                                                            value={reconciliationDraft.reason}
                                                                            onChange={(event) => updateReconciliationDraft(terminalKey, reconciliationDraft, { reason: event.target.value })}
                                                                            placeholder="Motivo administrativo obligatorio"
                                                                            className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs"
                                                                        />
                                                                    </div>
                                                                    <label className="mt-2 flex items-center gap-2 text-xs font-semibold">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={reconciliationDraft.adminConfirmed}
                                                                            onChange={(event) => updateReconciliationDraft(terminalKey, reconciliationDraft, { adminConfirmed: event.target.checked })}
                                                                        />
                                                                        Confirmo que revisé tenant, sucursal, terminal, devices y rollback
                                                                    </label>
                                                                    <p className="mt-3 text-xs font-bold">DRY-RUN · escrituras realizadas: no</p>
                                                                    <p className="mt-1 text-xs">Estado: {reconciliationPreview.executable ? 'Plan validable' : 'Bloqueado'}</p>
                                                                    <p className="mt-1 text-xs"><strong>Origen:</strong> registry {terminal.registry?.id || 'N/D'}</p>
                                                                    <p className="mt-1 text-xs"><strong>Destino:</strong> {reconciliationDraft.targetTerminalName || 'N/D'} · {reconciliationDraft.erpTerminalUuid || 'N/D'}</p>
                                                                    <p className="mt-1 text-xs"><strong>Sucursal:</strong> {reconciliationDraft.storeId || 'N/D'}</p>
                                                                    <p className="mt-1 text-xs"><strong>Device resultante:</strong> {reconciliationDraft.authorizedDeviceId || 'N/D'}</p>
                                                                    {reconciliationPreview.blockers.length ? (
                                                                        <ul className="mt-1 list-disc pl-5 text-xs">
                                                                            {reconciliationPreview.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                                                                        </ul>
                                                                    ) : null}
                                                                    <div className="mt-3 flex flex-wrap gap-2">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => void handleTerminalReconciliation(terminal, reconciliationDraft, 'DRY_RUN')}
                                                                            disabled={!reconciliationPreview.executable || isReconciliationSubmitting}
                                                                            className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"
                                                                        >
                                                                            {isReconciliationSubmitting ? 'Validando…' : 'Validar dry-run servidor'}
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => void handleTerminalReconciliation(terminal, reconciliationDraft, 'EXECUTE')}
                                                                            disabled={
                                                                                !reconciliationPreview.executable
                                                                                || isReconciliationSubmitting
                                                                                || reconciliationDraft.serverPreview?.status !== 'dry_run'
                                                                                || !reconciliationDraft.serverPreview.plan_hash
                                                                                || Boolean(serverReconciliationPlan?.destructive_operations?.length)
                                                                            }
                                                                            className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                                                                        >
                                                                            Ejecutar reconciliación
                                                                        </button>
                                                                    </div>
                                                                    {serverReconciliationPlan ? (
                                                                        <div className="mt-3 grid gap-3 rounded-lg border border-amber-200 bg-white p-3 md:grid-cols-2">
                                                                            <div>
                                                                                <p className="font-bold">Devices históricos</p>
                                                                                <p className="font-mono text-xs">{serverReconciliationPlan.historical_device_ids.join(', ') || 'Ninguno'}</p>
                                                                                <p className="mt-2 font-bold">Registros huérfanos afectados</p>
                                                                                <p className="font-mono text-xs break-all">{serverReconciliationPlan.orphan_registry_ids.join(', ') || 'Ninguno'}</p>
                                                                            </div>
                                                                            <div>
                                                                                <p className="font-bold">Plan de escritura</p>
                                                                                <ul className="list-disc pl-4 text-xs">{serverReconciliationPlan.writes.map((item) => <li key={item}>{item}</li>)}</ul>
                                                                                <p className="mt-2 font-bold">Plan de rollback</p>
                                                                                <ul className="list-disc pl-4 text-xs">{serverReconciliationPlan.rollback.map((item) => <li key={item}>{item}</li>)}</ul>
                                                                            </div>
                                                                            <p className="md:col-span-2 font-mono text-[10px] break-all">Plan hash: {reconciliationDraft.serverPreview?.plan_hash}</p>
                                                                        </div>
                                                                    ) : null}
                                                                </details>
                                                            </div>
                                                        ) : null}

                                                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Terminal ERP UUID</p>
                                                                <p className="mt-1 font-mono break-all text-xs">{identity.erpTerminalUuid}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">UUID catálogo Cloud</p>
                                                                <p className="mt-1 font-mono break-all text-xs">{identity.catalogTerminalId}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Terminal code / POS ID</p>
                                                                <p className="mt-1 font-mono break-all">{identity.terminalCode}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Nombre local</p>
                                                                <p className="mt-1 font-bold">{identity.localName}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Estado autorizacion</p>
                                                                <p className="mt-1 font-bold uppercase">{getAuthStatusLabel(effectiveAuthStatus)}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Device autorizado actual</p>
                                                                <p className="mt-1 font-mono break-all">{identity.authorizedDeviceId}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Device actual visto por POS</p>
                                                                <p className="mt-1 font-mono break-all">{identity.posReportedDeviceId}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Device actual en ERP</p>
                                                                <p className={`mt-1 font-mono break-all ${needsErpDeviceRepair ? 'text-red-700' : ''}`}>{identity.erpCurrentDeviceId}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Device registrado en Cloud</p>
                                                                <p className="mt-1 font-mono break-all">{terminal.registry?.device_id || 'N/D'}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Estado de reconciliación</p>
                                                                <p className="mt-1 font-bold uppercase">{identity.identityStatus}</p>
                                                                <p className="mt-1 text-xs opacity-70">Fuente: {identity.bindingSource}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Ultimo device rechazado</p>
                                                                <p className="mt-1 font-mono break-all">{displayRejectedDeviceId}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2 md:col-span-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Devices historicos</p>
                                                                <p className="mt-1 font-mono break-words text-xs">
                                                                    {identity.historicalDeviceIds.length
                                                                        ? identity.historicalDeviceIds.join(' · ')
                                                                        : 'N/D'}
                                                                </p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Ultimo error auth</p>
                                                                <p className="mt-1 font-bold break-words">{displayLastAuthError || 'N/D'}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Ultimo intento</p>
                                                                <p className="mt-1">{formatDateTime(displayLastAuthAttemptAt)}</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    ) : null}

                                                    {activeTerminalTab === 'devices' ? (
                                                    <div>
                                                        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                            <div>
                                                                <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Dispositivos registrados y roles</h5>
                                                                <p className="mt-1 text-xs text-slate-500">Limpia solo autorizaciones de devices de prueba; no borra ventas, maestros, fiscal ni secuencias.</p>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => void handleClearTerminalDevices(terminal)}
                                                                disabled={canonicalActionBlocked || deviceActionSubmittingKey === clearDevicesSubmittingKey}
                                                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-red-700 shadow-sm hover:bg-red-50 transition-colors disabled:opacity-60"
                                                            >
                                                                {deviceActionSubmittingKey === clearDevicesSubmittingKey ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                                                                Limpiar devices
                                                            </button>
                                                        </div>
                                                        {identity.deviceRows.length === 0 ? (
                                                            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
                                                                <p className="text-xs font-bold uppercase tracking-wider text-amber-800">Fallback tecnico: autorizar device reportado</p>
                                                                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                                                                    <input
                                                                        type="text"
                                                                        value={manualDeviceIds[terminalKey] || ''}
                                                                        onChange={(event) => setManualDeviceIds((current) => ({
                                                                            ...current,
                                                                            [terminalKey]: event.target.value.toUpperCase(),
                                                                        }))}
                                                                        placeholder="Device reportado por el POS, ej. DEV-D31OAKBD"
                                                                        className="min-w-0 flex-1 rounded-xl border border-amber-200 bg-white px-3 py-2 font-mono text-sm text-slate-800 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                                                                    />
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => void handleAuthorizeDeviceForManualInput(terminal, manualDeviceIds[terminalKey] || '')}
                                                                        disabled={canonicalActionBlocked || !manualDeviceId || deviceActionSubmittingKey === manualAuthorizeKey}
                                                                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-amber-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                                                                    >
                                                                        {deviceActionSubmittingKey === manualAuthorizeKey ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                                                                        Autorizar device
                                                                    </button>
                                                                </div>
                                                                <p className="mt-2 text-xs text-amber-800">
                                                                    Usar solo si el ERP todavia no reporto el intento rechazado.
                                                                </p>
                                                            </div>
                                                        ) : null}
                                                        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                                                            <table className="w-full text-left text-sm whitespace-nowrap">
                                                                <thead className="text-[10px] uppercase text-slate-400 border-b border-slate-100 bg-slate-50">
                                                                    <tr>
                                                                        <th className="px-4 py-3 font-bold">Roles</th>
                                                                        <th className="px-4 py-3 font-bold">Device ID</th>
                                                                        <th className="px-4 py-3 font-bold">Estado red</th>
                                                                        <th className="px-4 py-3 font-bold">Red / Endpoint</th>
                                                                        <th className="px-4 py-3 font-bold">Version APK</th>
                                                                        <th className="px-4 py-3 font-bold text-right">Ultimo tick</th>
                                                                        <th className="px-4 py-3 font-bold text-right">Acciones</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="divide-y divide-slate-50">
                                                                    {identity.deviceRows.length === 0 ? (
                                                                        <tr>
                                                                            <td colSpan={7} className="px-4 py-6 text-center text-slate-500 text-sm">
                                                                                Sin devices reportados para esta terminal.
                                                                            </td>
                                                                        </tr>
                                                                    ) : identity.deviceRows.map((deviceRow, deviceIndex) => {
                                                                        const registry = (terminal.registries || []).find((reg) => reg.id === deviceRow.registryId) || terminal.registry;
                                                                        const mockTerminal = registry ? { ...terminal, registry } : terminal;
                                                                        const rStatusLabel = registry ? getRegistryStatusLabel(mockTerminal) : 'N/D';
                                                                        const rVersionKey = getApkVersionKey(mockTerminal);
                                                                        const rIsOutOfVersion = Boolean(referenceVersionKey && rVersionKey && rVersionKey !== referenceVersionKey);
                                                                        const rVersionSource = getApkVersionSourceLabel(mockTerminal);
                                                                        const prefLanIp = registry ? getPreferredLanIp(mockTerminal) : 'N/D';
                                                                        const endpointRole = getRegistryEndpointRole(registry);
                                        const canReleaseLicenseSlot = Boolean(
                                            selectedTenantForTerminals?.contracted_product !== 'POS_ERP'
                                            && registry?.id
                                            && rStatusLabel === 'ONLINE'
                                            && !registry.is_revoked
                                            && registry.auth_status !== 'OLD_DEVICE_REVOKED',
                                        );
                                                                        const releaseSubmittingKey = registry?.id
                                                                            ? `${terminalKey}-RELEASE-${deviceRow.deviceId}`
                                                                            : '';
                                                                        const rowDeviceId = deviceRow.deviceId.trim();
                                                                        const authorizeRowKey = rowDeviceId ? `${terminalKey}-TAKEOVER-${rowDeviceId}` : '';
                                                                        const canAuthorizeDeviceRow = canReauthorizeTerminals
                                                                            && Boolean(rowDeviceId)
                                                                            && !deviceRow.roles.includes('AUTHORIZED_CURRENT')
                                                                            && !deviceRow.roles.includes('LICENSE_EXCEEDED');

                                                                        return (
                                                                            <tr key={`${deviceRow.deviceId}-${deviceIndex}`} className={`hover:bg-slate-50 transition-colors ${rIsOutOfVersion ? 'bg-amber-50/20' : ''}`}>
                                                                                <td className="px-4 py-3 align-top">
                                                                                    <div className="flex flex-wrap gap-1 max-w-xs">
                                                                                        {deviceRow.roles.map((role) => (
                                                                                            <span
                                                                                                key={`${deviceRow.deviceId}-${role}`}
                                                                                                className={`px-2 py-0.5 rounded border text-[9px] font-bold uppercase ${getDeviceRoleClasses(role)}`}
                                                                                                title={getDeviceRoleLabel(role)}
                                                                                            >
                                                                                                {role}
                                                                                            </span>
                                                                                        ))}
                                                                                        {!deviceRow.roles.includes(endpointRole) ? (
                                                                                            <span className={`px-2 py-0.5 rounded border text-[9px] font-bold uppercase ${getDeviceRoleClasses(endpointRole)}`}>
                                                                                                {endpointRole}
                                                                                            </span>
                                                                                        ) : null}
                                                                                    </div>
                                                                                    <p className="mt-1 text-[10px] text-slate-400">{deviceRow.source}</p>
                                                                                </td>
                                                                                <td className="px-4 py-3 align-top">
                                                                                    <p className="font-mono font-bold text-slate-700 text-[11px]">{deviceRow.deviceId}</p>
                                                                                    {registry?.hostname ? <p className="text-[10px] text-slate-500">{registry.hostname}</p> : null}
                                                                                </td>
                                                                                <td className="px-4 py-3 align-top">
                                                                                    {registry ? (
                                                                                        <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${getRegistryStatusClassName(rStatusLabel)}`}>
                                                                                            {rStatusLabel}
                                                                                        </span>
                                                                                    ) : (
                                                                                        <span className="text-[10px] text-slate-400">Sin heartbeat</span>
                                                                                    )}
                                                                                </td>
                                                                                <td className="px-4 py-3 align-top">
                                                                                    <p className="font-mono text-emerald-700 font-bold text-[11px]">{prefLanIp}</p>
                                                                                    {registry?.endpoint_url ? (
                                                                                        <p className="text-[10px] text-slate-400 font-mono" title="Endpoint">{registry.endpoint_url}</p>
                                                                                    ) : null}
                                                                                </td>
                                                                                <td className="px-4 py-3 align-top">
                                                                                    {registry ? (
                                                                                        <div className="flex flex-col items-start gap-0.5">
                                                                                            <span className="font-mono text-slate-700 text-[11px]">{formatApkVersion(mockTerminal)}</span>
                                                                                            {rVersionSource ? <span className="text-[10px] text-slate-400 font-bold">Fuente: {rVersionSource}</span> : null}
                                                                                            {rIsOutOfVersion ? <span className="text-[10px] text-amber-600 font-bold">Desfasado</span> : null}
                                                                                        </div>
                                                                                    ) : (
                                                                                        <span className="text-[10px] text-slate-400">N/D</span>
                                                                                    )}
                                                                                </td>
                                                                                <td className="px-4 py-3 align-top text-right">
                                                                                    <p className="text-[10px] text-slate-500">{formatDateTime(deviceRow.lastSeenAt)}</p>
                                                                                </td>
                                                                                <td className="px-4 py-3 align-top text-right">
                                                                                    <div className="flex flex-col items-end gap-1.5">
                                                                                        {canAuthorizeDeviceRow ? (
                                                                                            <button
                                                                                                type="button"
                                                                                                onClick={() => void handleAuthorizeDeviceForManualInput(terminal, rowDeviceId)}
                                                                                                disabled={canonicalActionBlocked || deviceActionSubmittingKey !== null}
                                                                                                title={`Autoriza ${rowDeviceId} para ${terminal.name} y revoca el device activo anterior.`}
                                                                                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-bold uppercase text-emerald-900 hover:bg-emerald-100 transition-colors disabled:opacity-60"
                                                                                            >
                                                                                                {deviceActionSubmittingKey === authorizeRowKey
                                                                                                    ? <Loader2 size={12} className="animate-spin" />
                                                                                                    : <ShieldCheck size={12} />}
                                                                                                Autorizar
                                                                                            </button>
                                                                                        ) : null}
                                                                                        {canReleaseLicenseSlot && registry?.id ? (
                                                                                            <button
                                                                                                type="button"
                                                                                                onClick={() => void handleReleaseTerminalLicenseSlot(
                                                                                                    terminal,
                                                                                                    registry.id,
                                                                                                    deviceRow.deviceId,
                                                                                                )}
                                                                                                disabled={deviceActionSubmittingKey === releaseSubmittingKey}
                                                                                                title={selectedTenantForTerminals?.contracted_product === 'POS_ONLY'
                                                                                    ? 'Libera toda la caja (terminal) para reactivar otro Android'
                                                                                    : 'Libera el cupo de licencia para otro Android'}
                                                                                                className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[10px] font-bold uppercase text-amber-900 hover:bg-amber-100 transition-colors disabled:opacity-60"
                                                                                            >
                                                                                                {deviceActionSubmittingKey === releaseSubmittingKey
                                                                                                    ? <Loader2 size={12} className="animate-spin" />
                                                                                                    : <Unlink size={12} />}
                                                                                                Liberar cupo
                                                                                            </button>
                                                                                        ) : null}
                                                                                        {!canAuthorizeDeviceRow && !(canReleaseLicenseSlot && registry?.id) ? (
                                                                                            <span className="text-[10px] text-slate-400">—</span>
                                                                                        ) : null}
                                                                                    </div>
                                                                                </td>
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </div>
                                                    ) : null}
                                                </div>

                                                {activeTerminalTab === 'attempts' ? (
                                                <div className={`mx-5 rounded-2xl border px-4 py-4 ${authStatusClasses}`}>
                                                    <p className="text-xs font-bold uppercase tracking-wider">Solicitudes de dispositivo</p>
                                                    <div className="mt-3 rounded-xl border border-white/60 bg-white/70 overflow-hidden">
                                                        <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-white/60">
                                                            <div>
                                                                <p className="text-sm font-black text-slate-800">{terminal.name} / {terminal.terminal_code || terminal.terminal_id || 'N/D'}</p>
                                                                <p className="mt-0.5 font-mono text-[10px] text-slate-500">UUID ERP: {getTerminalTakeoverId(terminal) || 'N/D'}</p>
                                                            </div>
                                                            {isAuthAttemptsLoading ? <Loader2 size={15} className="animate-spin" /> : null}
                                                        </div>
                                                        {authAttemptsError ? (
                                                            <div className="px-3 py-4 text-sm text-red-800">
                                                                <p className="font-bold">No se pudieron cargar las solicitudes de dispositivo.</p>
                                                                <p className="mt-1 text-xs">{authAttemptsError}</p>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void loadTerminalAuthAttempts(selectedTenantForTerminals.id, terminal)}
                                                                    disabled={isAuthAttemptsLoading}
                                                                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-800 hover:bg-red-50 disabled:opacity-60"
                                                                >
                                                                    {isAuthAttemptsLoading ? <Loader2 size={13} className="animate-spin" /> : null}
                                                                    Reintentar carga
                                                                </button>
                                                            </div>
                                                        ) : authAttempts.length === 0 ? (
                                                            <div className="px-3 py-4 text-sm opacity-75">
                                                                <p>No hay solicitudes de dispositivo reportadas por el ERP para esta terminal.</p>
                                                            </div>
                                                        ) : (
                                                            <div className="overflow-x-auto">
                                                                <table className="w-full text-left text-xs">
                                                                    <thead className="bg-white/80 uppercase tracking-wider opacity-70">
                                                                        <tr>
                                                                            <th className="px-3 py-2">Dispositivo autorizado</th>
                                                                            <th className="px-3 py-2">Dispositivo solicitante</th>
                                                                            <th className="px-3 py-2">Solicitud</th>
                                                                            <th className="px-3 py-2">Estado</th>
                                                                            <th className="px-3 py-2 text-right">Acciones</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-white/70">
                                                                        {authAttempts.map((attempt, attemptIndex) => {
                                                                            const requestedDeviceId = getAttemptDeviceId(attempt);
                                                                            const attemptStatus = getDeviceRequestStatusLabel(attempt);
                                                                            const canReauthorize = canReauthorizeTerminals
                                                                                && Boolean(attempt.id)
                                                                                && isPendingDeviceUnauthorizedAttempt(attempt);
                                                                            const reauthorizeKey = `${terminalKey}-TAKEOVER-${requestedDeviceId}`;
                                                                            const rejectKey = `${terminalKey}-REJECT-${attempt.id || requestedDeviceId}`;
                                                                            return (
                                                                                <React.Fragment key={attempt.id || `${requestedDeviceId}-${attemptIndex}`}>
                                                                                    <tr>
                                                                                        <td className="px-3 py-2 font-mono">{attempt.authorized_device_id || authorizedDeviceId || 'N/D'}</td>
                                                                                        <td className="px-3 py-2 font-mono font-bold">{requestedDeviceId || 'N/D'}</td>
                                                                                        <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(getAttemptTime(attempt))}</td>
                                                                                        <td className="px-3 py-2 font-bold uppercase">{attemptStatus}</td>
                                                                                        <td className="px-3 py-2 text-right">
                                                                                            {canReauthorize ? (
                                                                                                <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:justify-end">
                                                                                                    <button
                                                                                                        type="button"
                                                                                                        onClick={() => void handleReauthorizeAttempt(terminal, attempt)}
                                                                                                        disabled={canonicalActionBlocked || deviceActionSubmittingKey !== null}
                                                                                                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-red-700 disabled:opacity-60"
                                                                                                    >
                                                                                                        {deviceActionSubmittingKey === reauthorizeKey ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                                                                                                        Autorizar y reemplazar
                                                                                                    </button>
                                                                                                    <button
                                                                                                        type="button"
                                                                                                        onClick={() => void handleRejectDeviceRequest(terminal, attempt)}
                                                                                                        disabled={deviceActionSubmittingKey !== null}
                                                                                                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                                                                                                    >
                                                                                                        {deviceActionSubmittingKey === rejectKey ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
                                                                                                        Rechazar
                                                                                                    </button>
                                                                                                </div>
                                                                                            ) : (
                                                                                                <span className="text-slate-400">Sin accion</span>
                                                                                            )}
                                                                                        </td>
                                                                                    </tr>
                                                                                </React.Fragment>
                                                                            );
                                                                        })}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="mt-4 rounded-xl border border-white/60 bg-white/70 overflow-hidden">
                                                        <div className="px-3 py-2 border-b border-white/60">
                                                            <p className="text-xs font-bold uppercase tracking-wider">Auditoría de reautorización</p>
                                                        </div>
                                                        {deviceAudit.length === 0 ? (
                                                            <p className="px-3 py-4 text-sm opacity-75">No hay operaciones auditadas para esta terminal.</p>
                                                        ) : (
                                                            <div className="overflow-x-auto">
                                                                <table className="w-full text-left text-xs">
                                                                    <thead className="bg-white/80 uppercase tracking-wider opacity-70">
                                                                        <tr>
                                                                            <th className="px-3 py-2">Anterior</th>
                                                                            <th className="px-3 py-2">Nuevo</th>
                                                                            <th className="px-3 py-2">Usuario</th>
                                                                            <th className="px-3 py-2">Fecha</th>
                                                                            <th className="px-3 py-2">Resultado</th>
                                                                            <th className="px-3 py-2">Operación</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-white/70">
                                                                        {deviceAudit.map((entry) => {
                                                                            const operationId = typeof entry.metadata?.operation_id === 'string'
                                                                                ? entry.metadata.operation_id
                                                                                : entry.id;
                                                                            return (
                                                                                <tr key={entry.id}>
                                                                                    <td className="px-3 py-2 font-mono">{entry.old_device_id || 'N/D'}</td>
                                                                                    <td className="px-3 py-2 font-mono font-bold">{entry.new_device_id || 'N/D'}</td>
                                                                                    <td className="px-3 py-2">{entry.performed_by || 'N/D'}</td>
                                                                                    <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(entry.performed_at)}</td>
                                                                                    <td className="px-3 py-2 font-bold">{entry.result || entry.erp_error_code || 'N/D'}</td>
                                                                                    <td className="px-3 py-2 font-mono text-[10px] break-all">{operationId}</td>
                                                                                </tr>
                                                                            );
                                                                        })}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {revokeDeviceId && revokeDeviceId !== authorizedDeviceId ? (
                                                        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-white/60 bg-white/70 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                                                            <div className="text-sm">
                                                                <p className="font-bold">Device anterior detectado</p>
                                                                <p className="font-mono text-xs break-all">{revokeDeviceId}</p>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => void handleRevokePreviousDevice(terminal, revokeDeviceId)}
                                                                disabled={canonicalActionBlocked || deviceActionSubmittingKey === revokeSubmittingKey}
                                                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-60"
                                                            >
                                                                {deviceActionSubmittingKey === revokeSubmittingKey ? <Loader2 size={16} className="animate-spin" /> : <Ban size={16} />}
                                                                Revocar equipo anterior
                                                            </button>
                                                        </div>
                                                    ) : null}
                                                </div>
                                                ) : null}

                                                {activeTerminalTab === 'erp' ? (
                                                <div className={`mx-5 mt-5 rounded-2xl border px-4 py-4 ${getReadinessBadgeClasses(erpReadinessStatus)}`}>
                                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                                        <div>
                                                            <p className="text-xs font-bold uppercase tracking-wider">Preparacion ERP</p>
                                                            <p className="mt-1 text-sm font-bold">{getReadinessLabel(erpReadinessStatus)}</p>
                                                            {erpReadinessStatus !== 'ready' ? (
                                                                <p className="mt-1 text-sm">
                                                                    POS vinculado, pero el contexto ERP aun no esta listo.
                                                                </p>
                                                            ) : null}
                                                            {profileIncomplete ? (
                                                                <p className="mt-2 rounded-xl border border-amber-200 bg-white/80 px-3 py-2 text-sm font-semibold text-amber-800">
                                                                    Perfil ERP de terminal incompleto. Los documentos pueden quedar pendientes hasta preparar la terminal.
                                                                </p>
                                                            ) : null}
                                                        </div>
                                                        <div className="flex flex-col gap-2 sm:flex-row">
                                                            {profileIncomplete ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void handlePrepareErpProfile(terminal)}
                                                                    disabled={isReadinessSubmitting}
                                                                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-amber-700 transition-colors disabled:opacity-60"
                                                                >
                                                                    {isReadinessSubmitting ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                                                                    Preparar perfil ERP
                                                                </button>
                                                            ) : null}
                                                            <button
                                                                type="button"
                                                                onClick={() => void handleRetryErpReadiness(terminal)}
                                                                disabled={isReadinessSubmitting}
                                                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-current bg-white/80 px-4 py-2 text-sm font-bold shadow-sm hover:bg-white transition-colors disabled:opacity-60"
                                                            >
                                                                {isReadinessSubmitting ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
                                                                Reintentar preparacion ERP
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 text-sm">
                                                        <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                            <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">ERP tenant</p>
                                                            <p className="mt-1 font-mono break-all">{erpTenantId || 'No vinculado'}</p>
                                                        </div>
                                                        <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                            <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Tenant</p>
                                                            <p className="mt-1 font-bold">{getCheckLabel(tenantReady, 'OK', 'Faltante')}</p>
                                                        </div>
                                                        <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                            <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Compania</p>
                                                            <p className="mt-1 font-bold">{getCheckLabel(companyReady, 'OK', 'Faltante')}</p>
                                                        </div>
                                                        <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                            <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Sucursal</p>
                                                            <p className="mt-1 font-bold">{getCheckLabel(storeReady, 'OK', 'Faltante')}</p>
                                                        </div>
                                                        <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                            <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Terminal ERP</p>
                                                            <p className="mt-1 font-bold">{getCheckLabel(terminalReady, 'OK', 'Faltante')}</p>
                                                        </div>
                                                        <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                            <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Terminal profile</p>
                                                            <p className="mt-1 font-bold uppercase">{profileStatus}</p>
                                                        </div>
                                                        <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                            <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Perfil</p>
                                                            <p className="mt-1 font-bold">{getCheckLabel(profileReady, 'OK', 'DRAFT / faltante')}</p>
                                                        </div>
                                                        <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                            <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Impuestos</p>
                                                            <p className="mt-1 font-bold">{getCheckLabel(taxesReady, 'OK', 'Faltante')}</p>
                                                        </div>
                                                        <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                            <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Metodos de pago</p>
                                                            <p className="mt-1 font-bold">{getCheckLabel(paymentMethodsReady, 'OK', 'Faltante')}</p>
                                                        </div>
                                                        <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                            <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Almacenes</p>
                                                            <p className="mt-1 font-bold">{getCheckLabel(warehousesReady, 'OK', 'Faltante')}</p>
                                                        </div>
                                                        <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                            <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Secuencias</p>
                                                            <p className="mt-1 font-bold">{getCheckLabel(documentSeriesReady, 'Disponibles', 'Faltantes')}</p>
                                                        </div>
                                                        <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                            <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Articulos</p>
                                                            <p className="mt-1 font-bold">{getCheckLabel(itemsReady, 'Disponibles', 'Vacio / faltante')}</p>
                                                        </div>
                                                        <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2 md:col-span-2">
                                                            <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Ultimo evento sync</p>
                                                            <p className="mt-1">
                                                                {lastSyncAt ? formatDateTime(lastSyncAt) : 'N/D'}
                                                                {lastSyncType ? <span className="font-mono"> · {lastSyncType}</span> : null}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    {erpReadiness?.checked_at ? (
                                                        <p className="mt-3 text-xs opacity-75">
                                                            Ultima validacion ERP: {formatDateTime(erpReadiness.checked_at)}
                                                        </p>
                                                    ) : null}
                                                </div>
                                                ) : null}

                                                {activeTerminalTab === 'sync' ? (
                                                    <div className="mt-5 rounded-2xl border border-slate-200 bg-white px-4 py-4">
                                                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                                            <div>
                                                                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Centro de Sincronizacion</p>
                                                                <p className="mt-1 text-sm text-slate-600">
                                                                    Pendientes de esta terminal, con reparacion guiada cuando el ERP reporte ERP_CONTEXT_MISSING.
                                                                </p>
                                                                {syncPending.message ? (
                                                                    <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{syncPending.message}</p>
                                                                ) : null}
                                                                {profileIncomplete ? (
                                                                    <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                                                                        Terminal sin perfil ERP listo. No se permite reintento masivo hasta preparar el perfil.
                                                                    </p>
                                                                ) : null}
                                                            </div>
                                                            <div className="flex flex-col gap-2 sm:flex-row">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void loadTerminalSyncPending(selectedTenantForTerminals.id, terminal)}
                                                                    disabled={isSyncLoading}
                                                                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-60"
                                                                >
                                                                    {isSyncLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
                                                                    Actualizar pendientes
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void handleRetryTerminalPending(terminal)}
                                                                    disabled={profileIncomplete || syncBulkSubmitting || repairableSyncCount === 0}
                                                                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                                                                >
                                                                    {syncBulkSubmitting ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
                                                                    Reintentar pendientes de esta terminal
                                                                </button>
                                                            </div>
                                                        </div>

                                                        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                                                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Documentos pendientes</p>
                                                                <p className="mt-1 text-2xl font-black text-slate-800">{syncPending.summary.pending}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-600">Reparables</p>
                                                                <p className="mt-1 text-2xl font-black text-amber-800">{repairableSyncCount}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider text-red-600">Error funcional</p>
                                                                <p className="mt-1 text-2xl font-black text-red-800">{functionalSyncErrorCount}</p>
                                                            </div>
                                                        </div>

                                                        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
                                                            <table className="min-w-full divide-y divide-slate-100 text-sm">
                                                                <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                                                    <tr>
                                                                        <th className="px-4 py-3">Documento</th>
                                                                        <th className="px-4 py-3">Fecha</th>
                                                                        <th className="px-4 py-3">Causa</th>
                                                                        <th className="px-4 py-3">Estado</th>
                                                                        <th className="px-4 py-3 text-right">Accion</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="divide-y divide-slate-100 bg-white">
                                                                    {syncPending.documents.length ? syncPending.documents.map((document, index) => {
                                                                        const documentId = getSyncDocumentId(document);
                                                                        const documentKey = documentId || `${getSyncDocumentFolio(document)}-${index}`;
                                                                        const errorCode = getSyncDocumentErrorCode(document);
                                                                        const repairable = isRepairableSyncDocument(document, erpReadiness);
                                                                        const submittingDocument = syncRetrySubmittingKey === `${terminalKey}-${documentId}`;
                                                                        return (
                                                                            <tr key={documentKey}>
                                                                                <td className="px-4 py-3 font-mono font-bold text-slate-700">{getSyncDocumentFolio(document)}</td>
                                                                                <td className="px-4 py-3 text-slate-500">{formatDateTime(getSyncDocumentCreatedAt(document))}</td>
                                                                                <td className="px-4 py-3">
                                                                                    <span className={`rounded-full px-2 py-1 text-[11px] font-bold uppercase ${
                                                                                        repairable ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                                                                                    }`}>
                                                                                        {repairable ? 'Terminal sin perfil ERP listo' : errorCode || 'Pendiente'}
                                                                                    </span>
                                                                                    {document.message ? <p className="mt-1 text-xs text-slate-500">{document.message}</p> : null}
                                                                                </td>
                                                                                <td className="px-4 py-3 text-slate-600">{document.status || 'Pendiente'}</td>
                                                                                <td className="px-4 py-3 text-right">
                                                                                    {repairable ? (
                                                                                        <button
                                                                                            type="button"
                                                                                            onClick={() => void handlePrepareAndRetryDocument(terminal, document)}
                                                                                            disabled={submittingDocument || !documentId}
                                                                                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-amber-700 transition-colors disabled:opacity-60"
                                                                                        >
                                                                                            {submittingDocument ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                                                                                            Preparar terminal y reenviar
                                                                                        </button>
                                                                                    ) : (
                                                                                        <span className="text-xs text-slate-400">Sin accion</span>
                                                                                    )}
                                                                                </td>
                                                                            </tr>
                                                                        );
                                                                    }) : (
                                                                        <tr>
                                                                            <td colSpan={5} className="px-4 py-8 text-center text-sm font-semibold text-slate-400">
                                                                                {isSyncLoading ? 'Cargando pendientes...' : 'No hay documentos pendientes reportados.'}
                                                                            </td>
                                                                        </tr>
                                                                    )}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </div>
                                                ) : null}

                                                {activeTerminalTab === 'fiscal' && isFiscalEligibleTenant(selectedTenantForTerminals) ? (
                                                    <div className={`mx-5 mt-5 rounded-2xl border px-4 py-4 ${fiscalStatusClasses}`}>
                                                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                                            <div>
                                                                <p className="text-xs font-bold uppercase tracking-wider">Configuracion fiscal</p>
                                                                <p className="mt-1 text-sm font-bold">{fiscalDebug.fiscalReadiness}</p>
                                                                <p className="mt-1 text-xs opacity-80">
                                                                    Solo lectura. La configuracion fiscal se mantiene y corrige en ERP.
                                                                </p>
                                                                {fiscalDebug.isMissing || fiscalDebug.errorCode === 'FISCAL_CONFIG_MISSING' ? (
                                                                    <p className="mt-2 text-sm font-semibold">
                                                                        FISCAL_CONFIG_MISSING: revisa donde busco ERP, que encontro y que falta antes de escalar a soporte.
                                                                    </p>
                                                                ) : null}
                                                                {fiscalDebug.message ? (
                                                                    <p className="mt-1 text-sm">{fiscalDebug.message}</p>
                                                                ) : null}
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => void loadTerminalFiscalReadiness(selectedTenantForTerminals.id, terminal)}
                                                                disabled={isFiscalLoading}
                                                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-current bg-white/80 px-4 py-2 text-sm font-bold shadow-sm hover:bg-white transition-colors disabled:opacity-60"
                                                            >
                                                                {isFiscalLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
                                                                Verificar mapping fiscal
                                                            </button>
                                                        </div>

                                                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">fiscalReadiness</p>
                                                                <p className="mt-1 font-bold">{fiscalDebug.fiscalReadiness}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">matchedStrategy</p>
                                                                <p className="mt-1 font-mono text-xs break-all">{fiscalDebug.matchedStrategy || 'N/D'}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">documentSeriesFound</p>
                                                                <p className="mt-1 font-bold">{getCheckLabel(fiscalDebug.documentSeriesFound, 'Si', 'No')}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">fiscalRangesFound</p>
                                                                <p className="mt-1 font-bold">{getCheckLabel(fiscalDebug.fiscalRangesFound, 'Si', 'No')}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">fiscalSequencesFound</p>
                                                                <p className="mt-1 font-bold">{getCheckLabel(fiscalDebug.fiscalSequencesFound, 'Si', 'No')}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">terminalFiscalConfigFound</p>
                                                                <p className="mt-1 font-bold">{getCheckLabel(fiscalDebug.terminalFiscalConfigFound, 'Si', 'No')}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2 md:col-span-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">missing</p>
                                                                <p className="mt-1 break-words text-xs">{fiscalDebug.missing.length ? fiscalDebug.missing.join(' · ') : 'N/D'}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2 md:col-span-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Donde busco (ERP)</p>
                                                                <p className="mt-1 break-words text-xs">{fiscalDebug.searchedIn.length ? fiscalDebug.searchedIn.join(' → ') : 'N/D'}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2 md:col-span-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Que encontro</p>
                                                                <p className="mt-1 break-words text-xs">{fiscalDebug.found.length ? fiscalDebug.found.join(' · ') : 'N/D'}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2 md:col-span-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Scopes disponibles (sucursal / company / tenant)</p>
                                                                <p className="mt-1 break-words text-xs">{fiscalDebug.scopeHints.length ? fiscalDebug.scopeHints.join(' · ') : 'N/D'}</p>
                                                            </div>
                                                            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                                                                <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Ultima validacion</p>
                                                                <p className="mt-1">{formatDateTime(fiscalDebug.checkedAt)}</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : null}

                                                {activeTerminalTab === 'summary' && isLocalPosTenant(selectedTenantForTerminals) ? (
                                                    <div className={`mx-5 mt-5 rounded-2xl border px-4 py-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between ${
                                                        isExplicitOfflinePosTenant(selectedTenantForTerminals)
                                                            ? 'border-slate-200 bg-slate-50'
                                                            : 'border-amber-200 bg-amber-50'
                                                    }`}>
                                                        <div>
                                                            <p className={`text-xs font-bold uppercase tracking-wider ${
                                                                isExplicitOfflinePosTenant(selectedTenantForTerminals) ? 'text-slate-600' : 'text-amber-700'
                                                            }`}>Recuperacion POS local</p>
                                                            <p className={`mt-1 text-sm ${
                                                                isExplicitOfflinePosTenant(selectedTenantForTerminals) ? 'text-slate-600' : 'text-amber-800'
                                                            }`}>
                                                                {isExplicitOfflinePosTenant(selectedTenantForTerminals)
                                                                    ? 'Modo offline explícito: la recuperación cloud no está disponible desde ALFA-Admin.'
                                                                    : 'Elige reemplazo de hardware o reconstruccion de BD local sin cambiar el dispositivo.'}
                                                            </p>
                                                        </div>
                                                        <div className="flex flex-col gap-2 sm:flex-row">
                                                            <button
                                                                type="button"
                                                                disabled={isExplicitOfflinePosTenant(selectedTenantForTerminals)}
                                                                onClick={() => openRebuildModal(terminal)}
                                                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-bold text-amber-700 shadow-sm hover:bg-amber-100 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                                                            >
                                                                <RefreshCcw size={16} />
                                                                Reconstruir base local
                                                            </button>
                                                            <button
                                                                type="button"
                                                                disabled={isExplicitOfflinePosTenant(selectedTenantForTerminals)}
                                                                onClick={() => openTakeoverModal(terminal)}
                                                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-amber-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                                                            >
                                                                <RefreshCcw size={16} />
                                                                Reemplazar tablet
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {isRebuildModalOpen && selectedTenantForTerminals && rebuildTerminal && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-start bg-slate-50">
                            <div>
                                <div className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-blue-700">
                                    <RefreshCcw size={14} />
                                    Rebuild local
                                </div>
                                <h3 className="mt-3 font-black text-lg text-slate-800">Reconstruir base local del POS</h3>
                                <p className="text-sm text-slate-500 mt-1">
                                    Para la misma tablet cuando se corrompe la BD local. No cambia el device_id.
                                </p>
                            </div>
                            <button type="button" onClick={closeRebuildModal} className="text-slate-400 hover:text-slate-700 transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleTerminalLocalRebuild} className="p-6 space-y-5">
                            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                                <p className="font-bold">Antes de continuar:</p>
                                <ul className="mt-2 list-disc space-y-1 pl-5">
                                    <li>Se mantiene el mismo device_id autorizado.</li>
                                    <li>No se revoca la tablet actual.</li>
                                    <li>El POS debera descargar un bootstrap completo desde el ERP.</li>
                                    <li>Si habia ventas locales no sincronizadas, deben auditarse antes de reconstruir.</li>
                                </ul>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="rounded-2xl bg-slate-50 px-4 py-3 border border-slate-100">
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Terminal</p>
                                    <p className="mt-1 font-bold text-slate-800">{rebuildTerminal.name}</p>
                                    <p className="mt-1 text-xs font-mono text-slate-500">{getTerminalTakeoverId(rebuildTerminal) || 'N/D'}</p>
                                </div>
                                <div className="rounded-2xl bg-slate-50 px-4 py-3 border border-slate-100">
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Device actual</p>
                                    <p className="mt-1 font-mono text-slate-700 break-all">{getTerminalOperationalDeviceId(rebuildTerminal) || 'N/D'}</p>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Motivo de la reconstruccion <span className="text-red-500">*</span></label>
                                <textarea
                                    required
                                    value={rebuildFormData.reason}
                                    onChange={e => setRebuildFormData({ ...rebuildFormData, reason: e.target.value })}
                                    className="w-full min-h-[96px] px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800 resize-y"
                                    placeholder="Ej. BD local corrupta, reinstalacion del POS en la misma tablet o reparacion de datos locales."
                                />
                            </div>

                            <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                                <input
                                    type="checkbox"
                                    checked={rebuildFormData.confirmRebuild}
                                    onChange={e => setRebuildFormData({ ...rebuildFormData, confirmRebuild: e.target.checked })}
                                    className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span>
                                    Confirmo que es la misma tablet y deseo forzar un bootstrap completo sin revocar el dispositivo actual.
                                </span>
                            </label>

                            <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 border-t border-slate-100 pt-5">
                                <button
                                    type="button"
                                    onClick={closeRebuildModal}
                                    className="px-5 py-3 rounded-xl border border-slate-200 text-slate-700 font-bold hover:bg-slate-50 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={isRebuildSubmitting}
                                    className="px-5 py-3 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                                >
                                    {isRebuildSubmitting ? <Loader2 className="animate-spin" size={18} /> : <RefreshCcw size={18} />}
                                    Preparar reconstruccion
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {isTakeoverModalOpen && selectedTenantForTerminals && takeoverTerminal && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-start bg-slate-50">
                            <div>
                                <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-700">
                                    <RefreshCcw size={14} />
                                    Disaster Recovery
                                </div>
                                <h3 className="mt-3 font-black text-lg text-slate-800">Tomar control de terminal</h3>
                                <p className="text-sm text-slate-500 mt-1">
                                    Solo disponible para POS local. POS + ERP mantiene su flujo actual.
                                </p>
                            </div>
                            <button type="button" onClick={closeTakeoverModal} className="text-slate-400 hover:text-slate-700 transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleTerminalTakeover} className="p-6 space-y-5">
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                <p className="font-bold">Antes de continuar:</p>
                                <ul className="mt-2 list-disc space-y-1 pl-5">
                                    <li>La tablet anterior quedara revocada.</li>
                                    <li>La nueva tablet debera autenticarse de nuevo contra el ERP.</li>
                                    <li>No se borran ventas historicas.</li>
                                    <li>El POS anterior ya no podra sincronizar.</li>
                                </ul>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Terminal a recuperar <span className="text-red-500">*</span></label>
                                <select
                                    required
                                    value={getTakeoverSelectionKey(takeoverFormData.terminalId, takeoverFormData.registryId)}
                                    onChange={e => handleTakeoverTerminalChange(e.target.value)}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all text-slate-800"
                                >
                                    {getTakeoverOptions().map((option) => (
                                        <option key={option.key} value={option.key}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                                <p className="mt-2 text-xs text-slate-500">
                                    Device POS reportado: <span className="font-mono">{getTerminalPosReportedDeviceId(takeoverTerminal) || 'N/D'}</span>
                                    {' · '}
                                    Autorizado: <span className="font-mono">{getTerminalAuthorizedDeviceId(takeoverTerminal) || 'N/D'}</span>
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Nuevo device_id <span className="text-red-500">*</span></label>
                                    <input
                                        required
                                        type="text"
                                        value={takeoverFormData.newDeviceId}
                                        onChange={e => setTakeoverFormData({ ...takeoverFormData, newDeviceId: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all text-slate-800 font-mono"
                                        placeholder="nuevo-device-id"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Nombre de dispositivo</label>
                                    <input
                                        type="text"
                                        value={takeoverFormData.deviceName}
                                        onChange={e => setTakeoverFormData({ ...takeoverFormData, deviceName: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all text-slate-800"
                                        placeholder="Tablet Caja 1"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Motivo del cambio <span className="text-red-500">*</span></label>
                                <textarea
                                    required
                                    value={takeoverFormData.reason}
                                    onChange={e => setTakeoverFormData({ ...takeoverFormData, reason: e.target.value })}
                                    className="w-full min-h-[96px] px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all text-slate-800 resize-y"
                                    placeholder="Ej. Tablet danada, perdida o reemplazo por garantia."
                                />
                            </div>

                            <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                                <input
                                    type="checkbox"
                                    checked={takeoverFormData.confirmTakeover}
                                    onChange={e => setTakeoverFormData({ ...takeoverFormData, confirmTakeover: e.target.checked })}
                                    className="mt-1 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                                />
                                <span>
                                    Confirmo que deseo revocar la tablet anterior y que la nueva tablet debera iniciar sesion/autenticarse de nuevo.
                                </span>
                            </label>

                            <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 border-t border-slate-100 pt-5">
                                <button
                                    type="button"
                                    onClick={closeTakeoverModal}
                                    className="px-5 py-3 rounded-xl border border-slate-200 text-slate-700 font-bold hover:bg-slate-50 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={isTakeoverSubmitting}
                                    className="px-5 py-3 rounded-xl bg-amber-600 text-white font-bold hover:bg-amber-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                                >
                                    {isTakeoverSubmitting ? <Loader2 className="animate-spin" size={18} /> : <RefreshCcw size={18} />}
                                    Ejecutar recuperacion
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {isEditModalOpen && editingTenant && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <h3 className="font-black text-lg text-slate-800">Editar Empresa</h3>
                            <button type="button" onClick={closeEditModal} className="text-slate-400 hover:text-slate-700 transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleUpdateTenant} className="p-6 space-y-5">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Nombre Comercial <span className="text-red-500">*</span></label>
                                <input
                                    required
                                    type="text"
                                    value={editFormData.name}
                                    onChange={e => setEditFormData({ ...editFormData, name: e.target.value })}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Razón Social</label>
                                <input
                                    type="text"
                                    value={editFormData.legalName}
                                    onChange={e => setEditFormData({ ...editFormData, legalName: e.target.value })}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                    placeholder="Opcional"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">RNC / Cédula</label>
                                    <input
                                        type="text"
                                        value={editFormData.taxId}
                                        onChange={e => setEditFormData({ ...editFormData, taxId: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                        placeholder="Opcional"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Teléfono</label>
                                    <input
                                        type="text"
                                        value={editFormData.phone}
                                        onChange={e => setEditFormData({ ...editFormData, phone: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                        placeholder="Opcional"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Email de Acceso</label>
                                    <input
                                        type="email"
                                        value={editFormData.email}
                                        onChange={e => setEditFormData({ ...editFormData, email: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                        placeholder="admin@empresa.com"
                                    />
                                    <p className="text-[10px] text-slate-500 mt-1">Sincroniza con Supabase Auth.</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Nueva Contraseña</label>
                                    <input
                                        type="password"
                                        value={editFormData.password}
                                        onChange={e => setEditFormData({ ...editFormData, password: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                        placeholder="Dejar vacío para no cambiar"
                                    />
                                    <p className="text-[10px] text-slate-500 mt-1">Fuerza el cambio en el próximo acceso.</p>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <p className="text-sm font-black text-slate-800">Productos Activos</p>
                                        <p className="text-xs text-slate-500 mt-1">Activa o desactiva productos del tenant sin mezclarlo con los datos de empresa.</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={openEditProductsModal}
                                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 text-sm font-bold text-slate-700 hover:border-blue-200 hover:text-blue-700 transition-colors"
                                    >
                                        <Boxes size={16} />
                                        Gestionar Productos
                                    </button>
                                </div>
                                <div className="mt-4">
                                    {renderProductSummary(editFormData.products)}
                                </div>
                                {canViewErpModules && editingTenant ? (
                                    <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="flex items-start gap-3">
                                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700"><Puzzle size={19} /></span>
                                            <div>
                                                <p className="text-sm font-black text-slate-800">Módulos y licencias ERP</p>
                                                <p className="mt-1 text-xs text-slate-500">
                                                    {editingTenantHasActiveErp
                                                        ? 'Administra RRHH, Nómina, Contabilidad e integraciones adicionales.'
                                                        : 'Activa ALFA-RMS y guarda el tenant para habilitar módulos adicionales.'}
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setModuleStoreTenant(editingTenant)}
                                            disabled={!editingTenantHasActiveErp}
                                            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                                        >
                                            <Puzzle size={16} />
                                            {typeof activeModuleCounts[editingTenant.id] === 'number'
                                                ? `Módulos ERP · ${activeModuleCounts[editingTenant.id]} activos`
                                                : 'Abrir módulos ERP'}
                                        </button>
                                    </div>
                                ) : null}
                            </div>

                            <div className="pt-4 flex gap-3">
                                <button
                                    type="button"
                                    onClick={closeEditModal}
                                    className="flex-1 px-4 py-3 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={isEditSubmitting}
                                    className="flex-1 px-4 py-3 text-white bg-blue-600 hover:bg-blue-700 rounded-xl font-bold shadow-sm transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
                                >
                                    {isEditSubmitting ? <><Loader2 size={18} className="animate-spin" /> Guardando...</> : 'Guardar Cambios'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <TenantProductsModal
                key={`create-products-${createProductsModalVersion}`}
                isOpen={isCreateProductsModalOpen}
                title="Productos Iniciales del Tenant"
                initialProducts={formData.products}
                onClose={() => setIsCreateProductsModalOpen(false)}
                onSave={(products) => {
                    setFormData((current) => ({ ...current, products: normalizeTenantProductSelection(products) }));
                    setIsCreateProductsModalOpen(false);
                }}
            />

            <TenantProductsModal
                key={`edit-products-${editingTenant?.id ?? 'none'}-${editProductsModalVersion}`}
                isOpen={isEditProductsModalOpen}
                title="Administrar Productos del Tenant"
                tenantName={editingTenant?.name}
                initialProducts={editFormData.products}
                onClose={() => setIsEditProductsModalOpen(false)}
                onSave={(products) => {
                    setEditFormData((current) => ({ ...current, products: normalizeTenantProductSelection(products) }));
                    setIsEditProductsModalOpen(false);
                }}
            />

            {moduleStoreTenant ? (
                <ErpModuleStoreModal
                    isOpen
                    tenantId={moduleStoreTenant.id}
                    tenantName={moduleStoreTenant.name}
                    canManage={canManageErpModules}
                    onClose={() => setModuleStoreTenant(null)}
                    onSaved={(activeModules) => setActiveModuleCounts((current) => ({
                        ...current,
                        [moduleStoreTenant.id]: activeModules,
                    }))}
                />
            ) : null}
        </div>
    );
};
