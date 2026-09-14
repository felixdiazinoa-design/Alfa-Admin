import { useEffect, useMemo, useState } from 'react';
import {
    AlertCircle,
    Banknote,
    Braces,
    Calculator,
    Car,
    Check,
    Loader2,
    PackagePlus,
    Search,
    ShoppingBag,
    Users,
    Warehouse,
    X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
    erpModuleLicensingService,
    type ErpModuleDefinition,
    type ErpModuleStoreOverview,
} from '../lib/erpModuleLicensing';
import { cascadeErpModuleSelection, type ErpModuleDraftValue } from '../lib/erpModuleLicensingRules';

const MODULE_ICONS: Record<string, LucideIcon> = {
    users: Users,
    banknote: Banknote,
    calculator: Calculator,
    'shopping-bag': ShoppingBag,
    car: Car,
    warehouse: Warehouse,
    braces: Braces,
};

const METRIC_LABELS: Record<string, string> = {
    boolean: 'Activación',
    users: 'Usuarios',
    employees: 'Empleados licenciados',
    locations: 'Sucursales licenciadas',
    connections: 'Conexiones licenciadas',
    transactions: 'Transacciones mensuales',
    unlimited: 'Sin límite',
};

type DraftEntitlement = ErpModuleDraftValue;

interface ErpModuleStoreModalProps {
    isOpen: boolean;
    tenantId: string;
    tenantName: string;
    canManage: boolean;
    onClose: () => void;
    onSaved?: (activeModules: number) => void;
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error || 'No se pudieron cargar los módulos ERP.');
}

function buildDraft(overview: ErpModuleStoreOverview) {
    return Object.fromEntries(overview.modules.map((module) => {
        const entitlement = overview.entitlements.find((item) => item.module_code === module.code);
        return [module.code, {
            enabled: entitlement?.status === 'active',
            licensedQuantity: entitlement?.licensed_quantity || module.default_limit || 1,
        }];
    })) as Record<string, DraftEntitlement>;
}

