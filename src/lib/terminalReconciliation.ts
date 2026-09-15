import type { TenantTerminalSnapshot } from '../types';
import { getErpTerminalUuid, getTerminalAuthorizedDeviceId, getTerminalPosCode } from './terminalIdentity.ts';

export interface TerminalReconciliationPreview {
    dryRun: true;
    writesPerformed: false;
    executable: boolean;
    tenantId: string;
    catalogTerminalId: string | null;
    currentErpTerminalUuid: string | null;
    targetErpTerminalUuid: string | null;
    targetTerminalName: string | null;
    targetStoreId: string | null;
    terminalCode: string | null;
    localName: string;
    authorizedDeviceId: string | null;
    resultingAuthorizedDeviceId: string | null;
    reportedDeviceIds: string[];
    auditPlan: string[];
    rollbackPlan: string[];
    blockers: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildTerminalReconciliationPreview(
    terminal: TenantTerminalSnapshot,
    target?: {
        erpTerminalUuid?: string | null;
        targetTerminalName?: string | null;
        storeId?: string | null;
        authorizedDeviceId?: string | null;
        reason?: string | null;
        adminConfirmed?: boolean;
    },
): TerminalReconciliationPreview {
    const targetUuid = target?.erpTerminalUuid?.trim() || null;
    const storeId = target?.storeId?.trim() || null;
    const resultingDeviceId = target?.authorizedDeviceId?.trim() || null;
    const blockers: string[] = [];
    if (!targetUuid || !UUID_RE.test(targetUuid)) blockers.push('Se requiere un UUID ERP canónico explícito.');
    if (!storeId || !UUID_RE.test(storeId)) blockers.push('Se requiere una sucursal ERP explícita.');
    if (!resultingDeviceId) blockers.push('Se requiere el Device ID que quedará autorizado.');
    if (!target?.reason?.trim()) blockers.push('Se requiere un motivo administrativo.');
    if (!target?.adminConfirmed) blockers.push('Se requiere confirmación administrativa explícita.');

    const reportedDeviceIds = Array.from(new Set((terminal.registries || [])
        .map((registry) => registry.current_device_id?.trim() || registry.device_id?.trim() || '')
        .filter(Boolean)));

    return {
        dryRun: true,
        writesPerformed: false,
        executable: blockers.length === 0,
        tenantId: terminal.tenant_id,
        catalogTerminalId: terminal.catalog_terminal_id || null,
        currentErpTerminalUuid: getErpTerminalUuid(terminal) || null,
        targetErpTerminalUuid: targetUuid,
        targetTerminalName: target?.targetTerminalName?.trim() || null,
        targetStoreId: storeId,
        terminalCode: getTerminalPosCode(terminal) || null,
        localName: terminal.name,
        authorizedDeviceId: getTerminalAuthorizedDeviceId(terminal) || null,
        resultingAuthorizedDeviceId: resultingDeviceId,
        reportedDeviceIds,
        auditPlan: [
            'Validar que el tenant ALFA-RMS corresponde al tenant ALFA-Admin.',
            'Validar que la terminal ERP pertenece a la sucursal indicada.',
            'Registrar el vínculo explícito catálogo → terminal ERP.',
            'Conservar historiales y marcar devices anteriores como reemplazados o revocados.',
        ],
        rollbackPlan: [
            'Eliminar solamente el vínculo explícito creado por la reconciliación.',
            'Restaurar los estados anteriores desde terminal_device_audit.',
            'No eliminar filas de catálogo, ventas, maestros, fiscal ni secuencias.',
        ],
        blockers,
    };
}
