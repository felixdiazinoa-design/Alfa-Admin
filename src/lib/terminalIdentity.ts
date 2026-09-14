import type { TerminalAuthAttempt, TerminalFiscalReadiness, TenantTerminalRegistryEntry, TenantTerminalSnapshot } from '../types';

export type TerminalDeviceRole =
    | 'AUTHORIZED_CURRENT'
    | 'REPORTED'
    | 'SUPERSEDED'
    | 'ORPHANED'
    | 'HISTORICAL'
    | 'REVOKED'
    | 'REJECTED_RECENT'
    | 'LICENSE_EXCEEDED'
    | 'SERVER_MASTER'
    | 'CLIENT_ENDPOINT';

export interface TerminalDeviceIdentityRow {
    deviceId: string;
    roles: TerminalDeviceRole[];
    registryId?: string | null;
    hostname?: string | null;
    lastSeenAt?: string | null;
    source: string;
}

export interface TerminalIdentitySummary {
    erpTerminalUuid: string;
    catalogTerminalId: string;
    terminalCode: string;
    localName: string;
    authorizedDeviceId: string;
    posReportedDeviceId: string;
    erpCurrentDeviceId: string;
    lastRejectedDeviceId: string;
    authStatus: string;
    historicalDeviceIds: string[];
    deviceRows: TerminalDeviceIdentityRow[];
    mismatchWarning: string | null;
    identityStatus: string;
    bindingSource: string;
    hasCanonicalErpBinding: boolean;
    reconciliationWarning: string | null;
}

export const CANONICAL_ERP_IDENTITY_REQUIRED_MESSAGE = 'Debe reconciliarse esta identidad con una terminal ERP antes de modificar la autorización.';
export const UNVERIFIED_CATALOG_IDENTITY_MESSAGE = 'Registro de catálogo sin vínculo ERP comprobado';

export interface TerminalFiscalDebugSummary {
    fiscalReadiness: string;
    matchedStrategy: string | null;
    documentSeriesFound: boolean | null;
    fiscalRangesFound: boolean | null;
    fiscalSequencesFound: boolean | null;
    terminalFiscalConfigFound: boolean | null;
    missing: string[];
    searchedIn: string[];
    found: string[];
    scopeHints: string[];
    isMissing: boolean;
    errorCode: string | null;
    message: string | null;
    checkedAt: string | null;
    raw: TerminalFiscalReadiness | null;
}

function normalizeDeviceId(value: unknown): string {
    return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function isUuidLike(value: unknown): boolean {
    return typeof value === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function firstHumanLabel(...values: Array<string | null | undefined>): string {
    for (const value of values) {
        const text = value?.trim();
        if (text && !isUuidLike(text)) return text;
    }
    return 'Terminal sin nombre';
}

function uniqueDeviceIds(values: string[]): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const value of values) {
        const normalized = normalizeDeviceId(value);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        output.push(value.trim());
    }
    return output;
}

function readTruthy(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value > 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', 'yes', 'si', 'ready', 'found', 'ok', 'active', '1'].includes(normalized)) return true;
        if (['false', 'no', 'missing', 'inactive', '0'].includes(normalized)) return false;
    }
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const count = record.count ?? record.total ?? record.length;
        if (typeof count === 'number') return count > 0;
        const ready = record.ready ?? record.exists ?? record.found ?? record.available;
        if (typeof ready === 'boolean') return ready;
    }
    return null;
}

function readStringList(value: unknown): string[] {
    if (!value) return [];
    if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
    if (Array.isArray(value)) {
        return value
            .map((item) => {
                if (typeof item === 'string') return item.trim();
                if (item && typeof item === 'object') {
                    const record = item as Record<string, unknown>;
                    const label = record.label ?? record.name ?? record.code ?? record.path ?? record.scope;
                    return typeof label === 'string' ? label.trim() : '';
                }
                return '';
            })
            .filter(Boolean);
    }
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return Object.entries(record)
            .filter(([, item]) => readTruthy(item) === true)
            .map(([key]) => key);
    }
    return [];
}

function readField(readiness: TerminalFiscalReadiness | null | undefined, keys: string[]): unknown {
    if (!readiness) return null;
    for (const key of keys) {
        if (key in readiness) return readiness[key];
    }
    return null;
}

export function getTerminalPersistedAuthorizedDeviceId(terminal: TenantTerminalSnapshot): string {
    return terminal.registry?.authorized_device_id?.trim() || '';
}