export function ErpModuleStoreModal({
    isOpen,
    tenantId,
    tenantName,
    canManage,
    onClose,
    onSaved,
}: ErpModuleStoreModalProps) {
    const [overview, setOverview] = useState<ErpModuleStoreOverview | null>(null);
    const [draft, setDraft] = useState<Record<string, DraftEntitlement>>({});
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('Todos');

    useEffect(() => {
        if (!isOpen || !tenantId) return;
        let mounted = true;
        setLoading(true);
        setOverview(null);
        setDraft({});
        setError(null);
        setNotice(null);
        setSearch('');
        setCategory('Todos');
        void erpModuleLicensingService.getOverview(tenantId)
            .then((data) => {
                if (!mounted) return;
                setOverview(data);
                setDraft(buildDraft(data));
            })
            .catch((loadError) => {
                if (mounted) setError(getErrorMessage(loadError));
            })
            .finally(() => {
                if (mounted) setLoading(false);
            });
        return () => { mounted = false; };
    }, [isOpen, tenantId]);

    const categories = useMemo(() => [
        'Todos',
        ...Array.from(new Set((overview?.modules ?? []).map((module) => module.category))),
    ], [overview]);

    const filteredModules = useMemo(() => {
        const normalizedSearch = search.trim().toLowerCase();
        return (overview?.modules ?? []).filter((module) => {
            const matchesCategory = category === 'Todos' || module.category === category;
            const matchesSearch = !normalizedSearch
                || `${module.name} ${module.description} ${module.category}`.toLowerCase().includes(normalizedSearch);
            return matchesCategory && matchesSearch;
        });
    }, [category, overview, search]);

    const isDirty = useMemo(() => {
        if (!overview) return false;
        return overview.modules.some((module) => {
            const entitlement = overview.entitlements.find((item) => item.module_code === module.code);
            const persistedEnabled = entitlement?.status === 'active';
            const persistedQuantity = entitlement?.licensed_quantity || module.default_limit || 1;
            return draft[module.code]?.enabled !== persistedEnabled
                || draft[module.code]?.licensedQuantity !== persistedQuantity;
        });
    }, [draft, overview]);

    const activeCount = Object.values(draft).filter((item) => item.enabled).length;

    const toggleModule = (moduleCode: string) => {
        if (!overview || !canManage || !overview.tenant.erp_enabled) return;
        const enabling = !draft[moduleCode]?.enabled;
        const result = cascadeErpModuleSelection(draft, overview.dependencies, moduleCode, enabling);
        setDraft(result.draft);
        if (result.changedCodes.length > 1) {
            setNotice(enabling
                ? 'También se activaron los módulos requeridos por esta selección.'
                : 'También se desactivaron los módulos que dependían de esta selección.');
        } else {
            setNotice(null);
        }
    };

    const setLicensedQuantity = (moduleCode: string, value: string) => {
        const normalized = Math.max(1, Math.min(1_000_000, Number.parseInt(value, 10) || 1));
        setDraft((current) => ({
            ...current,
            [moduleCode]: { ...current[moduleCode], licensedQuantity: normalized },
        }));
    };

    const save = async () => {
        if (!overview || !canManage || !isDirty) return;
        setSaving(true);
        setError(null);
        try {
            const updated = await erpModuleLicensingService.save(tenantId, overview.modules.map((module) => ({
                module_code: module.code,
                enabled: draft[module.code]?.enabled === true,
                licensed_quantity: draft[module.code]?.licensedQuantity || module.default_limit || 1,
            })));
            setOverview(updated);
            setDraft(buildDraft(updated));
            onSaved?.(updated.entitlements.filter((item) => item.status === 'active').length);
            onClose();
        } catch (saveError) {
            setError(getErrorMessage(saveError));
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
            <div role="dialog" aria-modal="true" aria-labelledby="erp-module-store-title" className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
                <header className="flex items-start justify-between border-b border-slate-200 bg-slate-50 px-6 py-5">
                    <div>
                        <div className="flex items-center gap-3">
                            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white"><PackagePlus size={22} /></span>
                            <div>
                                <h2 id="erp-module-store-title" className="text-xl font-black text-slate-900">Módulos y licencias ERP</h2>
                                <p className="mt-0.5 text-sm text-slate-500">Tenant: {tenantName}</p>
                            </div>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} disabled={saving} aria-label="Cerrar tienda de módulos" className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 disabled:opacity-50"><X size={20} /></button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto p-6">
                    {loading ? (
                        <div className="flex min-h-80 items-center justify-center gap-3 text-sm font-bold text-slate-500"><Loader2 className="animate-spin" size={20} /> Cargando catálogo de módulos...</div>
                    ) : error && !overview ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm font-semibold text-rose-700">{error}</div>
                    ) : overview ? (
                        <div className="space-y-5">
                            {!overview.tenant.erp_enabled ? (
                                <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                    <AlertCircle className="mt-0.5 shrink-0" size={18} />
                                    <div><p className="font-black">ALFA-RMS no está activo</p><p className="mt-1">Activa ALFA-RMS y guarda los cambios del tenant antes de habilitar módulos adicionales.</p></div>
                                </div>
                            ) : (
                                <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
                                    Selecciona los módulos contratados y sus límites. Los cambios quedarán pendientes hasta que el ERP confirme el aprovisionamiento.
                                </div>
                            )}

                            {notice ? <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700">{notice}</div> : null}
                            {error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700">{error}</div> : null}

                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <div className="flex flex-wrap gap-2">
                                    {categories.map((item) => (
                                        <button key={item} type="button" onClick={() => setCategory(item)} className={`rounded-full px-3 py-1.5 text-xs font-black transition ${category === item ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{item}</button>
                                    ))}
                                </div>
                                <label className="flex min-w-64 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-400 focus-within:border-indigo-400">
                                    <Search size={17} />
                                    <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar módulo" className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none" />
                                </label>
                            </div>

                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                                {filteredModules.map((module) => (
                                    <ModuleCard
                                        key={module.code}
                                        module={module}
                                        overview={overview}
                                        draft={draft[module.code]}
                                        canManage={canManage && overview.tenant.erp_enabled}
                                        onToggle={() => toggleModule(module.code)}
                                        onQuantityChange={(value) => setLicensedQuantity(module.code, value)}
                                    />
                                ))}
                            </div>

                            {!filteredModules.length ? <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm font-semibold text-slate-500">No hay módulos que coincidan con el filtro.</div> : null}
                        </div>
                    ) : null}
                </div>

                <footer className="flex flex-col gap-3 border-t border-slate-200 bg-white px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p className="text-sm font-black text-slate-800">{activeCount} módulo{activeCount === 1 ? '' : 's'} activo{activeCount === 1 ? '' : 's'}</p>
                        <p className="text-xs text-slate-500">{canManage ? (isDirty ? 'Hay cambios sin aplicar.' : 'No hay cambios pendientes.') : 'Tu perfil tiene acceso de solo lectura.'}</p>
                    </div>
                    <div className="flex gap-3">
                        <button type="button" onClick={onClose} disabled={saving} className="rounded-xl bg-slate-100 px-5 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-200 disabled:opacity-50">Cancelar</button>
                        <button type="button" onClick={() => void save()} disabled={saving || loading || !canManage || !overview?.tenant.erp_enabled || !isDirty} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-black text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                            {saving ? <Loader2 className="animate-spin" size={17} /> : <Check size={17} />}
                            {saving ? 'Aplicando...' : 'Aplicar módulos'}
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
}

function ModuleCard({ module, overview, draft, canManage, onToggle, onQuantityChange }: {
    module: ErpModuleDefinition;
    overview: ErpModuleStoreOverview;
    draft?: DraftEntitlement;
    canManage: boolean;
    onToggle: () => void;
    onQuantityChange: (value: string) => void;
}) {
    const Icon = MODULE_ICONS[module.icon_key] || PackagePlus;
    const entitlement = overview.entitlements.find((item) => item.module_code === module.code);
    const dependencies = overview.dependencies
        .filter((dependency) => dependency.module_code === module.code)
        .map((dependency) => overview.modules.find((item) => item.code === dependency.required_module_code)?.name)
        .filter(Boolean);
    const enabled = draft?.enabled === true;
    const persistedEnabled = entitlement?.status === 'active';
    const changed = enabled !== persistedEnabled || (draft?.licensedQuantity ?? module.default_limit) !== (entitlement?.licensed_quantity ?? module.default_limit);

    let statusLabel = 'Disponible';
    let statusClasses = 'bg-slate-100 text-slate-600';
    if (changed) {
        statusLabel = 'Cambio sin aplicar';
        statusClasses = 'bg-amber-100 text-amber-700';
    } else if (entitlement?.provisioning_status === 'pending') {
        statusLabel = 'Pendiente ERP';
        statusClasses = 'bg-blue-100 text-blue-700';
    } else if (entitlement?.provisioning_status === 'error') {
        statusLabel = 'Error ERP';
        statusClasses = 'bg-rose-100 text-rose-700';
    } else if (enabled) {
        statusLabel = 'Activo';
        statusClasses = 'bg-emerald-100 text-emerald-700';
    } else if (entitlement?.status === 'suspended') {
        statusLabel = 'Suspendido';
        statusClasses = 'bg-rose-100 text-rose-700';
    }

    return (
        <article className={`flex min-h-72 flex-col overflow-hidden rounded-2xl border transition ${enabled ? 'border-indigo-300 bg-indigo-50/50 shadow-sm' : 'border-slate-200 bg-white'}`}>
            <button type="button" onClick={onToggle} disabled={!canManage} className="flex flex-1 flex-col p-4 text-left disabled:cursor-default">
                <div className="flex items-start justify-between gap-3">
                    <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${enabled ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}><Icon size={21} /></span>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${statusClasses}`}>{statusLabel}</span>
                </div>
                <p className="mt-4 text-[10px] font-black uppercase tracking-widest text-indigo-500">{module.category}</p>
                <h3 className="mt-1 text-base font-black text-slate-900">{module.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{module.description}</p>
                {dependencies.length ? <p className="mt-3 text-xs font-bold text-amber-700">Requiere: {dependencies.join(', ')}</p> : null}
            </button>

            {enabled && !['boolean', 'unlimited'].includes(module.license_metric) ? (
                <div className="border-t border-indigo-100 bg-white/80 px-4 py-3">
                    <label className="block text-[10px] font-black uppercase tracking-wide text-indigo-700">{METRIC_LABELS[module.license_metric]}</label>
                    <input type="number" min="1" max="1000000" value={draft?.licensedQuantity || module.default_limit} disabled={!canManage} onChange={(event) => onQuantityChange(event.target.value)} className="mt-1.5 w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-black text-slate-800 outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-slate-100" />
                </div>
            ) : (
                <div className="border-t border-slate-100 px-4 py-3 text-xs font-bold text-slate-500">{METRIC_LABELS[module.license_metric]}</div>
            )}
        </article>
    );
}
