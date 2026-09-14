import React, { useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    ArrowUpDown,
    Bug,
    CheckCircle2,
    Clipboard,
    Download,
    ExternalLink,
    FileText,
    ListChecks,
    Link,
    Loader2,
    PackageCheck,
    Plus,
    Save,
    Smartphone,
    Sparkles,
    X,
} from 'lucide-react';
import {
    buildDirectDownloadUrl,
    createPosApkRelease,
    getPosApkReleases,
    updatePosApkReleaseStatus,
    type PosApkRelease,
    type PosApkReleaseStatus,
} from '../lib/posApkReleases';

type ReleaseStatusFilter = 'all' | PosApkReleaseStatus;
type VersionSortDirection = 'desc' | 'asc';

const defaultForm = {
    versionName: '',
    versionCode: '',
    apkUrl: '',
    checksumSha256: '',
    changelog: '',
    releaseType: 'bugfix',
    releaseStatus: 'internal_testing' as PosApkReleaseStatus,
    summary: '',
    bugsFixed: '',
    newFeatures: '',
    internalChanges: '',
    validationChecklist: '',
    installNotes: '',
    rolloutScope: 'Todos los tenants',
};

const releaseTypeLabels: Record<string, string> = {
    bugfix: 'Corrección de bugs',
    feature: 'Nueva funcionalidad',
    improvement: 'Mejora operativa',
    hotfix: 'Hotfix urgente',
    beta: 'Versión de prueba',
};

const releaseStatusLabels: Record<string, string> = {
    draft: 'Borrador',
    internal_testing: 'Prueba interna',
    beta: 'Beta',
    available: 'Disponible',
    retired: 'Retirado',
};

const releaseStatusStyles: Record<PosApkReleaseStatus, string> = {
    draft: 'bg-slate-100 text-slate-600',
    internal_testing: 'bg-amber-100 text-amber-800',
    beta: 'bg-violet-100 text-violet-700',
    available: 'bg-emerald-100 text-emerald-700',
    retired: 'bg-rose-100 text-rose-700',
};

function formatDateTime(value?: string | null) {
    if (!value) return 'N/D';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'N/D';
    return parsed.toLocaleString('es-DO');
}

function getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object') {
        const payload = error as Record<string, unknown>;
        const parts = [payload.message, payload.details, payload.hint, payload.code ? `code: ${payload.code}` : undefined]
            .filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
        if (parts.length > 0) return parts.join(' · ');
        return JSON.stringify(payload);
    }
    return String(error);
}

function linesToList(value: string): string[] {
    return value
        .split('\n')
        .map((line) => line.replace(/^[-*]\s*/, '').trim())
        .filter(Boolean);
}

function listItems(values?: string[] | null, empty = 'No registrado') {
    const cleanValues = (values ?? []).filter(Boolean);
    return cleanValues.length > 0 ? cleanValues : [empty];
}

function buildCloudAdminApkUrl(path: string) {
    if (typeof window === 'undefined') return path;
    return `${window.location.origin}${path}`;
}