/** Effective device Cloud-Admin / ERP usan para autorizar (incluye fallback de registry). */
export function getTerminalAuthorizedDeviceId(terminal: TenantTerminalSnapshot): string {
    const erpDevice = getErpCurrentDeviceId(terminal);
    if (erpDevice) return erpDevice;
    const persisted = getTerminalPersistedAuthorizedDeviceId(terminal);
    if (persisted) return persisted;
    const explicitlyAuthorized = (terminal.registries || []).filter((registry) => (
        ['AUTHORIZED', 'TAKEOVER_COMPLETED', 'REAUTH_COMPLETED'].includes((registry.auth_status || '').toUpperCase())
        && Boolean(registry.authorized_device_id?.trim() || registry.current_device_id?.trim() || registry.device_id?.trim())
    ));
    if (explicitlyAuthorized.length !== 1) return '';
    return explicitlyAuthorized[0].authorized_device_id?.trim()
        || explicitlyAuthorized[0].current_device_id?.trim()
        || explicitlyAuthorized[0].device_id?.trim()
        || '';
}

export function getTerminalPosReportedDeviceId(terminal: TenantTerminalSnapshot): string {
    const registry = terminal.registry;
    if (!registry) return '';
    return registry.current_device_id?.trim()
        || registry.device_id?.trim()
        || '';
}

export function getErpCurrentDeviceId(terminal: TenantTerminalSnapshot): string {
    return terminal.erp_current_device_id?.trim() || '';
}

export function getTerminalPosCode(terminal: TenantTerminalSnapshot): string {
    const candidates = [terminal.terminal_code, terminal.terminal_id, terminal.registry?.terminal_id];
    return candidates.find((value) => value?.trim() && !isUuidLike(value))?.trim() || '';
}

export function getErpTerminalUuid(terminal: TenantTerminalSnapshot): string {
    const value = terminal.erp_terminal_uuid?.trim() || '';
    return isUuidLike(value) ? value : '';
}

export function hasCanonicalErpBinding(terminal: TenantTerminalSnapshot): boolean {
    return Boolean(getErpTerminalUuid(terminal) && terminal.erp_store_id?.trim());
}

export function getCanonicalIdentityBlockingMessage(terminal: TenantTerminalSnapshot): string | null {
    return hasCanonicalErpBinding(terminal) ? null : CANONICAL_ERP_IDENTITY_REQUIRED_MESSAGE;
}

export function getAttemptDeviceId(attempt: TerminalAuthAttempt): string {
    return attempt.requested_device_id?.trim()
        || attempt.request_device_id?.trim()
        || attempt.device_id?.trim()
        || attempt.deviceId?.trim()
        || '';
}

export function isPendingDeviceUnauthorizedAttempt(attempt: TerminalAuthAttempt): boolean {
    const reason = (attempt.reason || '').toUpperCase();
    const status = (attempt.resolution_status || attempt.status || '').toUpperCase();
    return status === 'PENDING'
        || (!status && ['DEVICE_NOT_AUTHORIZED', 'DEVICE_SUPERSEDED', 'TAKEOVER_REQUIRED'].includes(reason));
}

export function getTerminalLastRejectedDeviceId(
    terminal: TenantTerminalSnapshot,
    attempts: TerminalAuthAttempt[] = [],
): string {
    const fromRegistry = terminal.registry?.last_rejected_device_id?.trim() || '';
    if (fromRegistry) return fromRegistry;
    const pendingAttempt = attempts.find(isPendingDeviceUnauthorizedAttempt);
    return pendingAttempt ? getAttemptDeviceId(pendingAttempt) : '';
}

export function getTerminalAuthStatus(
    terminal: TenantTerminalSnapshot,
    attempts: TerminalAuthAttempt[] = [],
): string {
    const registryStatus = (terminal.registry?.auth_status || '').toUpperCase();
    if (registryStatus) return registryStatus;
    if (getTerminalLastRejectedDeviceId(terminal, attempts)) return 'DEVICE_MISMATCH';
    return 'AUTHORIZED';
}

