import React, { useState } from 'react';
import { AlertTriangle, Check, Cloud, CloudOff, Database, HardDrive, MonitorSmartphone, X } from 'lucide-react';
import type { TenantProductKey, TenantProductSelection } from '../lib/tenantProducts';
import { normalizeTenantProductSelection, TENANT_PRODUCTS } from '../lib/tenantProducts';

const PRODUCT_ICONS: Record<TenantProductKey, React.ComponentType<{ size?: number; className?: string }>> = {
    pos: MonitorSmartphone,
    erp: Database,
    backup: HardDrive
};

interface TenantProductsModalProps {
    isOpen: boolean;
    title: string;
    tenantName?: string;
    initialProducts: TenantProductSelection;
    onClose: () => void;
    onSave: (products: TenantProductSelection) => void;
}

export const TenantProductsModal: React.FC<TenantProductsModalProps> = ({
    isOpen,
    title,
    tenantName,
    initialProducts,
    onClose,
    onSave
}) => {
    const [draft, setDraft] = useState<TenantProductSelection>(initialProducts);

    if (!isOpen) return null;

    const normalizedDraft = normalizeTenantProductSelection(draft);
    const hasMainProduct = normalizedDraft.pos || normalizedDraft.erp;

    const toggleProduct = (key: TenantProductKey) => {
        setDraft((current) => {
            const next = {
                ...current,
                [key]: !current[key]
            };

            if (key === 'erp' && next.erp) {
                next.backup = true;
                next.offlineMode = false;
            }

            if (key === 'backup' && next.pos && !next.erp) {
                next.offlineMode = !next.backup;
            }

            return normalizeTenantProductSelection(next);
        });
    };

    const setPosOnlyVariant = (offlineMode: boolean) => {
        setDraft((current) => normalizeTenantProductSelection({
            ...current,
            pos: true,
            erp: false,
            backup: !offlineMode,
            offlineMode,
        }));
    };

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <div>
                        <h3 className="font-black text-lg text-slate-800">{title}</h3>
                        <p className="text-sm text-slate-500">
                            {tenantName ? `Tenant: ${tenantName}` : 'Define que productos y addons quedan activos.'}
                        </p>
                    </div>
                    <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-5">
                    <div className="rounded-2xl border border-brand/20 bg-brand-soft px-4 py-3 text-sm text-brand-sidebar">
                        Usa este modal para encender o apagar productos del tenant sin mezclarlo con los datos de la empresa.
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {TENANT_PRODUCTS.map((product) => {
                            const Icon = PRODUCT_ICONS[product.key];
                            const active = normalizedDraft[product.key];

                            return (
                                <div
                                    key={product.key}
                                    className={`rounded-2xl border flex flex-col overflow-hidden transition-all ${
                                        active
                                            ? 'border-brand/40 bg-brand-soft shadow-sm shadow-brand-soft'
                                            : 'border-slate-200 bg-white hover:border-slate-300'
                                    }`}
                                >
                                    <button
                                        type="button"
                                        onClick={() => toggleProduct(product.key)}
                                        className="p-4 text-left flex-1 hover:bg-slate-50/50 transition-colors"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${
                                                active ? 'bg-brand text-white' : 'bg-slate-100 text-slate-500'
                                            }`}>
                                                <Icon size={20} />
                                            </div>
                                            <div className={`w-6 h-6 rounded-full border flex items-center justify-center ${
                                                active ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-transparent'
                                            }`}>
                                                <Check size={14} />
                                            </div>
                                        </div>
                                        <h4 className="mt-4 font-black text-slate-800">{product.label}</h4>
                                        <p className="mt-2 text-sm text-slate-500 leading-relaxed">{product.description}</p>
                                    </button>

                                    {active && product.key === 'pos' && (
                                        <div className="mt-auto border-t border-brand/20 bg-brand-soft/50 px-4 pb-4 pt-3">
                                            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-brand-sidebar">
                                                Límite de Terminales
                                            </label>
                                            <input
                                                type="number"
                                                min="1"
                                                value={draft.pos_licenses}
                                                onChange={e => setDraft(d => ({ ...d, pos_licenses: parseInt(e.target.value) || 1 }))}
                                                className="input bg-white px-3 py-2 font-bold"
                                            />
                                        </div>
                                    )}

                                    {active && product.key === 'erp' && (
                                        <div className="mt-auto border-t border-brand/20 bg-brand-soft/50 px-4 pb-4 pt-3">
                                            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-brand-sidebar">
                                                Usuarios Concurrentes
                                            </label>
                                            <input
                                                type="number"
                                                min="1"
                                                value={draft.erp_users}
                                                onChange={e => setDraft(d => ({ ...d, erp_users: parseInt(e.target.value) || 1 }))}
                                                className="input bg-white px-3 py-2 font-bold"
                                            />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {normalizedDraft.pos && !normalizedDraft.erp && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <button
                                type="button"
                                onClick={() => setPosOnlyVariant(false)}
                                className={`rounded-2xl border p-4 text-left transition-all ${
                                    !normalizedDraft.offlineMode
                                        ? 'border-emerald-300 bg-emerald-50 shadow-sm shadow-emerald-100'
                                        : 'border-slate-200 bg-white hover:border-slate-300'
                                }`}
                            >
                                <div className="flex items-start gap-3">
                                    <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${
                                        !normalizedDraft.offlineMode ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
                                    }`}>
                                        <Cloud size={20} />
                                    </div>
                                    <div>
                                        <h4 className="font-black text-slate-800">POS_ONLY SaaS con Cloud Staging</h4>
                                        <p className="mt-2 text-sm text-slate-500 leading-relaxed">
                                            Recomendado. Incluye respaldo cloud, recuperacion SaaS y core interno sin ERP visible.
                                        </p>
                                    </div>
                                </div>
                            </button>
                            <button
                                type="button"
                                onClick={() => setPosOnlyVariant(true)}
                                className={`rounded-2xl border p-4 text-left transition-all ${
                                    normalizedDraft.offlineMode
                                        ? 'border-amber-300 bg-amber-50 shadow-sm shadow-amber-100'
                                        : 'border-slate-200 bg-white hover:border-slate-300'
                                }`}
                            >
                                <div className="flex items-start gap-3">
                                    <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${
                                        normalizedDraft.offlineMode ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-500'
                                    }`}>
                                        <CloudOff size={20} />
                                    </div>
                                    <div>
                                        <h4 className="font-black text-slate-800">POS_ONLY Offline / Sin nube</h4>
                                        <p className="mt-2 text-sm text-slate-500 leading-relaxed">
                                            Solo para excepciones. Sin backup cloud, recuperacion SaaS ni staging automatico.
                                        </p>
                                    </div>
                                </div>
                            </button>
                        </div>
                    )}

                    {normalizedDraft.offlineMode && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 flex gap-2">
                            <AlertTriangle size={18} className="shrink-0" />
                            Este tenant quedara explicitamente sin nube. Usa este modo solo cuando el contrato lo requiera.
                        </div>
                    )}

                    {!hasMainProduct && (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                            Debes activar al menos uno de los productos principales: ALFA-RMS POS o ALFA-RMS.
                        </div>
                    )}

                    <div className="pt-4 flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-3 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="button"
                            disabled={!hasMainProduct}
                            onClick={() => onSave(normalizedDraft)}
                            className="flex-1 rounded-xl bg-brand px-4 py-3 font-bold text-white shadow-sm transition-colors hover:bg-brand-hover disabled:opacity-60"
                        >
                            Aplicar Productos
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
