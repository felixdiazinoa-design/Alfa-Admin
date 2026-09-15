import React from 'react';
import { Package, Check, Plus, Star } from 'lucide-react';
import type { BillingPlan } from '../types';

const mockPlans: BillingPlan[] = [
    { id: '1', name: 'Plan Básico', price_monthly: 29.99, max_terminals: 1 },
    { id: '2', name: 'Plan Pro', price_monthly: 59.99, max_terminals: 3 },
    { id: '3', name: 'Plan Enterprise', price_monthly: 129.99, max_terminals: 10 },
];

export const Plans: React.FC = () => {
    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                        <Package className="text-brand" size={28} />
                        Planes SaaS (Licencias)
                    </h2>
                    <p className="text-slate-500 text-sm mt-1">Configura los paquetes de suscripción y sus límites estructurales para los tenants.</p>
                </div>
                <button className="bg-slate-900 hover:bg-black text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-colors">
                    <Plus size={20} />
                    Crear Plan
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
                {mockPlans.map((plan, i) => (
                    <div key={plan.id} className={`relative overflow-hidden rounded-3xl border bg-white ${i === 1 ? 'border-brand shadow-xl shadow-brand-soft/60' : 'border-brand-border shadow-sm'}`}>
                        {i === 1 && (
                            <div className="flex items-center justify-center gap-1 bg-brand py-1.5 text-center text-[10px] font-black uppercase tracking-widest text-white">
                                <Star size={12} fill="white" /> Más Popular
                            </div>
                        )}
                        <div className="p-8">
                            <h3 className="text-xl font-black text-slate-800">{plan.name}</h3>
                            <div className="mt-4 flex items-baseline gap-1">
                                <span className="text-4xl font-black text-slate-900">${plan.price_monthly}</span>
                                <span className="text-slate-500 font-medium">/mes</span>
                            </div>

                            <div className="mt-8 space-y-4">
                                <div className="flex items-center gap-3 text-sm text-slate-600">
                                    <div className="p-1 rounded bg-emerald-100 text-emerald-600"><Check size={14} strokeWidth={3} /></div>
                                    <span className="font-semibold text-slate-800">{plan.max_terminals} {plan.max_terminals === 1 ? 'Terminal' : 'Terminales'} (Cajas)</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-slate-600">
                                    <div className="p-1 rounded bg-emerald-100 text-emerald-600"><Check size={14} strokeWidth={3} /></div>
                                    Soporte Técnico
                                </div>
                                <div className="flex items-center gap-3 text-sm text-slate-600">
                                    <div className="p-1 rounded bg-emerald-100 text-emerald-600"><Check size={14} strokeWidth={3} /></div>
                                    Integración Nube
                                </div>
                                {i > 0 && (
                                    <div className="flex items-center gap-3 text-sm text-slate-600">
                                        <div className="p-1 rounded bg-emerald-100 text-emerald-600"><Check size={14} strokeWidth={3} /></div>
                                        Multimoneda
                                    </div>
                                )}
                                {i > 1 && (
                                    <div className="flex items-center gap-3 text-sm text-slate-600">
                                        <div className="p-1 rounded bg-emerald-100 text-emerald-600"><Check size={14} strokeWidth={3} /></div>
                                        API de desarrollador
                                    </div>
                                )}
                            </div>

                            <div className="mt-8 pt-6 border-t border-slate-100">
                                <button className={`w-full rounded-xl py-3 font-bold transition-colors ${i === 1 ? 'bg-brand text-white hover:bg-brand-hover' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                                    Editar Paquete
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
