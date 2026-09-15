import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, Lightbulb, Loader2, Plus, Search, UserRound, Users, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
    createInternalRequest, listInternalRequests, updateInternalRequest,
    type InternalRequestOrigin, type InternalRequestPriority, type InternalRequestProduct,
    type InternalRequestStatus, type InternalRequestType, type InternalRequestUser, type InternalWorkRequest,
} from '../lib/internalRequestService';

const productLabels: Record<InternalRequestProduct, string> = { msmall: 'MSmall', clicpos: 'ALFA-RMS POS', erp: 'ALFA-RMS', 'cloud-admin': 'ALFA-Admin', general: 'General' };
const statusLabels: Record<InternalRequestStatus, string> = { new: 'Nueva', under_review: 'Por verificar', approved: 'Aceptada', in_progress: 'En progreso', completed: 'Completada', rejected: 'Rechazada' };
const statusStyles: Record<InternalRequestStatus, string> = {
    new: 'border-blue-200 bg-blue-50 text-blue-700', under_review: 'border-amber-200 bg-amber-50 text-amber-700',
    approved: 'border-emerald-200 bg-emerald-50 text-emerald-700', in_progress: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    completed: 'border-teal-200 bg-teal-50 text-teal-700', rejected: 'border-slate-200 bg-slate-100 text-slate-500',
};
const priorityStyles: Record<InternalRequestPriority, string> = { Baja: 'bg-slate-100 text-slate-600', Media: 'bg-blue-50 text-blue-700', Alta: 'bg-amber-50 text-amber-700', Critica: 'bg-rose-50 text-rose-700' };
const originLabels: Record<InternalRequestOrigin, string> = { internal: 'Interna', email: 'Email cliente', erp: 'ERP', helpdesk_manual: 'HelpDesk manual', helpdesk_automatic: 'HelpDesk automático' };
type ScopeFilter = 'all' | 'internal' | 'customer' | 'problem' | 'improvement';

const emptyForm = { requestType: 'problem' as InternalRequestType, product: 'cloud-admin' as InternalRequestProduct, priority: 'Media' as InternalRequestPriority, title: '', description: '' };

function normalizeRelation<T>(value: T | T[] | null | undefined) { return Array.isArray(value) ? value[0] ?? null : value ?? null; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }).format(date); }
function isCustomerRequest(request: InternalWorkRequest) { return request.origin !== 'internal' || Boolean(request.ticket_id || request.tenant_id || request.contact_id); }
function customerLabel(request: InternalWorkRequest) { const tenant = normalizeRelation(request.tenant); const contact = normalizeRelation(request.contact); return tenant?.name || contact?.company_name || contact?.name || contact?.email || null; }

