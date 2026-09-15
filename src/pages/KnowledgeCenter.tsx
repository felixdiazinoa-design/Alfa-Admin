import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, ExternalLink, FileText, Link2, Loader2, Search, Trash2, Upload, Video } from 'lucide-react';
import {
    archiveKnowledgeResource,
    createKnowledgeLink,
    listKnowledgeResources,
    uploadKnowledgeResource,
    type KnowledgeProduct,
    type KnowledgeResource,
    type KnowledgeResourceType,
} from '../lib/knowledgeService';

const productLabels: Record<KnowledgeProduct, string> = {
    msmall: 'MSmall',
    clicpos: 'ClicPOS',
    erp: 'ERP',
    'cloud-admin': 'ALFA-Admin',
};

const typeLabels: Record<KnowledgeResourceType, string> = {
    manual: 'Manual',
    video: 'Video',
    link: 'Enlace',
};

const emptyForm = {
    product: 'msmall' as KnowledgeProduct,
    resourceType: 'manual' as KnowledgeResourceType,
    title: '',
    summary: '',
    externalUrl: '',
};

export const KnowledgeCenter: React.FC = () => {
    const [resources, setResources] = useState<KnowledgeResource[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [form, setForm] = useState(emptyForm);
    const [file, setFile] = useState<File | null>(null);
    const [search, setSearch] = useState('');
    const [productFilter, setProductFilter] = useState<'all' | KnowledgeProduct>('all');
    const [typeFilter, setTypeFilter] = useState<'all' | KnowledgeResourceType>('all');

    const loadResources = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await listKnowledgeResources();
            setResources(response.resources);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar la biblioteca.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadResources();
    }, []);

    const visibleResources = useMemo(() => {
        const needle = search.trim().toLocaleLowerCase('es');
        return resources.filter((resource) => {
            const productMatches = productFilter === 'all' || resource.product === productFilter;
            const typeMatches = typeFilter === 'all' || resource.resource_type === typeFilter;
            const textMatches = !needle || `${resource.title} ${resource.summary || ''} ${resource.file_name || ''}`.toLocaleLowerCase('es').includes(needle);
            return productMatches && typeMatches && textMatches;
        });
    }, [productFilter, resources, search, typeFilter]);

    const saveResource = async (event: React.FormEvent) => {
        event.preventDefault();
        setSaving(true);
        setError(null);
        setNotice(null);
        try {
            if (form.resourceType === 'link') {
                await createKnowledgeLink({
                    product: form.product,
                    title: form.title,
                    summary: form.summary,
                    externalUrl: form.externalUrl,
                });
            } else {
                if (!file) throw new Error('Selecciona el archivo que deseas subir.');
                await uploadKnowledgeResource({
                    product: form.product,
                    resourceType: form.resourceType,
                    title: form.title,
                    summary: form.summary,
                    file,
                });
            }
            setForm(emptyForm);
            setFile(null);
            setNotice('Recurso publicado correctamente.');
            await loadResources();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'No se pudo publicar el recurso.');
        } finally {
            setSaving(false);
        }
    };

    const archiveResource = async (resource: KnowledgeResource) => {
        if (!confirm(`Archivar "${resource.title}"?`)) return;
        try {
            await archiveKnowledgeResource(resource.id);
            setResources((current) => current.filter((item) => item.id !== resource.id));
        } catch (archiveError) {
            setError(archiveError instanceof Error ? archiveError.message : 'No se pudo archivar el recurso.');
        }
    };

    return (
        <div className="min-h-full bg-slate-50">
            <header className="border-b border-slate-200 bg-white px-8 py-6">
                <p className="text-xs font-black uppercase tracking-[0.24em] text-indigo-600">Conocimiento interno</p>
                <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <h1 className="text-2xl font-black text-slate-900">Manuales y videos</h1>
                        <p className="mt-1 text-sm text-slate-500">Documentación centralizada de MSmall, ALFA-RMS POS, ALFA-RMS y ALFA-Admin.</p>
                    </div>
                    <div className="flex gap-2">
                        <Metric label="Recursos" value={resources.length} />
                        <Metric label="Videos" value={resources.filter((resource) => resource.resource_type === 'video').length} />
                    </div>
                </div>
            </header>

            <div className="grid gap-6 p-8 xl:grid-cols-[380px_1fr]">
                <form onSubmit={saveResource} className="h-fit space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div>
                        <h2 className="font-black text-slate-900">Publicar recurso</h2>
                        <p className="mt-1 text-xs text-slate-500">Sube un documento, video o agrega un enlace externo.</p>
                    </div>
                    <Field label="Producto">
                        <select value={form.product} onChange={(event) => setForm({ ...form, product: event.target.value as KnowledgeProduct })} className="input">
                            {Object.entries(productLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                    </Field>
                    <Field label="Tipo">
                        <select value={form.resourceType} onChange={(event) => { setForm({ ...form, resourceType: event.target.value as KnowledgeResourceType }); setFile(null); }} className="input">
                            <option value="manual">Manual o documento</option>
                            <option value="video">Video</option>
                            <option value="link">Enlace externo</option>
                        </select>
                    </Field>
                    <Field label="Título">
                        <input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="input" placeholder="Configuración inicial de facturación" />
                    </Field>
                    <Field label="Descripción">
                        <textarea value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} className="input min-h-[90px] resize-y" placeholder="Qué resuelve y cuándo consultar este recurso" />
                    </Field>
                    {form.resourceType === 'link' ? (
                        <Field label="URL">
                            <input required type="url" value={form.externalUrl} onChange={(event) => setForm({ ...form, externalUrl: event.target.value })} className="input" placeholder="https://..." />
                        </Field>
                    ) : (
                        <label className="block rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-4 text-center hover:border-indigo-300">
                            <Upload className="mx-auto text-indigo-500" size={24} />
                            <span className="mt-2 block text-xs font-black text-slate-700">{file?.name || 'Seleccionar archivo'}</span>
                            <span className="mt-1 block text-[11px] text-slate-400">PDF, DOCX, MP4, WebM o MOV · máximo 250 MB</span>
                            <input
                                required
                                type="file"
                                accept={form.resourceType === 'video' ? 'video/mp4,video/webm,video/quicktime' : 'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document'}
                                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                                className="sr-only"
                            />
                        </label>
                    )}
                    {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p> : null}
                    {notice ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{notice}</p> : null}
                    <button disabled={saving} type="submit" className="btn-primary w-full justify-center">
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                        {saving ? 'Publicando…' : 'Publicar'}
                    </button>
                </form>

                <section className="min-w-0">
                    <div className="mb-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm md:grid-cols-[1fr_180px_160px]">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                            <input value={search} onChange={(event) => setSearch(event.target.value)} className="input pl-9" placeholder="Buscar manual, tema o archivo" />
                        </div>
                        <select value={productFilter} onChange={(event) => setProductFilter(event.target.value as 'all' | KnowledgeProduct)} className="input">
                            <option value="all">Todos los productos</option>
                            {Object.entries(productLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as 'all' | KnowledgeResourceType)} className="input">
                            <option value="all">Todos los tipos</option>
                            <option value="manual">Manuales</option>
                            <option value="video">Videos</option>
                            <option value="link">Enlaces</option>
                        </select>
                    </div>

                    {loading ? (
                        <div className="flex min-h-[260px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-500"><Loader2 className="animate-spin" size={18} />Cargando biblioteca…</div>
                    ) : visibleResources.length === 0 ? (
                        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-center">
                            <BookOpen size={36} className="text-slate-300" />
                            <p className="mt-3 font-black text-slate-700">No hay recursos con estos filtros</p>
                        </div>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                            {visibleResources.map((resource) => <ResourceCard key={resource.id} resource={resource} onArchive={archiveResource} />)}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
};

function ResourceCard({ resource, onArchive }: { resource: KnowledgeResource; onArchive: (resource: KnowledgeResource) => void }) {
    const Icon = resource.resource_type === 'video' ? Video : resource.resource_type === 'link' ? Link2 : FileText;
    return (
        <article className="flex min-h-[220px] flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex items-start justify-between gap-3">
                <div className="rounded-xl bg-indigo-50 p-3 text-indigo-600"><Icon size={22} /></div>
                <button type="button" onClick={() => onArchive(resource)} className="rounded-lg p-2 text-slate-300 hover:bg-rose-50 hover:text-rose-600" title="Archivar"><Trash2 size={15} /></button>
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5 text-[10px] font-black uppercase">
                <span className="rounded-full bg-indigo-100 px-2 py-1 text-indigo-700">{productLabels[resource.product]}</span>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">{typeLabels[resource.resource_type]}</span>
            </div>
            <h3 className="mt-3 line-clamp-2 font-black text-slate-900">{resource.title}</h3>
            <p className="mt-2 line-clamp-3 flex-1 text-sm leading-relaxed text-slate-500">{resource.summary || resource.file_name || 'Sin descripción.'}</p>
            {resource.access_url ? (
                <a href={resource.access_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white hover:bg-indigo-700">
                    Consultar <ExternalLink size={13} />
                </a>
            ) : <span className="mt-4 text-xs font-bold text-amber-600">Archivo temporalmente no disponible</span>}
        </article>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return <label className="block"><span className="mb-1 block text-xs font-black uppercase tracking-wider text-slate-500">{label}</span>{children}</label>;
}

function Metric({ label, value }: { label: string; value: number }) {
    return <div className="min-w-[92px] rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-2 text-indigo-800"><p className="text-[10px] font-black uppercase">{label}</p><p className="text-xl font-black">{value}</p></div>;
}