export function getDeviceRoleLabel(role: TerminalDeviceRole): string {
    switch (role) {
        case 'AUTHORIZED_CURRENT': return 'Autorizado actual';
        case 'REPORTED': return 'Reportado por POS';
        case 'SUPERSEDED': return 'Reemplazado';
        case 'ORPHANED': return 'Huérfano';
        case 'HISTORICAL': return 'Historico';
        case 'REVOKED': return 'Revocado';
        case 'REJECTED_RECENT': return 'Rechazado reciente';
        case 'SERVER_MASTER': return 'Server master';
        case 'CLIENT_ENDPOINT': return 'Cliente endpoint';
        case 'LICENSE_EXCEEDED': return 'Sin licencia';
        default: return role;
    }
}

export function getDeviceRoleClasses(role: TerminalDeviceRole): string {
    switch (role) {
        case 'AUTHORIZED_CURRENT': return 'border-emerald-200 bg-emerald-50 text-emerald-700';
        case 'REPORTED': return 'border-blue-200 bg-blue-50 text-blue-700';
        case 'SUPERSEDED': return 'border-amber-200 bg-amber-50 text-amber-800';
        case 'ORPHANED': return 'border-slate-300 bg-slate-50 text-slate-600';
        case 'REJECTED_RECENT': return 'border-red-200 bg-red-50 text-red-700';
        case 'REVOKED': return 'border-slate-300 bg-slate-100 text-slate-700';
        case 'SERVER_MASTER': return 'border-violet-200 bg-violet-50 text-violet-700';
        case 'CLIENT_ENDPOINT': return 'border-blue-200 bg-blue-50 text-blue-700';
        case 'LICENSE_EXCEEDED': return 'border-red-300 bg-red-50 text-red-800';
        default: return 'border-amber-200 bg-amber-50 text-amber-800';
    }
}

export function buildDeviceIdentityRows(
    terminal: TenantTerminalSnapshot,
    attempts: TerminalAuthAttempt[] = [],
): TerminalDeviceIdentityRow[] {
    const authorizedDeviceId = getTerminalAuthorizedDeviceId(terminal);
    const lastRejectedDeviceId = getTerminalLastRejectedDeviceId(terminal, attempts);
    const erpCurrentDeviceId = getErpCurrentDeviceId(terminal);
    const posReportedDeviceId = getTerminalPosReportedDeviceId(terminal);
    const rows: TerminalDeviceIdentityRow[] = [];
    const registries = terminal.registries?.length
        ? terminal.registries
        : terminal.registry
            ? [terminal.registry]
            : [];

    for (const registry of registries) {
        const deviceId = registry.current_device_id?.trim()
            || registry.device_id?.trim()
            || '';
        if (!deviceId) continue;

        const roles: TerminalDeviceRole[] = [];
        if (registry.is_primary) roles.push('SERVER_MASTER');
        else roles.push('CLIENT_ENDPOINT');

        const normalized = normalizeDeviceId(deviceId);
        const registryAuthStatus = (registry.auth_status || '').toUpperCase();
        if (registryAuthStatus === 'LICENSE_EXCEEDED') {
            roles.push('LICENSE_EXCEEDED');
        } else if (authorizedDeviceId && normalizeDeviceId(authorizedDeviceId) === normalized) {
            roles.push('AUTHORIZED_CURRENT');
        } else if (registry.is_revoked) {
            roles.push('REVOKED');
        } else if (authorizedDeviceId) {
            roles.push('SUPERSEDED');
        } else {
            roles.push(terminal.catalog_terminal_id ? 'REPORTED' : 'ORPHANED');
        }

        if (lastRejectedDeviceId && normalizeDeviceId(lastRejectedDeviceId) === normalized) {
            roles.push('REJECTED_RECENT');
        }

        rows.push({
            deviceId,
            roles: uniqueRoles(roles),
            registryId: registry.id || null,
            hostname: registry.hostname || null,
            lastSeenAt: registry.last_seen_at || null,
            source: registry.endpoint_url ? 'registry.endpoint' : 'registry.heartbeat',
        });
    }

    const ensureRow = (
        deviceId: string,
        roles: TerminalDeviceRole[],
        source: string,
        extra?: Partial<TerminalDeviceIdentityRow>,
    ) => {
        if (!deviceId.trim()) return;
        const normalized = normalizeDeviceId(deviceId);
        const existing = rows.find((row) => normalizeDeviceId(row.deviceId) === normalized);
        if (existing) {
            existing.roles = uniqueRoles([...existing.roles, ...roles]);
            return;
        }
        rows.push({
            deviceId: deviceId.trim(),
            roles: uniqueRoles(roles),
            source,
            ...extra,
        });
    };

    if (erpCurrentDeviceId) {
        const roles: TerminalDeviceRole[] = ['HISTORICAL'];
        if (authorizedDeviceId && normalizeDeviceId(erpCurrentDeviceId) === normalizeDeviceId(authorizedDeviceId)) {
            roles.push('AUTHORIZED_CURRENT');
        }
        ensureRow(erpCurrentDeviceId, roles, 'erp.terminals');
    }

    if (posReportedDeviceId) {
        const roles: TerminalDeviceRole[] = [];
        if (authorizedDeviceId && normalizeDeviceId(posReportedDeviceId) !== normalizeDeviceId(authorizedDeviceId)) {
            roles.push('HISTORICAL');
        } else if (authorizedDeviceId) {
            roles.push('AUTHORIZED_CURRENT');
        }
        ensureRow(posReportedDeviceId, roles.length ? roles : ['HISTORICAL'], 'pos.reported');
    }

    if (lastRejectedDeviceId) {
        ensureRow(lastRejectedDeviceId, ['REJECTED_RECENT'], 'auth.attempt');
    }

    if (authorizedDeviceId && !rows.some((row) => normalizeDeviceId(row.deviceId) === normalizeDeviceId(authorizedDeviceId))) {
        ensureRow(authorizedDeviceId, ['AUTHORIZED_CURRENT'], 'registry.authorized');
    }

    return rows.sort((a, b) => {
        const score = (row: TerminalDeviceIdentityRow) => (
            (row.roles.includes('AUTHORIZED_CURRENT') ? 100 : 0)
            + (row.roles.includes('REJECTED_RECENT') ? 80 : 0)
            + (row.roles.includes('SERVER_MASTER') ? 40 : 0)
            + (row.lastSeenAt ? 1 : 0)
        );
        return score(b) - score(a);
    });
}