export const InternalRequests: React.FC<{ canManage: boolean }> = ({ canManage }) => {
    const [requests, setRequests] = useState<InternalWorkRequest[]>([]);
    const [users, setUsers] = useState<InternalRequestUser[]>([]);
    const [form, setForm] = useState(emptyForm);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
    const [statusFilter, setStatusFilter] = useState<'all' | InternalRequestStatus>('all');
    const [productFilter, setProductFilter] = useState<'all' | InternalRequestProduct>('all');
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
    const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});

    const load = async () => {
        setLoading(true);
        try {
            const response = await listInternalRequests();
            setRequests(response.requests); setUsers(response.users);
            setNotesDraft(Object.fromEntries(response.requests.map((request) => [request.id, request.decision_notes ?? ''])));
            setError(null);
        } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar las solicitudes.'); }
        finally { setLoading(false); }
    };
    useEffect(() => { void load(); }, []);

    const stats = useMemo(() => ({
        total: requests.length,
        pending: requests.filter((request) => !['completed', 'rejected'].includes(request.status)).length,
        customers: requests.filter(isCustomerRequest).length,
        ai: requests.filter((request) => request.detected_by_ai).length,
    }), [requests]);

    const visibleRequests = useMemo(() => {
        const needle = search.trim().toLocaleLowerCase('es');
        return requests.filter((request) => {
            const scopeMatches = scopeFilter === 'all'
                || (scopeFilter === 'internal' && !isCustomerRequest(request))
                || (scopeFilter === 'customer' && isCustomerRequest(request))
                || (scopeFilter === 'problem' && request.request_type === 'problem')
                || (scopeFilter === 'improvement' && request.request_type === 'improvement');
            const text = [request.request_number, request.title, request.description, request.ai_summary, request.requested_capability, request.affected_module, customerLabel(request)].filter(Boolean).join(' ').toLocaleLowerCase('es');
            return scopeMatches && (statusFilter === 'all' || request.status === statusFilter) && (productFilter === 'all' || request.product === productFilter) && (!needle || text.includes(needle));
        });
    }, [productFilter, requests, scopeFilter, search, statusFilter]);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault(); setSaving(true); setError(null); setNotice(null);
        try { await createInternalRequest({ ...form, sourcePage: window.location.hash }); setForm(emptyForm); setNotice('Solicitud registrada para verificación.'); setIsCreateOpen(false); await load(); }
        catch (submitError) { setError(submitError instanceof Error ? submitError.message : 'No se pudo registrar la solicitud.'); }
        finally { setSaving(false); }
    };

    const update = async (requestId: string, fields: { status?: InternalRequestStatus; priority?: InternalRequestPriority; assignedTo?: string | null; decisionNotes?: string }) => {
        setSavingId(requestId);
        try { await updateInternalRequest(requestId, fields); await load(); }
        catch (updateError) { setError(updateError instanceof Error ? updateError.message : 'No se pudo actualizar la solicitud.'); }
        finally { setSavingId(null); }
    };

    return <div className="min-h-full bg-slate-50 p-4 sm:p-6 xl:p-8">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div><p className="text-[11px] font-black uppercase tracking-[0.22em] text-indigo-600">Gestión unificada</p><h1 className="mt-1.5 text-2xl font-black text-slate-900">Solicitudes</h1><p className="mt-1 text-sm text-slate-500">Problemas internos y mejoras solicitadas por clientes en un solo flujo.</p></div>
            {canManage ? <button type="button" onClick={() => { setError(null); setNotice(null); setIsCreateOpen(true); }} className="btn-primary self-start xl:self-auto"><Plus size={16} />Nueva solicitud</button> : null}
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Total" value={stats.total} className="border-slate-200 bg-white text-slate-900" />
            <Stat label="Pendientes" value={stats.pending} className="border-amber-100 bg-amber-50 text-amber-700" />
            <Stat label="De clientes" value={stats.customers} className="border-indigo-100 bg-indigo-50 text-indigo-700" />
            <Stat label="Detectadas por IA" value={stats.ai} className="border-violet-100 bg-violet-50 text-violet-700" />
        </div>
        {error && !isCreateOpen ? <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p> : null}
        {notice ? <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{notice}</p> : null}

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-3">
                <div className="mb-3 flex max-w-full gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1">
                    {([['all', 'Todas'], ['internal', 'Internas'], ['customer', 'Clientes'], ['problem', 'Problemas'], ['improvement', 'Mejoras']] as Array<[ScopeFilter, string]>).map(([value, label]) => <button key={value} type="button" onClick={() => setScopeFilter(value)} className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-black ${scopeFilter === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{label}</button>)}
                </div>
                <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_180px_180px]">
                    <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} className="input py-2 pl-9 text-xs" placeholder="Buscar por número, cliente, módulo o detalle" /></div>
                    <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | InternalRequestStatus)} className="input py-2 text-xs"><option value="all">Todos los estados</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                    <select value={productFilter} onChange={(event) => setProductFilter(event.target.value as 'all' | InternalRequestProduct)} className="input py-2 text-xs"><option value="all">Todos los productos</option>{Object.entries(productLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                </div>
            </div>
            {loading ? <div className="flex min-h-52 items-center justify-center gap-2 text-sm font-bold text-slate-500"><Loader2 className="animate-spin" size={18} />Cargando solicitudes…</div> : null}
            {!loading && visibleRequests.length === 0 ? <div className="flex min-h-52 flex-col items-center justify-center"><CheckCircle2 size={32} className="text-slate-300" /><p className="mt-2 text-sm font-black text-slate-700">No hay solicitudes con estos filtros</p></div> : null}
            {!loading && visibleRequests.length > 0 ? <div className="overflow-x-auto"><table className="w-full min-w-[1180px] border-collapse text-left"><thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500"><tr><th className="w-[34%] px-4 py-2.5">Solicitud</th><th className="px-3 py-2.5">Origen</th><th className="px-3 py-2.5">Producto</th><th className="px-3 py-2.5">Prioridad</th><th className="w-40 px-3 py-2.5">Estado</th><th className="w-48 px-3 py-2.5">Responsable</th><th className="px-4 py-2.5">Reportada</th></tr></thead><tbody className="divide-y divide-slate-100">
                {visibleRequests.map((request) => {
                    const reporter = normalizeRelation(request.reporter); const assignee = normalizeRelation(request.assignee); const ticket = normalizeRelation(request.ticket); const customer = customerLabel(request); const isExpanded = expandedRequestId === request.id; const isSaving = savingId === request.id;
                    return <React.Fragment key={request.id}>
                        <tr className={`align-middle transition-colors hover:bg-slate-50/80 ${isExpanded ? 'bg-indigo-50/30' : ''}`}>
                            <td className="px-4 py-3"><div className="flex items-start gap-2.5"><span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${request.request_type === 'problem' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}`}>{request.request_type === 'problem' ? <AlertTriangle size={14} /> : <Lightbulb size={14} />}</span><div className="min-w-0"><div className="flex items-center gap-2"><span className="text-[10px] font-black text-slate-400">#{request.request_number}</span>{request.detected_by_ai ? <Bot size={13} className="text-violet-500" aria-label="Detectada por IA" /> : null}<span className="text-sm font-black text-slate-900">{request.title}</span></div><p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{request.ai_summary || request.description}</p><button type="button" aria-expanded={isExpanded} aria-controls={`request-detail-${request.id}`} onClick={() => setExpandedRequestId(isExpanded ? null : request.id)} className="mt-1 inline-flex items-center gap-1 text-[11px] font-black text-indigo-600 hover:text-indigo-800">{isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}{isExpanded ? 'Ocultar detalle' : 'Ver detalle'}</button></div></div></td>
                            <td className="px-3 py-3"><span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-700">{originLabels[request.origin]}</span>{customer ? <p className="mt-1 max-w-32 truncate text-[10px] font-bold text-indigo-600" title={customer}>{customer}</p> : null}</td>
                            <td className="px-3 py-3"><span className="rounded-md bg-indigo-50 px-2 py-1 text-[11px] font-bold text-indigo-700">{productLabels[request.product]}</span>{request.affected_module ? <p className="mt-1 max-w-28 truncate text-[10px] text-slate-400" title={request.affected_module}>{request.affected_module}</p> : null}</td>
                            <td className="px-3 py-3"><select aria-label={`Prioridad de ${request.title}`} disabled={!canManage || isSaving} value={request.priority} onChange={(event) => void update(request.id, { priority: event.target.value as InternalRequestPriority })} className={`rounded-md border-0 px-2 py-1 text-[11px] font-black disabled:cursor-default ${priorityStyles[request.priority]}`}>{(['Baja', 'Media', 'Alta', 'Critica'] as InternalRequestPriority[]).map((priority) => <option key={priority}>{priority}</option>)}</select></td>
                            <td className="px-3 py-3"><select aria-label={`Estado de ${request.title}`} disabled={!canManage || isSaving} value={request.status} onChange={(event) => void update(request.id, { status: event.target.value as InternalRequestStatus })} className={`w-full rounded-lg border px-2 py-1.5 text-[11px] font-bold disabled:cursor-default ${statusStyles[request.status]}`}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                            <td className="px-3 py-3"><select aria-label={`Responsable de ${request.title}`} disabled={!canManage || isSaving} value={assignee?.id || ''} onChange={(event) => void update(request.id, { assignedTo: event.target.value || null })} className="input py-1.5 text-[11px] disabled:cursor-default"><option value="">Sin asignar</option>{users.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}</select></td>
                            <td className="px-4 py-3"><p className="flex items-center gap-1 text-xs font-bold text-slate-700">{reporter ? <UserRound size={12} /> : <Users size={12} />}{reporter?.full_name || customer || 'Automática'}</p><p className="mt-0.5 text-[10px] text-slate-400">{formatDate(request.created_at)}</p></td>
                        </tr>
                        {isExpanded ? <tr id={`request-detail-${request.id}`} className="bg-indigo-50/30"><td colSpan={7} className="px-4 pb-4 pt-0"><div className="ml-9 grid gap-3 rounded-lg border border-indigo-100 bg-white p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_320px]">
                            <div className="space-y-3"><Detail label="Descripción completa" value={request.description} />{request.requested_capability && request.requested_capability !== request.description ? <Detail label="Capacidad solicitada" value={request.requested_capability} /> : null}{request.customer_impact ? <Detail label="Impacto en el cliente" value={request.customer_impact} tone="amber" /> : null}</div>
                            <div className="space-y-3"><div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600"><p className="font-black text-slate-800">{customer || originLabels[request.origin]}</p>{ticket ? <><p className="mt-1">Ticket #{ticket.ticket_number ?? ticket.id.slice(0, 8)} · {ticket.subject || 'Sin asunto'}</p><Link to="/support" className="mt-2 inline-flex items-center gap-1 font-black text-indigo-700">Ver HelpDesk <ExternalLink size={12} /></Link></> : null}{typeof request.ai_confidence === 'number' ? <p className="mt-2 font-bold text-violet-600">{Math.round(request.ai_confidence * 100)}% confianza IA</p> : null}</div><label className="block"><span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Notas de decisión</span><textarea disabled={!canManage} value={notesDraft[request.id] ?? ''} onChange={(event) => setNotesDraft((current) => ({ ...current, [request.id]: event.target.value }))} className="input min-h-24 resize-y text-xs disabled:cursor-default disabled:bg-slate-50" placeholder="Alcance, decisión o motivo de rechazo…" /></label>{canManage ? <button type="button" disabled={isSaving} onClick={() => void update(request.id, { decisionNotes: notesDraft[request.id] ?? '' })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60">{isSaving ? 'Guardando…' : 'Guardar notas'}</button> : null}</div>
                        </div></td></tr> : null}
                    </React.Fragment>;
                })}
            </tbody></table></div> : null}
        </section>

        {canManage && isCreateOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="new-request-title"><div className="my-4 w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-slate-100 bg-slate-50 px-4 py-3"><div><h2 id="new-request-title" className="font-black text-slate-900">Nueva solicitud</h2><p className="mt-0.5 text-xs text-slate-500">Documenta el hallazgo para asignarlo y darle seguimiento.</p></div><button type="button" onClick={() => setIsCreateOpen(false)} disabled={saving} className="rounded-lg p-1 text-slate-400 hover:bg-slate-200"><X size={19} /></button></div><form onSubmit={submit} className="max-h-[80vh] space-y-3 overflow-y-auto p-4"><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setForm({ ...form, requestType: 'problem' })} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-black ${form.requestType === 'problem' ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-600'}`}><AlertTriangle size={16} />Problema</button><button type="button" onClick={() => setForm({ ...form, requestType: 'improvement' })} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-black ${form.requestType === 'improvement' ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-600'}`}><Lightbulb size={16} />Mejora</button></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Producto"><select value={form.product} onChange={(event) => setForm({ ...form, product: event.target.value as InternalRequestProduct })} className="input py-2 text-xs">{Object.entries(productLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="Prioridad"><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as InternalRequestPriority })} className="input py-2 text-xs">{(['Baja', 'Media', 'Alta', 'Critica'] as InternalRequestPriority[]).map((priority) => <option key={priority}>{priority}</option>)}</select></Field></div><Field label="Título"><input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="input py-2 text-xs" placeholder="Qué se detectó" /></Field><Field label="Detalle y cómo reproducirlo"><textarea required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="input min-h-28 resize-y text-xs" placeholder="Describe el problema, impacto o mejora propuesta…" /></Field>{error ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p> : null}<div className="flex justify-end gap-2 border-t border-slate-100 pt-3"><button type="button" onClick={() => setIsCreateOpen(false)} disabled={saving} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">Cancelar</button><button disabled={saving} type="submit" className="btn-primary justify-center">{saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}Registrar solicitud</button></div></form></div></div> : null}
    </div>;
};

function Stat({ label, value, className }: { label: string; value: number; className: string }) { return <div className={`rounded-xl border p-3 shadow-sm ${className}`}><p className="text-[10px] font-black uppercase tracking-wider opacity-70">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></div>; }
function Detail({ label, value, tone = 'slate' }: { label: string; value: string; tone?: 'slate' | 'amber' }) { return <div className={`rounded-lg border p-3 ${tone === 'amber' ? 'border-amber-100 bg-amber-50 text-amber-900' : 'border-slate-100 bg-slate-50 text-slate-700'}`}><p className="text-[10px] font-black uppercase tracking-wider opacity-60">{label}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{value}</p></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1 block text-xs font-black uppercase tracking-wider text-slate-500">{label}</span>{children}</label>; }