function normalizeRelation<T>(value: T | T[] | null | undefined) {
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

const ReleaseList: React.FC<{
    title: string;
    items?: string[] | null;
    icon: React.ElementType;
    tone: 'rose' | 'emerald' | 'blue' | 'amber';
    empty: string;
}> = ({ title, items, icon: Icon, tone, empty }) => {
    const tones = {
        rose: 'bg-rose-50 text-rose-700 border-rose-100',
        emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        blue: 'bg-blue-50 text-blue-700 border-blue-100',
        amber: 'bg-amber-50 text-amber-700 border-amber-100',
    };

    return (
        <div className={`rounded-xl border px-3 py-2.5 ${tones[tone]}`}>
            <div className="mb-1.5 flex items-center gap-1.5">
                <Icon size={13} />
                <p className="text-[10px] font-black uppercase tracking-wider">{title}</p>
            </div>
            <ul className="space-y-0.5 text-xs font-semibold leading-normal">
                {listItems(items, empty).map((item) => (
                    <li key={item} className="flex gap-1.5">
                        <span aria-hidden="true">-</span>
                        <span>{item}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
};

const CopyButton: React.FC<{ value: string; label?: string }> = ({ value, label = 'Copiar' }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
    };

    return (
        <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-50"
        >
            {copied ? <CheckCircle2 size={14} className="text-emerald-600" /> : <Clipboard size={14} />}
            {copied ? 'Copiado' : label}
        </button>
    );
};

const ReleaseDetails: React.FC<{ release: PosApkRelease }> = ({ release }) => (
    <div className="space-y-3">
        <div className="grid gap-2 md:grid-cols-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">SHA256</p>
                <p className="mt-1 break-all font-mono text-xs text-slate-700">{release.checksum_sha256 || 'No registrado'}</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Alcance recomendado</p>
                <p className="mt-1 text-xs font-semibold text-slate-700">{release.rollout_scope || 'Todos los tenants'}</p>
            </div>
        </div>

        {release.summary ? (
            <div className="rounded-xl border border-slate-100 bg-white px-3 py-2.5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Resumen soporte</p>
                <p className="mt-1 text-xs font-medium leading-normal text-slate-700">{release.summary}</p>
            </div>
        ) : null}

        {release.changelog ? (
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Changelog</p>
                <p className="mt-1 whitespace-pre-line text-xs font-medium leading-normal text-slate-700">{release.changelog}</p>
            </div>
        ) : null}

        <div className="grid gap-2 lg:grid-cols-2">
            <ReleaseList title="Soluciona" items={release.bugs_fixed} icon={Bug} tone="rose" empty="No hay bugs documentados" />
            <ReleaseList title="Agrega" items={release.new_features} icon={Sparkles} tone="emerald" empty="No hay funciones nuevas documentadas" />
            <ReleaseList title="Cambios internos" items={release.internal_changes} icon={FileText} tone="blue" empty="No hay cambios internos documentados" />
            <ReleaseList title="Validación" items={release.validation_checklist} icon={ListChecks} tone="amber" empty="No hay checklist QA documentado" />
        </div>

        {release.install_notes ? (
            <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Notas de instalación</p>
                <p className="mt-1 whitespace-pre-line text-xs font-semibold leading-normal text-amber-900">{release.install_notes}</p>
            </div>
        ) : null}
    </div>
);

export const PosApkReleases: React.FC<{ canManage: boolean }> = ({ canManage }) => {
    const [releases, setReleases] = useState<PosApkRelease[]>([]);
    const [selectedReleaseId, setSelectedReleaseId] = useState<string | null>(null);
    const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
    const [form, setForm] = useState(defaultForm);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [updatingStatus, setUpdatingStatus] = useState(false);
    const [statusDraft, setStatusDraft] = useState<PosApkReleaseStatus>('internal_testing');
    const [statusNotes, setStatusNotes] = useState('');
    const [statusFilter, setStatusFilter] = useState<ReleaseStatusFilter>('all');
    const [versionSortDirection, setVersionSortDirection] = useState<VersionSortDirection>('desc');
    const [message, setMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    const latestRelease = releases.find((release) => release.is_latest && release.release_status === 'available')
        || releases.find((release) => release.release_status === 'available')
        || null;
    const visibleReleases = useMemo(() => releases
        .filter((release) => statusFilter === 'all' || release.release_status === statusFilter)
        .sort((left, right) => versionSortDirection === 'desc'
            ? right.version_code - left.version_code
            : left.version_code - right.version_code), [releases, statusFilter, versionSortDirection]);
    const selectedRelease = visibleReleases.find((release) => release.id === selectedReleaseId)
        || visibleReleases[0]
        || null;
    const selectedStatusActor = normalizeRelation(selectedRelease?.status_actor);
    const previewDownloadUrl = useMemo(() => buildDirectDownloadUrl(form.apkUrl), [form.apkUrl]);
    const availableCount = releases.filter((release) => release.release_status === 'available').length;
    const latestApkDownloadUrl = useMemo(() => buildCloudAdminApkUrl('/api/pos-apk/latest?download=1'), []);
    const latestApkJsonUrl = useMemo(() => buildCloudAdminApkUrl('/api/pos-apk/latest'), []);
    const selectedDownloadUrl = selectedRelease?.direct_download_url || selectedRelease?.apk_url || '';

    const loadReleases = async () => {
        setLoading(true);
        setErrorMessage('');
        try {
            const loadedReleases = await getPosApkReleases();
            setReleases(loadedReleases);
            setSelectedReleaseId((current) => current || loadedReleases.find((release) => release.is_latest)?.id || loadedReleases[0]?.id || null);
        } catch (error) {
            setErrorMessage(`No se pudieron cargar los APK: ${getErrorMessage(error)}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadReleases();
    }, []);

    useEffect(() => {
        if (!selectedRelease) return;
        setStatusDraft(selectedRelease.release_status);
        setStatusNotes('');
    }, [selectedRelease]);

    const openRegisterModal = () => {
        setForm(defaultForm);
        setMessage('');
        setErrorMessage('');
        setIsRegisterModalOpen(true);
    };

    const closeRegisterModal = () => {
        if (saving) return;
        setIsRegisterModalOpen(false);
    };

    const updateForm = <K extends keyof typeof defaultForm>(key: K, value: (typeof defaultForm)[K]) => {
        setForm((current) => ({ ...current, [key]: value }));
        setMessage('');
        setErrorMessage('');
    };

    const handleSave = async (event: React.FormEvent) => {
        event.preventDefault();
        setSaving(true);
        setMessage('');
        setErrorMessage('');

        const versionCode = Number(form.versionCode);
        if (!Number.isInteger(versionCode) || versionCode <= 0) {
            setErrorMessage('El version code debe ser un numero entero mayor que cero.');
            setSaving(false);
            return;
        }

        try {
            const release = await createPosApkRelease({
                versionName: form.versionName,
                versionCode,
                apkUrl: form.apkUrl,
                checksumSha256: form.checksumSha256,
                changelog: form.changelog,
                releaseType: form.releaseType,
                releaseStatus: form.releaseStatus,
                summary: form.summary,
                bugsFixed: linesToList(form.bugsFixed),
                newFeatures: linesToList(form.newFeatures),
                internalChanges: linesToList(form.internalChanges),
                validationChecklist: linesToList(form.validationChecklist),
                installNotes: form.installNotes,
                rolloutScope: form.rolloutScope,
            });

            setForm(defaultForm);
            setSelectedReleaseId(release.id);
            setMessage(`APK POS ${release.version_name} registrado.`);
            setIsRegisterModalOpen(false);
            await loadReleases();
        } catch (error) {
            setErrorMessage(`No se pudo registrar el APK: ${getErrorMessage(error)}`);
        } finally {
            setSaving(false);
        }
    };

    const handleStatusUpdate = async () => {
        if (!selectedRelease || !canManage || statusDraft === selectedRelease.release_status) return;
        setUpdatingStatus(true);
        setMessage('');
        setErrorMessage('');
        try {
            const updated = await updatePosApkReleaseStatus(selectedRelease.id, statusDraft, statusNotes);
            setMessage(
                updated.release_status === 'available'
                    ? updated.is_latest
                        ? `APK POS ${updated.version_name} promovido a la actualización automática.`
                        : `APK POS ${updated.version_name} marcado como Disponible; la versión automática sigue siendo la de mayor version code.`
                    : `APK POS ${updated.version_name} actualizado a ${releaseStatusLabels[updated.release_status]}.`,
            );
            await loadReleases();
            setSelectedReleaseId(updated.id);
        } catch (error) {
            setErrorMessage(`No se pudo actualizar el estado: ${getErrorMessage(error)}`);
        } finally {
            setUpdatingStatus(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-xl font-black text-slate-800">
                        <Smartphone className="text-blue-600" size={22} />
                        APK POS
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500">Versiones publicadas, notas de soporte e historico de APK.</p>
                </div>
                <div className="flex items-center gap-2">
                    {loading ? (
                        <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-500">
                            <Loader2 className="animate-spin text-blue-500" size={14} />
                            Cargando
                        </div>
                    ) : null}
                    {canManage ? (
                        <button
                            type="button"
                            onClick={openRegisterModal}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-blue-700"
                        >
                            <Plus size={16} />
                            Nuevo
                        </button>
                    ) : null}
                </div>
            </div>

            {message ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-bold text-emerald-800">
                    {message}
                </div>
            ) : null}

            {errorMessage && !isRegisterModalOpen ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-800">
                    {errorMessage}
                </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <div className="rounded-xl border border-blue-100 bg-blue-50/40 px-3 py-2.5 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Versión automática</p>
                    <p className="mt-1 text-xl font-black leading-none text-blue-900">
                        {latestRelease ? `v${latestRelease.version_name}` : 'N/D'}
                    </p>
                    <p className="mt-1 text-[11px] font-medium text-blue-700">
                        {latestRelease ? `Build ${latestRelease.version_code}` : 'Sin APK disponible'}
                    </p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2.5 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total releases</p>
                    <p className="mt-1 text-xl font-black leading-none text-slate-800">{releases.length}</p>
                    <p className="mt-1 text-[11px] font-medium text-slate-500">En el historico</p>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 px-3 py-2.5 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Disponibles</p>
                    <p className="mt-1 text-xl font-black leading-none text-emerald-800">{availableCount}</p>
                    <p className="mt-1 text-[11px] font-medium text-emerald-700">Elegibles para actualización</p>
                </div>
                <div className="rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-2.5 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-violet-600">Última publicación</p>
                    <p className="mt-1 text-xs font-black leading-snug text-violet-900">
                        {latestRelease ? formatDateTime(latestRelease.published_at) : 'N/D'}
                    </p>
                    <p className="mt-1 text-[11px] font-medium text-violet-700 truncate">
                        {latestRelease?.rollout_scope || 'Todos los tenants'}
                    </p>
                </div>
            </div>

            <section className="rounded-xl border border-blue-100 bg-white shadow-sm">
                <div className="grid gap-3 p-3.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                    <div className="flex items-start gap-3">
                        <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
                            <Download size={17} />
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-wider text-blue-600">Canal automático estable</p>
                            <h3 className="mt-0.5 text-base font-black text-slate-900">
                                {latestRelease ? `APK disponible POS ${latestRelease.version_name}` : 'No hay APK disponible'}
                            </h3>
                            <p className="mt-0.5 text-xs font-medium text-slate-500">
                                {latestRelease
                                    ? `Build ${latestRelease.version_code} - único APK entregado a terminales y al enlace automático.`
                                    : 'Promueve una versión a Disponible para habilitar las actualizaciones automáticas.'}
                            </p>
                            <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Enlace ALFA-Admin</p>
                                <p className="mt-0.5 truncate font-mono text-[11px] text-slate-600" title={latestApkDownloadUrl}>{latestApkDownloadUrl}</p>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2 lg:justify-end">
                        <a
                            href={latestApkDownloadUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-disabled={!latestRelease}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black text-white shadow-sm transition-colors ${latestRelease ? 'bg-blue-600 hover:bg-blue-700' : 'pointer-events-none bg-slate-300'}`}
                        >
                            <Download size={18} />
                            Descargar APK disponible
                        </a>
                        {latestRelease ? <CopyButton value={latestApkDownloadUrl} label="Copiar link automático" /> : null}
                        {latestRelease ? <CopyButton value={latestApkJsonUrl} label="Copiar endpoint" /> : null}
                    </div>
                </div>
            </section>

            <section className="grid items-start gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                <div className="flex min-h-[420px] flex-col rounded-xl border border-slate-100 bg-white shadow-sm">
                    <div className="border-b border-slate-100 px-4 py-3">
                        <h3 className="font-black text-slate-900">Historial de APK</h3>
                        <p className="mt-1 text-xs font-medium text-slate-500">Selecciona una version para ver detalle y descargar.</p>
                        <div className="mt-3 grid gap-2">
                            <label className="block">
                                <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400">Estado</span>
                                <select
                                    aria-label="Filtrar APK por estado"
                                    value={statusFilter}
                                    onChange={(event) => {
                                        setStatusFilter(event.target.value as ReleaseStatusFilter);
                                        setSelectedReleaseId(null);
                                    }}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                >
                                    <option value="all">Todos los estados</option>
                                    {Object.entries(releaseStatusLabels).map(([value, label]) => (
                                        <option key={value} value={value}>{label}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="block">
                                <span className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-400">
                                    <ArrowUpDown size={11} /> Orden por número de APK
                                </span>
                                <select
                                    aria-label="Ordenar APK por version code"
                                    value={versionSortDirection}
                                    onChange={(event) => setVersionSortDirection(event.target.value as VersionSortDirection)}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                >
                                    <option value="desc">Mayor a menor</option>
                                    <option value="asc">Menor a mayor</option>
                                </select>
                            </label>
                        </div>
                    </div>
                    <div className="max-h-[540px] flex-1 divide-y divide-slate-100 overflow-y-auto">
                        {visibleReleases.map((release) => {
                            const isSelected = selectedRelease?.id === release.id;
                            return (
                                <button
                                    key={release.id}
                                    type="button"
                                    onClick={() => setSelectedReleaseId(release.id)}
                                    className={`w-full px-4 py-2.5 text-left transition-colors ${isSelected ? 'border-l-2 border-l-blue-500 bg-blue-50' : 'border-l-2 border-l-transparent hover:bg-slate-50'}`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-sm font-black text-slate-800">POS {release.version_name}</p>
                                            <p className="mt-0.5 font-mono text-[11px] text-slate-400">Build {release.version_code}</p>
                                        </div>
                                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${releaseStatusStyles[release.release_status]}`}>
                                            {release.is_latest ? 'Automático' : releaseStatusLabels[release.release_status]}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-[10px] font-black uppercase text-slate-600">
                                        {releaseTypeLabels[release.release_type || ''] || release.release_type || 'Sin clasificar'}
                                    </p>
                                    <p className="mt-0.5 line-clamp-1 text-[11px] font-medium text-slate-500">
                                        {release.summary || release.changelog || 'Sin resumen documentado'}
                                    </p>
                                    <p className="mt-1 text-[10px] font-medium text-slate-400">{formatDateTime(release.published_at)}</p>
                                </button>
                            );
                        })}
                        {visibleReleases.length === 0 && !loading ? (
                            <div className="px-5 py-12 text-center text-sm font-medium text-slate-500">
                                {releases.length === 0 ? 'No hay releases registrados.' : 'No hay APK con el estado seleccionado.'}
                                {canManage && releases.length === 0 ? (
                                    <button
                                        type="button"
                                        onClick={openRegisterModal}
                                        className="mt-3 block w-full text-blue-600 font-bold hover:underline"
                                    >
                                        Registrar el primer APK
                                    </button>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className="max-h-[620px] overflow-y-auto rounded-xl border border-slate-100 bg-white shadow-sm">
                    {selectedRelease ? (
                        <>
                            <div className="border-b border-slate-100 px-4 py-3">
                                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                                    <div className="flex items-start gap-3">
                                        <div className="shrink-0 rounded-lg bg-blue-50 p-2 text-blue-600">
                                            <Smartphone size={18} />
                                        </div>
                                        <div>
                                            <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                                                {selectedRelease.is_latest ? 'Actualización automática' : 'Descarga técnica'}
                                            </p>
                                            <h3 className="mt-0.5 text-lg font-black text-slate-900">
                                                POS {selectedRelease.version_name}
                                            </h3>
                                            <p className="mt-0.5 text-xs font-medium text-slate-500">
                                                Build {selectedRelease.version_code} · {formatDateTime(selectedRelease.published_at)}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase ${releaseStatusStyles[selectedRelease.release_status]}`}>
                                            {releaseStatusLabels[selectedRelease.release_status]}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-3 px-4 py-3">
                                {canManage ? (
                                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                        <div className="grid gap-2 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end">
                                            <label className="block">
                                                <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Cambiar estado</span>
                                                <select
                                                    value={statusDraft}
                                                    onChange={(event) => setStatusDraft(event.target.value as PosApkReleaseStatus)}
                                                    disabled={updatingStatus}
                                                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-800"
                                                >
                                                    {Object.entries(releaseStatusLabels).map(([value, label]) => (
                                                        <option key={value} value={value}>{label}</option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label className="block">
                                                <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Nota de QA opcional</span>
                                                <input
                                                    value={statusNotes}
                                                    onChange={(event) => setStatusNotes(event.target.value)}
                                                    disabled={updatingStatus}
                                                    maxLength={2000}
                                                    placeholder="Resultado de pruebas o motivo del cambio"
                                                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800"
                                                />
                                            </label>
                                            <button
                                                type="button"
                                                onClick={() => void handleStatusUpdate()}
                                                disabled={updatingStatus || statusDraft === selectedRelease.release_status}
                                                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                                            >
                                                {updatingStatus ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                                                Actualizar
                                            </button>
                                        </div>
                                        {statusDraft === 'available' && selectedRelease.release_status !== 'available' ? (
                                            <p className="mt-2 text-[11px] font-bold text-emerald-700">Disponible habilita esta versión para el canal automático si tiene el mayor version code.</p>
                                        ) : null}
                                    </div>
                                ) : null}
                                <div className="flex flex-wrap gap-2">
                                    <a
                                        href={selectedDownloadUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white shadow-sm transition-colors hover:bg-blue-700"
                                    >
                                        <Download size={18} />
                                        Descarga técnica
                                    </a>
                                    <a
                                        href={selectedRelease.apk_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition-colors hover:bg-slate-50"
                                    >
                                        <ExternalLink size={18} />
                                        Abrir fuente
                                    </a>
                                    <CopyButton value={selectedDownloadUrl} label="Copiar enlace técnico" />
                                    {selectedRelease.is_latest ? (
                                        <a
                                            href={latestApkJsonUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50"
                                        >
                                            <Link size={14} />
                                            API
                                        </a>
                                    ) : null}
                                </div>
                                {selectedRelease.status_changed_at ? (
                                    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                                        Estado actualizado {formatDateTime(selectedRelease.status_changed_at)}
                                        {selectedStatusActor ? ` por ${selectedStatusActor.full_name}` : ''}
                                        {selectedRelease.status_change_notes ? ` · ${selectedRelease.status_change_notes}` : ''}
                                    </div>
                                ) : null}
                                <ReleaseDetails release={selectedRelease} />
                            </div>
                        </>
                    ) : (
                        <div className="flex min-h-[520px] flex-col items-center justify-center px-6 text-center text-slate-500">
                            <AlertTriangle className="mb-3 text-amber-500" size={28} />
                            <p className="text-sm font-bold">No hay un APK seleccionado.</p>
                            <p className="mt-1 text-xs">Usa el boton Nuevo para registrar la primera version.</p>
                        </div>
                    )}
                </div>
            </section>

            {canManage && isRegisterModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-2 backdrop-blur-sm">
                    <div className="my-3 w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-start justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
                            <div className="flex items-start gap-2.5">
                                <div className="shrink-0 rounded-lg bg-emerald-50 p-1.5 text-emerald-600">
                                    <PackageCheck size={18} />
                                </div>
                                <div>
                                    <h3 className="text-base font-black text-slate-900">Registrar APK</h3>
                                    <p className="text-xs font-medium text-slate-500 mt-0.5">Fuente externa: Google Drive o URL directa.</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={closeRegisterModal}
                                disabled={saving}
                                className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-200/50 hover:text-slate-700 disabled:opacity-50"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleSave} className="max-h-[78vh] space-y-3 overflow-y-auto p-4">
                            {errorMessage ? (
                                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800">
                                    {errorMessage}
                                </div>
                            ) : null}

                            <div className="grid gap-2.5 sm:grid-cols-2">
                                <label className="block">
                                    <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Version</span>
                                    <input
                                        required
                                        value={form.versionName}
                                        onChange={(event) => updateForm('versionName', event.target.value)}
                                        placeholder="1.0.616"
                                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                    />
                                </label>
                                <label className="block">
                                    <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Version code</span>
                                    <input
                                        required
                                        type="number"
                                        min="1"
                                        step="1"
                                        value={form.versionCode}
                                        onChange={(event) => updateForm('versionCode', event.target.value)}
                                        placeholder="616"
                                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                    />
                                </label>
                            </div>

                            <label className="block">
                                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">URL del APK</span>
                                <input
                                    required
                                    type="url"
                                    value={form.apkUrl}
                                    onChange={(event) => updateForm('apkUrl', event.target.value)}
                                    placeholder="https://drive.google.com/file/d/..."
                                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                />
                            </label>

                            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">URL de descarga</p>
                                <p className="mt-1 break-all font-mono text-xs text-slate-600">{previewDownloadUrl || 'Pendiente'}</p>
                            </div>

                            <div className="grid gap-2.5 sm:grid-cols-2">
                                <label className="block">
                                    <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Tipo</span>
                                    <select
                                        value={form.releaseType}
                                        onChange={(event) => updateForm('releaseType', event.target.value)}
                                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                    >
                                        {Object.entries(releaseTypeLabels).map(([value, label]) => (
                                            <option key={value} value={value}>{label}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="block">
                                    <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Estado</span>
                                    <select
                                        value={form.releaseStatus}
                                        onChange={(event) => updateForm('releaseStatus', event.target.value as PosApkReleaseStatus)}
                                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                    >
                                        {Object.entries(releaseStatusLabels).map(([value, label]) => (
                                            <option key={value} value={value}>{label}</option>
                                        ))}
                                    </select>
                                </label>
                            </div>

                            <label className="block">
                                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Resumen</span>
                                <textarea
                                    value={form.summary}
                                    onChange={(event) => updateForm('summary', event.target.value)}
                                    rows={2}
                                    placeholder="Que resuelve este APK y cuando debe instalarse"
                                    className="w-full resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                />
                            </label>

                            <div className="grid gap-2.5 md:grid-cols-2">
                                <label className="block">
                                    <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Soluciona bugs</span>
                                    <textarea
                                        value={form.bugsFixed}
                                        onChange={(event) => updateForm('bugsFixed', event.target.value)}
                                        rows={2}
                                        placeholder={'Un punto por linea\nEj: Corrige sincronizacion de ventas al cierre Z'}
                                        className="w-full resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                    />
                                </label>

                                <label className="block">
                                    <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Agrega funcionalidades</span>
                                    <textarea
                                        value={form.newFeatures}
                                        onChange={(event) => updateForm('newFeatures', event.target.value)}
                                        rows={2}
                                        placeholder={'Un punto por linea\nEj: Valida version superior al iniciar POS'}
                                        className="w-full resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                    />
                                </label>

                                <label className="block">
                                    <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Cambios internos</span>
                                    <textarea
                                        value={form.internalChanges}
                                        onChange={(event) => updateForm('internalChanges', event.target.value)}
                                        rows={2}
                                        placeholder={'Un punto por linea\nEj: Ajusta cola offline de sincronizacion'}
                                        className="w-full resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                    />
                                </label>

                                <label className="block">
                                    <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Checklist QA</span>
                                    <textarea
                                        value={form.validationChecklist}
                                        onChange={(event) => updateForm('validationChecklist', event.target.value)}
                                        rows={2}
                                        placeholder={'Un punto por linea\nLogin\nVenta contado\nCierre Z'}
                                        className="w-full resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                    />
                                </label>
                            </div>

                            <label className="block">
                                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Notas de instalacion</span>
                                <textarea
                                    value={form.installNotes}
                                    onChange={(event) => updateForm('installNotes', event.target.value)}
                                    rows={2}
                                    placeholder="Ej: Sincronizar antes de actualizar."
                                    className="w-full resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                />
                            </label>

                            <div className="grid gap-2.5 sm:grid-cols-2">
                                <label className="block">
                                    <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">SHA256</span>
                                    <input
                                        value={form.checksumSha256}
                                        onChange={(event) => updateForm('checksumSha256', event.target.value)}
                                        placeholder="Opcional"
                                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                    />
                                </label>
                                <label className="block">
                                    <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Clientes recomendados</span>
                                    <input
                                        value={form.rolloutScope}
                                        onChange={(event) => updateForm('rolloutScope', event.target.value)}
                                        placeholder="Todos / Solo DigiFact / Beta"
                                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                    />
                                </label>
                            </div>

                            <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">
                                Solo el estado Disponible habilita la actualización automática. Prueba interna y Beta permanecen accesibles mediante el enlace técnico.
                            </div>

                            <div className="flex flex-col-reverse justify-end gap-2 border-t border-slate-100 pt-3 sm:flex-row">
                                <button
                                    type="button"
                                    onClick={closeRegisterModal}
                                    disabled={saving}
                                    className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-black text-white shadow-sm transition-colors hover:bg-slate-800 disabled:opacity-60"
                                >
                                    {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                    {saving ? 'Guardando...' : 'Guardar APK'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