function uniqueRoles(roles: TerminalDeviceRole[]): TerminalDeviceRole[] {
    return Array.from(new Set(roles));
}

export function buildTerminalIdentitySummary(
    terminal: TenantTerminalSnapshot,
    attempts: TerminalAuthAttempt[] = [],
): TerminalIdentitySummary {
    const authorizedDeviceId = getTerminalAuthorizedDeviceId(terminal);
    const posReportedDeviceId = getTerminalPosReportedDeviceId(terminal);
    const erpCurrentDeviceId = getErpCurrentDeviceId(terminal);
    const lastRejectedDeviceId = getTerminalLastRejectedDeviceId(terminal, attempts);
    const deviceRows = buildDeviceIdentityRows(terminal, attempts);
    const historicalDeviceIds = uniqueDeviceIds(
        deviceRows
            .filter((row) => row.roles.includes('HISTORICAL') && !row.roles.includes('AUTHORIZED_CURRENT'))
            .map((row) => row.deviceId),
    );

    return {
        erpTerminalUuid: getErpTerminalUuid(terminal) || 'N/D',
        catalogTerminalId: terminal.catalog_terminal_id?.trim() || 'N/D',
        terminalCode: getTerminalPosCode(terminal),
        localName: firstHumanLabel(terminal.name, terminal.registry?.terminal_name),
        authorizedDeviceId: authorizedDeviceId || 'N/D',
        posReportedDeviceId: posReportedDeviceId || 'N/D',
        erpCurrentDeviceId: erpCurrentDeviceId || 'N/D',
        lastRejectedDeviceId: lastRejectedDeviceId || 'N/D',
        authStatus: getTerminalAuthStatus(terminal, attempts),
        historicalDeviceIds,
        deviceRows,
        mismatchWarning: buildDeviceMismatchWarning(authorizedDeviceId, posReportedDeviceId, erpCurrentDeviceId),
        identityStatus: terminal.identity_status || (getErpTerminalUuid(terminal) ? 'REPORTED' : 'PENDING_RECONCILIATION'),
        bindingSource: terminal.identity_binding_source || (getErpTerminalUuid(terminal) ? 'erp_direct' : 'catalog_only'),
        hasCanonicalErpBinding: hasCanonicalErpBinding(terminal),
        reconciliationWarning: getErpTerminalUuid(terminal) ? null : UNVERIFIED_CATALOG_IDENTITY_MESSAGE,
    };
}

