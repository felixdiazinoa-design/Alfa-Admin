import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Clock, Frown, HelpCircle, Meh, Server, ShieldAlert, Smile, Users } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { tenantService, type DashboardStats } from '../lib/tenantService';
import { chartColors } from '../theme/chartColors';

const emptyStats: DashboardStats = {
    totalTenants: 0,
    activeTenants: 0,
    trialTenants: 0,
    suspendedTenants: 0,
    terminals: 0,
    activeSubscriptions: 0,
    openTickets: 0,
    criticalTickets: 0,
    tenantGrowth: [],
    recentTickets: [],
    expiringSubscriptions: [],
    inactiveTenants: [],
    supportSatisfaction: {
        totalResponses: 0,
        excellent: { count: 0, percentage: 0 },
        good: { count: 0, percentage: 0 },
        bad: { count: 0, percentage: 0 },
    },
    lastUpdatedAt: new Date().toISOString(),
};

function formatInteger(value: number): string {
    return new Intl.NumberFormat('es-DO').format(value);
}

function formatDate(value: string): string {
    return new Intl.DateTimeFormat('es-DO', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    }).format(new Date(value));
}

function formatDateTime(value: string): string {
    return new Intl.DateTimeFormat('es-DO', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(value));
}

function formatRelativeAge(value: string): string {
    const diffMs = Date.now() - new Date(value).getTime();
    const minutes = Math.max(0, Math.floor(diffMs / 60000));

    if (minutes < 1) return 'Ahora';
    if (minutes < 60) return `Hace ${minutes} min`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Hace ${hours} h`;

    const days = Math.floor(hours / 24);
    return `Hace ${days} d`;
}

function priorityClass(priority: string): string {
    const normalized = priority.toLowerCase();

    if (normalized.startsWith('cr')) return 'bg-red-50 text-red-600';
    if (normalized === 'alta') return 'bg-orange-50 text-orange-600';
    if (normalized === 'media') return 'bg-blue-50 text-blue-600';

    return 'bg-slate-100 text-slate-600';
}

const satisfactionItems = [
    {
        key: 'excellent',
        label: 'Excelente',
        detail: '5 estrellas',
        icon: Smile,
        color: 'text-emerald-600',
        bg: 'bg-emerald-50',
        bar: 'bg-emerald-500',
    },
    {
        key: 'good',
        label: 'Bueno',
        detail: '3-4 estrellas',
        icon: Meh,
        color: 'text-amber-600',
        bg: 'bg-amber-50',
        bar: 'bg-amber-500',
    },
    {
        key: 'bad',
        label: 'Malo',
        detail: '1-2 estrellas',
        icon: Frown,
        color: 'text-red-600',
        bg: 'bg-red-50',
        bar: 'bg-red-500',
    },
] as const;

export const Dashboard: React.FC = () => {
    const [stats, setStats] = useState<DashboardStats>(emptyStats);
    const [isLoading, setIsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;

        const fetchGlobalStats = async () => {
            try {
                const nextStats = await tenantService.getDashboardStats();
                if (!mounted) return;

                setStats(nextStats);
                setErrorMessage(null);
            } catch (error) {
                console.error('Failed to fetch dashboard stats', error);
                if (mounted) setErrorMessage('No se pudo cargar el Dashboard desde Supabase.');
            } finally {
                if (mounted) setIsLoading(false);
            }
        };

        fetchGlobalStats();

        return () => {
            mounted = false;
        };
    }, []);

    const activeOperations = stats.activeTenants + stats.trialTenants;

    return (
        <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 sm:p-6 xl:space-y-8 xl:p-8">
            {errorMessage && (
                <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                    {errorMessage}
                </div>
            )}

            <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="glass-card rounded-2xl p-6 relative overflow-hidden">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tenants Activos</p>
                            <h3 className="text-3xl font-bold mt-1 text-slate-800">{isLoading ? '...' : formatInteger(stats.activeTenants)}</h3>
                            <p className="text-xs text-slate-500 mt-3">Total registrados: {formatInteger(stats.totalTenants)}</p>
                        </div>
                        <div className="p-2 bg-indigo-50 rounded-xl text-indigo-600">
                            <Users size={24} />
                        </div>
                    </div>
                </div>

                <div className="glass-card rounded-2xl p-6 relative overflow-hidden">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">En Prueba</p>
                            <h3 className="text-3xl font-bold mt-1 text-amber-600">{isLoading ? '...' : formatInteger(stats.trialTenants)}</h3>
                            <p className="text-xs text-slate-500 mt-3">Operativos: {formatInteger(activeOperations)}</p>
                        </div>
                        <div className="p-2 bg-amber-50 rounded-xl text-amber-600">
                            <Clock size={24} />
                        </div>
                    </div>
                </div>

                <div className="glass-card rounded-2xl p-6 relative overflow-hidden">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Cuentas Suspendidas</p>
                            <h3 className="text-3xl font-bold mt-1 text-orange-600">{isLoading ? '...' : formatInteger(stats.suspendedTenants)}</h3>
                            <p className="text-xs text-slate-500 mt-3">Bloqueadas desde landlord.tenants</p>
                        </div>
                        <div className="p-2 bg-orange-50 rounded-xl text-orange-600">
                            <AlertCircle size={24} />
                        </div>
                    </div>
                </div>

                <div className="glass-card rounded-2xl p-6 relative overflow-hidden">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Terminales POS</p>
                            <h3 className="text-3xl font-bold mt-1 text-indigo-600">{isLoading ? '...' : formatInteger(stats.terminals)}</h3>
                            <p className="text-xs text-slate-500 mt-3">Registradas en public.terminals</p>
                        </div>
                        <div className="p-2 bg-indigo-50 rounded-xl text-indigo-600">
                            <Server size={24} />
                        </div>
                    </div>
                </div>
            </section>

            <section className={`rounded-2xl border p-5 shadow-sm ${stats.inactiveTenants.length ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                        <div className={`rounded-xl p-2 ${stats.inactiveTenants.length ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}><AlertCircle size={22} /></div>
                        <div><h3 className="font-black text-slate-900">Alerta de inactividad</h3><p className="mt-1 text-sm text-slate-600">Tenants con sincronización esperada y más de 3 días sin actividad.</p></div>
                    </div>
                    <span className={`w-max rounded-full px-3 py-1 text-xs font-black ${stats.inactiveTenants.length ? 'bg-amber-200 text-amber-800' : 'bg-emerald-200 text-emerald-800'}`}>{stats.inactiveTenants.length} requieren seguimiento</span>
                </div>
                {stats.inactiveTenants.length ? (
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                        {stats.inactiveTenants.map((tenant) => (
                            <Link key={tenant.tenantId} to="/tenants" className="rounded-xl border border-amber-200 bg-white p-3 transition hover:border-amber-300 hover:shadow-sm">
                                <p className="truncate text-sm font-black text-slate-800">{tenant.tenantName}</p>
                                <p className="mt-1 text-xs font-bold text-amber-700">{tenant.daysInactive} días sin actividad</p>
                                <p className="mt-1 text-[10px] text-slate-400">Última señal: {tenant.lastActivityAt ? formatDateTime(tenant.lastActivityAt) : 'Nunca sincronizó'}</p>
                            </Link>
                        ))}
                    </div>
                ) : <p className="mt-4 text-sm font-semibold text-emerald-800">No hay clientes inactivos según el umbral actual.</p>}
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 glass-card rounded-2xl p-6">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-8">
                        <div>
                            <h4 className="font-bold text-slate-800">Altas de Tenants</h4>
                            <p className="text-sm text-slate-500">Últimos 6 meses según fecha de creación real</p>
                        </div>
                        <p className="text-xs font-semibold text-slate-400">Actualizado {formatDateTime(stats.lastUpdatedAt)}</p>
                    </div>
                    <div className="h-[350px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={stats.tenantGrowth} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="tenantGrowthValue" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={chartColors.primary} stopOpacity={0.22} />
                                        <stop offset="95%" stopColor={chartColors.primary} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="name" stroke={chartColors.axis} fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke={chartColors.axis} fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.grid} />
                                <Tooltip
                                    contentStyle={{ borderRadius: '12px', border: `1px solid ${chartColors.grid}`, boxShadow: '0 4px 14px rgb(11 22 24 / 0.08)', fontFamily: 'Sora, Inter, system-ui, sans-serif' }}
                                    formatter={(value: number | string | undefined) => [formatInteger(Number(value ?? 0)), 'Altas']}
                                />
                                <Area
                                    type="linear"
                                    dataKey="value"
                                    stroke={chartColors.primary}
                                    strokeWidth={3}
                                    fillOpacity={1}
                                    fill="url(#tenantGrowthValue)"
                                    activeDot={{ r: 6, strokeWidth: 2, stroke: chartColors.surface }}
                                    dot={{ r: 4, fill: chartColors.primary, stroke: chartColors.surface, strokeWidth: 2 }}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="glass-card rounded-2xl p-6">
                        <h4 className="font-bold text-slate-800 mb-6">Operación Actual</h4>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                                <span className="text-sm font-semibold text-slate-600">Suscripciones activas</span>
                                <span className="text-lg font-black text-slate-900">{formatInteger(stats.activeSubscriptions)}</span>
                            </div>
                            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                                <span className="text-sm font-semibold text-slate-600">Tickets abiertos</span>
                                <span className="text-lg font-black text-slate-900">{formatInteger(stats.openTickets)}</span>
                            </div>
                            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                                <span className="text-sm font-semibold text-slate-600">Tickets críticos</span>
                                <span className="text-lg font-black text-red-600">{formatInteger(stats.criticalTickets)}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-semibold text-slate-600">Tenants operativos</span>
                                <span className="text-lg font-black text-emerald-600">{formatInteger(activeOperations)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="glass-card rounded-2xl p-6">
                        <div className="mb-5 flex items-start justify-between gap-3">
                            <div>
                                <h4 className="font-bold text-slate-800">Satisfacción del soporte</h4>
                                <p className="mt-1 text-xs font-medium text-slate-500">
                                    {formatInteger(stats.supportSatisfaction.totalResponses)} encuesta{stats.supportSatisfaction.totalResponses === 1 ? '' : 's'} respondida{stats.supportSatisfaction.totalResponses === 1 ? '' : 's'}
                                </p>
                            </div>
                            {stats.supportSatisfaction.totalResponses > 0 && stats.supportSatisfaction.totalResponses < 5 ? (
                                <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-500">Muestra baja</span>
                            ) : null}
                        </div>

                        {stats.supportSatisfaction.totalResponses === 0 ? (
                            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-500">
                                Aún no hay encuestas respondidas.
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {satisfactionItems.map((item) => {
                                    const bucket = stats.supportSatisfaction[item.key];
                                    const Icon = item.icon;

                                    return (
                                        <div key={item.key}>
                                            <div className="mb-2 flex items-center justify-between gap-3">
                                                <div className="flex min-w-0 items-center gap-3">
                                                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${item.bg} ${item.color}`}>
                                                        <Icon size={18} />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-bold text-slate-800">{item.label}</p>
                                                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.detail}</p>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <p className={`text-lg font-black ${item.color}`}>{bucket.percentage}%</p>
                                                    <p className="text-[10px] font-semibold text-slate-400">{formatInteger(bucket.count)}</p>
                                                </div>
                                            </div>
                                            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                                                <div className={`h-full rounded-full ${item.bar}`} style={{ width: `${bucket.percentage}%` }} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="glass-card rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h4 className="font-bold text-slate-800">Tickets Recientes</h4>
                        <Link to="/support" className="text-xs font-bold text-indigo-600 hover:underline">
                            Gestionar Tickets
                        </Link>
                    </div>

                    {stats.recentTickets.length === 0 ? (
                        <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-500">
                            <HelpCircle size={18} />
                            No hay tickets recientes disponibles.
                        </div>
                    ) : (
                        <div className="overflow-hidden border border-slate-100 rounded-xl">
                            <table className="w-full text-left text-sm border-collapse">
                                <thead className="bg-slate-50/50">
                                    <tr>
                                        <th className="p-3 font-semibold text-slate-500">Ticket</th>
                                        <th className="p-3 font-semibold text-slate-500">Prioridad</th>
                                        <th className="p-3 font-semibold text-slate-500 text-right">Recibido</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 bg-white/40">
                                    {stats.recentTickets.map((ticket) => (
                                        <tr key={ticket.id}>
                                            <td className="p-3">
                                                <p className="font-medium text-slate-800">{ticket.subject}</p>
                                                <p className="text-[10px] text-slate-400">{ticket.tenantName}</p>
                                            </td>
                                            <td className="p-3">
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${priorityClass(ticket.priority)}`}>
                                                    {ticket.priority}
                                                </span>
                                            </td>
                                            <td className="p-3 text-right font-medium text-slate-600">{formatRelativeAge(ticket.createdAt)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <div className="glass-card rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h4 className="font-bold text-slate-800">Vencimientos de Suscripción</h4>
                        <span className="bg-orange-100 text-orange-700 text-[10px] px-2 py-0.5 rounded font-bold">
                            {formatInteger(stats.expiringSubscriptions.length)} PRÓXIMOS
                        </span>
                    </div>

                    {stats.expiringSubscriptions.length === 0 ? (
                        <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-500">
                            <CheckCircle2 size={18} />
                            No hay vencimientos registrados en los próximos 30 días.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {stats.expiringSubscriptions.map((subscription) => (
                                <div key={`${subscription.tenantId}-${subscription.endDate}`} className="flex items-center justify-between p-3 bg-white/50 border border-slate-100 rounded-xl">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-600">
                                            {subscription.tenantName.slice(0, 2).toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="truncate text-xs font-bold text-slate-800">{subscription.tenantName}</p>
                                            <p className="text-[10px] font-medium text-orange-600">
                                                {subscription.planName} vence en {subscription.daysRemaining} día{subscription.daysRemaining === 1 ? '' : 's'}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                                        <ShieldAlert size={14} />
                                        {formatDate(subscription.endDate)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
