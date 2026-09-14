import React, { useEffect, useMemo, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    BarChart3,
    CheckCircle2,
    Download,
    Filter,
    RefreshCcw,
    ServerCog,
    ShieldAlert,
    Terminal,
    Wifi,
    WifiOff,
} from 'lucide-react';
import {
    getOperationalObservability,
    type ObservabilityPeriod,
    type ObservabilityStatus,
    type OperationalObservability as OperationalObservabilityData,
    type TenantObservabilityRow,
} from '../lib/observabilityService';
import type { CloudChannel, ContractedProduct } from '../types';

const emptyData: OperationalObservabilityData = {
    generatedAt: new Date().toISOString(),
    period: '24h',
    summary: {
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
    },
    tenants: [],
    topEndpoints: [],
    telemetryConfigured: false,
    telemetryMessage: null,
};

const statusLabel: Record<ObservabilityStatus, string> = {
    OK: 'OK',
    ATTENTION: 'Atencion',
    CRITICAL: 'Critico',
};

function formatInteger(value: number) {
    return new Intl.NumberFormat('es-DO').format(Math.round(value || 0));
}

function formatDateTime(value?: string | null) {
    if (!value) return 'N/D';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/D';
    return new Intl.DateTimeFormat('es-DO', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function getStatusClasses(status: ObservabilityStatus) {
    if (status === 'OK') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    if (status === 'ATTENTION') return 'border-amber-200 bg-amber-50 text-amber-800';
    return 'border-red-200 bg-red-50 text-red-700';
}

function getStatusIcon(status: ObservabilityStatus) {
    if (status === 'OK') return <CheckCircle2 size={16} />;
    if (status === 'ATTENTION') return <AlertTriangle size={16} />;
    return <ShieldAlert size={16} />;
}

function StatCard(props: {
    label: string;
    value: string | number;
    detail: string;
    tone: 'blue' | 'emerald' | 'amber' | 'red' | 'slate';
    icon: React.ReactNode;
}) {
    const toneClasses = {
        blue: 'bg-blue-50 text-blue-700 border-blue-100',
        emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        amber: 'bg-amber-50 text-amber-700 border-amber-100',
        red: 'bg-red-50 text-red-700 border-red-100',
        slate: 'bg-slate-50 text-slate-700 border-slate-100',
    }[props.tone];

    return (
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{props.label}</p>
                    <p className="mt-2 text-3xl font-black text-slate-900">{props.value}</p>
                    <p className="mt-2 text-xs font-semibold text-slate-500">{props.detail}</p>
                </div>
                <div className={`rounded-2xl border p-3 ${toneClasses}`}>
                    {props.icon}
                </div>
            </div>
        </div>
    );
}

export const OperationalObservability: React.FC = () => {
    const [data, setData] = useState<OperationalObservabilityData>(emptyData);
    const [period, setPeriod] = useState<ObservabilityPeriod>('24h');
    const [tenantId, setTenantId] = useState('ALL');
    const [contractedProduct, setContractedProduct] = useState<ContractedProduct | 'ALL'>('ALL');
    const [cloudChannel, setCloudChannel] = useState<CloudChannel | 'ALL'>('ALL');
    const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const selectedTenant = useMemo(
        () => data.tenants.find((tenant) => tenant.tenantId === selectedTenantId) || data.tenants[0] || null,
        [data.tenants, selectedTenantId],
    );

    useEffect(() => {
        if (selectedTenantId && !data.tenants.some((tenant) => tenant.tenantId === selectedTenantId)) {
            setSelectedTenantId(data.tenants[0]?.tenantId || null);
        }
    }, [data.tenants, selectedTenantId]);

    const loadData = async () => {
        setIsLoading(true);
        setErrorMessage(null);
        try {
            const next = await getOperationalObservability({
                period,
                tenantId: tenantId === 'ALL' ? undefined : tenantId,
                contractedProduct,
                cloudChannel,
            });
            setData(next);
            setSelectedTenantId((current) => current && next.tenants.some((tenant) => tenant.tenantId === current)
                ? current
                : next.tenants[0]?.tenantId || null);
        } catch (error) {
            console.error('Operational observability failed', error);
            setErrorMessage('No se pudo cargar la observabilidad operativa.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [period, tenantId, contractedProduct, cloudChannel]);

    const exportDiagnostics = () => {
        const payload = {
            exported_at: new Date().toISOString(),
            filters: { period, tenantId, contractedProduct, cloudChannel },
            data,
            selected_tenant: selectedTenant,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `alfa-admin-observability-${period}-${Date.now()}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-black uppercase tracking-wider text-blue-700">
                        <Activity size={14} />
                        Operaciones
                    </div>
                    <h2 className="mt-3 text-2xl font-black text-slate-900">Centro de Observabilidad Operativa</h2>
                    <p className="mt-1 max-w-3xl text-sm font-medium text-slate-500">
                        Consumo y salud técnica por tenant, terminal y canal. Esta consola es interna de ALFA-Admin y no se expone al cliente final.
                    </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                        type="button"
                        onClick={() => void loadData()}
                        disabled={isLoading}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60"
                    >
                        {isLoading ? <RefreshCcw size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
                        Refrescar
                    </button>
                    <button
                        type="button"
                        onClick={exportDiagnostics}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-slate-800"
                    >
                        <Download size={16} />
                        Exportar diagnostico
                    </button>
                </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500 xl:w-36">
                        <Filter size={15} />
                        Filtros
                    </div>
                    <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-4">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                            Periodo
                            <select
                                value={period}
                                onChange={(event) => setPeriod(event.target.value as ObservabilityPeriod)}
                                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="24h">Ultimas 24h</option>
                                <option value="7d">7 dias</option>
                                <option value="30d">30 dias</option>
                            </select>
                        </label>
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                            Tenant
                            <select
                                value={tenantId}
                                onChange={(event) => setTenantId(event.target.value)}
                                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="ALL">Todos</option>
                                {data.tenants.map((tenant) => (
                                    <option key={tenant.tenantId} value={tenant.tenantId}>{tenant.tenantName}</option>
                                ))}
                            </select>
                        </label>
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                            Producto
                            <select
                                value={contractedProduct}
                                onChange={(event) => setContractedProduct(event.target.value as ContractedProduct | 'ALL')}
                                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="ALL">Todos</option>
                                <option value="POS_ONLY">POS_ONLY</option>
                                <option value="POS_ERP">POS_ERP</option>
                            </select>
                        </label>
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                            Canal
                            <select
                                value={cloudChannel}
                                onChange={(event) => setCloudChannel(event.target.value as CloudChannel | 'ALL')}
                                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="ALL">Todos</option>
                                <option value="POS_CLOUD_STAGING">POS_CLOUD_STAGING</option>
                                <option value="ERP_ACTIVE">ERP_ACTIVE</option>
                                <option value="POS_MASTER">POS_MASTER</option>
                                <option value="NONE">NONE</option>
                            </select>
                        </label>
                    </div>
                </div>
            </div>

            {errorMessage ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                    {errorMessage}
                </div>
            ) : null}

            {!data.telemetryConfigured ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                    {data.telemetryMessage || 'Telemetría ALFA-RMS opcional no configurada. Se muestran datos locales de ALFA-Admin/Supabase.'}
                </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                <StatCard label="Tenants" value={formatInteger(data.summary.tenants)} detail={`${formatInteger(data.summary.ok)} OK`} tone="blue" icon={<ServerCog size={22} />} />
                <StatCard label="Terminales" value={formatInteger(data.summary.terminals)} detail={`${formatInteger(data.summary.terminalsOnline)} online / ${formatInteger(data.summary.terminalsOffline)} offline`} tone="emerald" icon={<Wifi size={22} />} />
                <StatCard label="Atencion" value={formatInteger(data.summary.attention)} detail="Tenants con senales operativas" tone="amber" icon={<AlertTriangle size={22} />} />
                <StatCard label="Criticos" value={formatInteger(data.summary.critical)} detail={`${formatInteger(data.summary.recentErrors)} errores recientes`} tone="red" icon={<ShieldAlert size={22} />} />
                <StatCard label="Consumo estimado" value={formatInteger(data.summary.supabaseEstimatedUnits)} detail={`${formatInteger(data.summary.apiCalls)} API / ${formatInteger(data.summary.posEvents)} eventos`} tone="slate" icon={<BarChart3 size={22} />} />
            </div>

            <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.2fr_0.8fr]">
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-100 px-5 py-4">
                        <h3 className="font-black text-slate-900">Consumo por tenant</h3>
                        <p className="mt-1 text-xs font-medium text-slate-500">Estado general, terminales, eventos y consumo tecnico estimado.</p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-100 text-sm">
                            <thead className="bg-slate-50 text-left text-[11px] font-black uppercase tracking-wider text-slate-400">
                                <tr>
                                    <th className="px-5 py-3">Tenant</th>
                                    <th className="px-5 py-3">Producto / canal</th>
                                    <th className="px-5 py-3">Terminales</th>
                                    <th className="px-5 py-3">Ultimo sync</th>
                                    <th className="px-5 py-3">Eventos</th>
                                    <th className="px-5 py-3">Errores</th>
                                    <th className="px-5 py-3">Estado</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={7} className="px-5 py-10 text-center text-sm font-bold text-slate-400">Cargando observabilidad...</td>
                                    </tr>
                                ) : data.tenants.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-5 py-10 text-center text-sm font-bold text-slate-400">No hay tenants para estos filtros.</td>
                                    </tr>
                                ) : data.tenants.map((tenant) => (
                                    <tr
                                        key={tenant.tenantId}
                                        onClick={() => setSelectedTenantId(tenant.tenantId)}
                                        className={`cursor-pointer transition-colors hover:bg-blue-50/60 ${selectedTenant?.tenantId === tenant.tenantId ? 'bg-blue-50' : 'bg-white'}`}
                                    >
                                        <td className="px-5 py-4">
                                            <p className="font-black text-slate-900">{tenant.tenantName}</p>
                                            <p className="mt-1 font-mono text-xs text-slate-400">{tenant.tenantId}</p>
                                        </td>
                                        <td className="px-5 py-4">
                                            <p className="font-bold text-slate-700">{tenant.contractedProduct}</p>
                                            <p className="mt-1 font-mono text-xs text-slate-500">{tenant.cloudChannel}</p>
                                        </td>
                                        <td className="px-5 py-4">
                                            <p className="font-bold text-slate-800">{formatInteger(tenant.terminalsTotal)}</p>
                                            <p className="mt-1 text-xs font-semibold text-slate-500">{formatInteger(tenant.terminalsOnline)} online / {formatInteger(tenant.terminalsOffline)} offline</p>
                                        </td>
                                        <td className="px-5 py-4 text-slate-600">{formatDateTime(tenant.lastSyncAt)}</td>
                                        <td className="px-5 py-4">
                                            <p className="font-bold text-slate-800">{formatInteger(tenant.posEvents)}</p>
                                            <p className="mt-1 text-xs text-slate-500">{formatInteger(tenant.pendingEvents)} pendientes / {formatInteger(tenant.blockedEvents)} bloqueados</p>
                                        </td>
                                        <td className="px-5 py-4 font-black text-slate-800">{formatInteger(tenant.recentErrors)}</td>
                                        <td className="px-5 py-4">
                                            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black uppercase ${getStatusClasses(tenant.status)}`}>
                                                {getStatusIcon(tenant.status)}
                                                {statusLabel[tenant.status]}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <TenantDrillDown tenant={selectedTenant} />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="font-black text-slate-900">Endpoints mas usados / con errores</h3>
                <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4">
                    {data.topEndpoints.length ? data.topEndpoints.map((endpoint) => (
                        <div key={endpoint.endpoint} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                            <p className="break-all font-mono text-xs font-bold text-slate-600">{endpoint.endpoint}</p>
                            <div className="mt-3 flex items-center justify-between text-sm">
                                <span className="font-bold text-slate-800">{formatInteger(endpoint.calls)} calls</span>
                                <span className={`font-bold ${endpoint.errors > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatInteger(endpoint.errors)} errores</span>
                            </div>
                            <p className="mt-2 text-xs font-semibold text-slate-500">
                                Avg {endpoint.avgDurationMs ? `${Math.round(endpoint.avgDurationMs)} ms` : 'N/D'}
                                {' · '}
                                Cache {endpoint.cacheHitRate != null ? `${Math.round(endpoint.cacheHitRate)}%` : 'N/D'}
                            </p>
                        </div>
                    )) : (
                        <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-6 text-sm font-bold text-slate-400">
                            Sin telemetria de endpoints reportada.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

function TenantDrillDown({ tenant }: { tenant: TenantObservabilityRow | null }) {
    if (!tenant) {
        return (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-bold text-slate-400">Selecciona un tenant para ver el detalle operativo.</p>
            </div>
        );
    }

    return (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="font-black text-slate-900">{tenant.tenantName}</h3>
                        <p className="mt-1 font-mono text-xs text-slate-400">{tenant.tenantId}</p>
                    </div>
                    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black uppercase ${getStatusClasses(tenant.status)}`}>
                        {getStatusIcon(tenant.status)}
                        {statusLabel[tenant.status]}
                    </span>
                </div>
            </div>

            <div className="space-y-4 p-5">
                <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Producto</p>
                        <p className="mt-1 font-bold text-slate-800">{tenant.contractedProduct}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Canal</p>
                        <p className="mt-1 font-mono text-xs font-bold text-slate-800">{tenant.cloudChannel}</p>
                    </div>
                </div>

                <div>
                    <p className="text-xs font-black uppercase tracking-wider text-slate-500">Alertas</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {tenant.alerts.length ? tenant.alerts.map((alert) => (
                            <span key={alert} className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
                                {alert}
                            </span>
                        )) : (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                                Sin alertas activas
                            </span>
                        )}
                    </div>
                </div>

                <div>
                    <p className="text-xs font-black uppercase tracking-wider text-slate-500">Terminales</p>
                    <div className="mt-3 space-y-3">
                        {tenant.terminals.length ? tenant.terminals.map((terminal) => (
                            <div key={terminal.id} className={`rounded-2xl border px-4 py-3 ${getStatusClasses(terminal.status)}`}>
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            {terminal.online ? <Wifi size={16} /> : <WifiOff size={16} />}
                                            <p className="font-black">{terminal.terminalName}</p>
                                        </div>
                                        <p className="mt-1 font-mono text-xs opacity-80">{terminal.terminalId}</p>
                                    </div>
                                    <span className="text-xs font-black uppercase">{statusLabel[terminal.status]}</span>
                                </div>

                                <div className="mt-3 grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
                                    <Metric label="Device" value={terminal.deviceId} mono />
                                    <Metric label="Autorizado" value={terminal.authorizedDeviceId} mono />
                                    <Metric label="Heartbeat" value={formatDateTime(terminal.lastSeenAt)} />
                                    <Metric label="Ultimo sync" value={formatDateTime(terminal.lastSyncAt)} />
                                    <Metric label="Sync status" value={terminal.syncStatus} />
                                    <Metric label="Pendientes / error" value={`${formatInteger(terminal.pendingDocuments)} / ${formatInteger(terminal.errorDocuments)}`} />
                                </div>

                                {terminal.lastError ? (
                                    <p className="mt-3 rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-xs font-bold">
                                        Ultimo error: {terminal.lastError}
                                    </p>
                                ) : null}

                                <div className="mt-3 flex flex-wrap gap-2">
                                    {terminal.suggestions.length ? terminal.suggestions.map((suggestion) => (
                                        <span key={suggestion} className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/70 px-2 py-1 text-[11px] font-black uppercase">
                                            <Terminal size={12} />
                                            {suggestion}
                                        </span>
                                    )) : (
                                        <span className="rounded-full border border-white/70 bg-white/70 px-2 py-1 text-[11px] font-black uppercase">
                                            Sin acciones sugeridas
                                        </span>
                                    )}
                                </div>
                            </div>
                        )) : (
                            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-6 text-sm font-bold text-slate-400">
                                Este tenant no tiene terminales registradas.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function Metric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="rounded-xl border border-white/70 bg-white/70 px-3 py-2">
            <p className="font-black uppercase tracking-wider opacity-60">{label}</p>
            <p className={`mt-1 break-all font-bold ${mono ? 'font-mono' : ''}`}>{value || 'N/D'}</p>
        </div>
    );
}