export function buildDeviceMismatchWarning(
    authorizedDeviceId: string,
    posReportedDeviceId: string,
    erpCurrentDeviceId: string,
): string | null {
    const authorized = normalizeDeviceId(authorizedDeviceId);
    const pos = normalizeDeviceId(posReportedDeviceId);
    const erp = normalizeDeviceId(erpCurrentDeviceId);

    if (pos && authorized && pos !== authorized) {
        return `El POS reporta ${posReportedDeviceId}, pero ALFA-Admin muestra ${authorizedDeviceId} como autorizado. Puede requerir takeover o actualización de autorización.`;
    }
    if (erp && authorized && erp !== authorized) {
        return `ALFA-RMS muestra ${erpCurrentDeviceId} como device actual, pero ALFA-Admin tiene autorizado ${authorizedDeviceId}. Valida el mapping en ALFA-RMS antes de forzar takeover.`;
    }
    if (pos && erp && pos !== erp) {
        return `El POS reporta ${posReportedDeviceId} y ERP muestra ${erpCurrentDeviceId}. Soporte debe alinear autorizacion, ERP y heartbeat del POS.`;
    }
    return null;
}

export function summarizeTerminalFiscalDebug(
    readiness: TerminalFiscalReadiness | null | undefined,
): TerminalFiscalDebugSummary {
    const statusValue = readField(readiness, ['fiscalReadiness', 'fiscal_readiness', 'status']);
    const fiscalReadiness = typeof statusValue === 'string' ? statusValue.toUpperCase() : 'MISSING';
    const missing = uniqueDeviceIds([
        ...readStringList(readField(readiness, ['missing', 'missingItems', 'missing_items'])),
        ...readStringList(readField(readiness, ['missingConfig', 'missing_config'])),
    ]);
    const searchedIn = readStringList(readField(readiness, [
        'searchedIn',
        'searched_in',
        'searchPath',
        'search_path',
        'lookedIn',
        'looked_in',
        'lookupPath',
        'lookup_path',
    ]));
    const found = readStringList(readField(readiness, ['found', 'foundItems', 'found_items', 'discovered']));
    const scopeHints = readStringList(readField(readiness, [
        'scopeHints',
        'scope_hints',
        'scopes',
        'availableScopes',
        'available_scopes',
        'branchConfig',
        'branch_config',
        'companyConfig',
        'company_config',
        'tenantConfig',
        'tenant_config',
    ]));

    const errorCode = typeof readField(readiness, ['error', 'error_code', 'code']) === 'string'
        ? String(readField(readiness, ['error', 'error_code', 'code']))
        : null;

    return {
        fiscalReadiness,
        matchedStrategy: typeof readField(readiness, ['matchedStrategy', 'matched_strategy', 'strategy']) === 'string'
            ? String(readField(readiness, ['matchedStrategy', 'matched_strategy', 'strategy']))
            : null,
        documentSeriesFound: readTruthy(readField(readiness, [
            'documentSeriesFound',
            'document_series_found',
            'documentSeries',
            'document_series',
        ])),
        fiscalRangesFound: readTruthy(readField(readiness, [
            'fiscalRangesFound',
            'fiscal_ranges_found',
            'rangesFound',
            'ranges_found',
        ])),
        fiscalSequencesFound: readTruthy(readField(readiness, [
            'fiscalSequencesFound',
            'fiscal_sequences_found',
            'sequencesFound',
            'sequences_found',
        ])),
        terminalFiscalConfigFound: readTruthy(readField(readiness, [
            'terminalFiscalConfigFound',
            'terminal_fiscal_config_found',
            'fiscalConfigFound',
            'fiscal_config_found',
        ])),
        missing,
        searchedIn,
        found,
        scopeHints,
        isMissing: fiscalReadiness === 'MISSING' || errorCode === 'FISCAL_CONFIG_MISSING',
        errorCode,
        message: typeof readiness?.message === 'string' ? readiness.message : null,
        checkedAt: typeof readiness?.checked_at === 'string' ? readiness.checked_at : null,
        raw: readiness || null,
    };
}

export function getRegistryEndpointRole(registry: TenantTerminalRegistryEntry | null | undefined): TerminalDeviceRole {
    if (!registry) return 'CLIENT_ENDPOINT';
    return registry.is_primary ? 'SERVER_MASTER' : 'CLIENT_ENDPOINT';
}
