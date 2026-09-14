import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle,
    BarChart3,
    BatteryLow,
    Bell,
    Bot,
    Building2,
    CheckCircle2,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Clock3,
    ExternalLink,
    FileText,
    Filter,
    Focus,
    Forward,
    GitMerge,
    Image as ImageIcon,
    Lightbulb,
    Loader2,
    Mail,
    MessageSquare,
    MonitorSmartphone,
    Paperclip,
    PanelRightClose,
    PanelRightOpen,
    RefreshCw,
    ReplyAll,
    Search,
    Send,
    Sparkles,
    StickyNote,
    Tag,
    Trash2,
    UserPlus,
    Users,
    Wand2,
    WifiOff,
    X,
} from 'lucide-react';
import { authorizeAdminRealtime, supabase } from '../lib/supabase';
import {
    addPrivateHelpdeskNote,
    addPublicHelpdeskReply,
    assignPendingHelpdeskTicketsWithCopilot,
    bulkUpdateHelpdeskTickets,
    createHelpdeskImprovement,
    createPreventiveHelpdeskTicket,
    deleteHelpdeskTickets,
    fetchHelpdeskBootstrap,
    fetchHelpdeskAssignmentDashboard,
    fetchHelpdeskTicketSnapshot,
    fetchSupportMessages,
    generateHelpdeskDraft,
    heartbeatHelpdeskTicket,
    loadHelpdeskWorkspace,
    markHelpdeskTicketRead,
    markHelpdeskTicketsAsSpam,
    mergeHelpdeskTickets,
    resolveHelpdeskTicket,
    restoreHelpdeskSpamTickets,
    saveHelpdeskContact,
    saveHelpdeskDraft,
    sendHelpdeskReply,
    updateHelpdeskTicket,
    updateHelpdeskAssignmentSettings,
    uploadHelpdeskAttachments,
    type HelpdeskAgentOption,
    type HelpdeskAssignmentDashboard,
    type HelpdeskAssignmentDashboardTicket,
    type HelpdeskAssignmentMode,
    type HelpdeskPresence,
    type HelpdeskReplyMode,
    type HelpdeskReplyTemplate,
    type HelpdeskTeamOption,
    type HelpdeskTicketUnreadState,
} from '../lib/helpdeskService';
import {
    getHelpdeskCompanyName,
    getHelpdeskLastActivityAt,
    sortHelpdeskTickets,
    UNKNOWN_HELPDESK_COMPANY,
    type HelpdeskTicketSortKey,
} from '../lib/helpdeskTicketOrganization';

const REPLY_TEXTAREA_MAX_HEIGHT = 240;
const MAX_REPLY_ATTACHMENTS = 4;
const MAX_REPLY_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_REPLY_IMAGE_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
]);

type Sentiment = 'frustrated' | 'neutral' | 'positive';
type ImprovementPriority = 'Baja' | 'Media' | 'Alta' | 'Critica';

interface TechnicalContext {
    app_version?: string;
    battery_level?: string;
    network_type?: string;
    last_5_errors?: string[];
    [key: string]: string | string[] | undefined;
}

interface SupportContact {
    id: string;
    email: string;
    name?: string | null;
    company_name?: string | null;
    phone?: string | null;
    tenant_id?: string | null;
    has_retainership?: boolean | null;
    administrative_notes?: string | null;
    store_created_at?: string | null;
    service_started_at?: string | null;
    renewal_at?: string | null;
    last_suspended_at?: string | null;
    customer_services?: Array<{
        id: string;
        service_name: string;
        quantity: number;
        status: string;
        renewal_at?: string | null;
        next_charge_at?: string | null;
        additional_charge?: number | null;
        scheduled_action?: string | null;
        scheduled_action_at?: string | null;
    }> | null;
    metadata?: {
        sla?: string;
        [key: string]: unknown;
    } | null;
}

interface AiTicketInsight {
    sentiment?: Sentiment | null;
    sentiment_score?: number | null;
    summary?: string | null;
    suggested_replies?: string[] | null;
    confidence?: number | null;
    next_best_action?: string | null;
    urgency_reason?: string | null;
    affected_module?: string | null;
    detected_contact_name?: string | null;
    detected_company?: string | null;
    detected_phone?: string | null;
    detected_identifiers?: string[] | null;
    incident_fingerprint?: string | null;
    duplicate_signal?: boolean | null;
    ai_tags?: string[] | null;
    classification_confidence?: number | null;
    response_confidence?: number | null;
    autonomy_action?: 'observe' | 'draft' | 'auto_reply' | 'acknowledge' | 'escalate' | null;
    autonomy_reasons?: string[] | null;
    knowledge_sources?: Array<{ id?: string; module?: string; title?: string; source_path?: string | null }> | null;
    auto_reply_sent_at?: string | null;
}

interface Ticket {
    id: string;
    ticket_number?: number | null;
    tenant_id?: string | null;
    tenant_name: string;
    contact?: SupportContact | null;
    category: string;
    priority: string;
    status: string;
    resolution_status?: 'open' | 'pending_customer_confirmation' | 'closed' | 'reopened' | null;
    customer_rating?: number | null;
    subject: string;
    source: string;
    assignment_status?: string | null;
    external_sender_email?: string | null;
    technical_context: TechnicalContext;
    tags?: string[];
    assignee_id?: string | null;
    team_id?: string | null;
    assignee?: HelpdeskAgentOption | null;
    support_team?: HelpdeskTeamOption | null;
    last_delivery_status?: string | null;
    last_delivery_error?: string | null;
    merged_into_ticket_id?: string | null;
    created_at: string;
    updated_at?: string | null;
    is_unread?: boolean;
    last_customer_message_at?: string | null;
    last_read_at?: string | null;
    insight?: AiTicketInsight | null;
}

interface Message {
    id: string;
    sender_type: 'Admin' | 'Client' | 'System';
    message: string;
    attachments?: unknown;
    visibility?: 'public' | 'private';
    message_kind?: string;
    delivery_status?: string | null;
    delivery_attempts?: number;
    delivery_error?: string | null;
    cc?: string[];
    bcc?: string[];
    created_at: string;
}

interface MessageAttachment {
    id?: string;
    name?: string;
    mime_type?: string;
    size_bytes?: number;
    bucket?: string;
    path?: string;
    uploaded_at?: string;
    signed_url?: string | null;
    status?: string;
    error?: string;
}

interface PendingReplyAttachment {
    id: string;
    file: File;
    previewUrl: string;
}

interface ContactFormState {
    name: string;
    phone: string;
    email: string;
    companyName: string;
    sla: string;
}

interface ImprovementDraft {
    title: string;
    requestedCapability: string;
    affectedModule: string;
    customerImpact: string;
    priority: ImprovementPriority;
}

interface TicketRow extends Omit<Ticket, 'tenant_name' | 'contact' | 'insight' | 'assignee' | 'support_team'> {
    tenants?: { name?: string | null } | { name?: string | null }[] | null;
    support_contacts?: SupportContact | SupportContact[] | null;
    ai_ticket_insights?: AiTicketInsight | AiTicketInsight[] | null;
    assignee?: HelpdeskAgentOption | HelpdeskAgentOption[] | null;
    support_team?: HelpdeskTeamOption | HelpdeskTeamOption[] | null;
}

interface TicketMessagePreview {
    message: string;
    sender_type: Message['sender_type'];
    created_at: string;
}

const statusFilters = ['Todos', 'Abierto', 'En_Proceso', 'Cerrado'];
const sourceFilters = ['Todos', 'POS', 'ERP', 'Email', 'Preventivo'];
const ticketSortOptions: Array<{ value: HelpdeskTicketSortKey; label: string }> = [
    { value: 'activity_desc', label: 'Última actividad' },
    { value: 'ticket_desc', label: 'Ticket: mayor a menor' },
    { value: 'ticket_asc', label: 'Ticket: menor a mayor' },
    { value: 'created_desc', label: 'Fecha: más recientes' },
    { value: 'created_asc', label: 'Fecha: más antiguos' },
    { value: 'company_asc', label: 'Empresa: A–Z' },
    { value: 'company_desc', label: 'Empresa: Z–A' },
    { value: 'priority_desc', label: 'Prioridad' },
];

const sourceStyles: Record<string, string> = {
    Email: 'bg-violet-50 text-violet-700 border-violet-200',
    POS: 'bg-blue-50 text-blue-700 border-blue-200',
    ERP: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    Preventivo: 'bg-amber-50 text-amber-700 border-amber-200',
};

const emptyContactForm: ContactFormState = {
    name: '',
    phone: '',
    email: '',
    companyName: '',
    sla: 'standard',
};

const initialImprovementDraft: ImprovementDraft = {
    title: '',
    requestedCapability: '',
    affectedModule: '',
    customerImpact: '',
    priority: 'Media',
};

const slaLabels: Record<string, string> = {
    standard: 'Estándar',
    priority: 'Prioritario',
    critical: 'Crítico',
};

const resolutionStatusLabels: Record<string, string> = {
    pending_customer_confirmation: 'Esperando confirmacion',
    closed: 'Cerrado por cliente',
    reopened: 'Reabierto por cliente',
};

const resolutionStatusStyles: Record<string, string> = {
    pending_customer_confirmation: 'border-amber-200 bg-amber-50 text-amber-700',
    closed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    reopened: 'border-red-200 bg-red-50 text-red-700',
};

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
}

function mapTicketRow(ticket: TicketRow): Ticket {
    return {
        ...ticket,
        source: ticket.source || 'POS',
        tenant_name: normalizeRelation(ticket.tenants)?.name || 'Sin tenant asignado',
        contact: normalizeRelation(ticket.support_contacts),
        insight: normalizeRelation(ticket.ai_ticket_insights),
        assignee: normalizeRelation(ticket.assignee),
        support_team: normalizeRelation(ticket.support_team),
        technical_context: ticket.technical_context || {},
    };
}

function applyUnreadState(ticket: Ticket, unreadState?: HelpdeskTicketUnreadState | null): Ticket {
    return {
        ...ticket,
        is_unread: unreadState?.is_unread ?? false,
        last_customer_message_at: unreadState?.last_customer_message_at ?? null,
        last_read_at: unreadState?.last_read_at ?? null,
    };
}

function serializeDraft(input: {
    body: string;
    mode: HelpdeskReplyMode;
    cc: string[];
    bcc: string[];
    forwardTo: string;
}) {
    return JSON.stringify(input);
}

function formatTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('es-DO', {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function formatDuration(startValue: string, endValue?: string) {
    const start = new Date(startValue).getTime();
    const end = endValue ? new Date(endValue).getTime() : Date.now();
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 'N/D';

    const totalMinutes = Math.max(0, Math.floor((end - start) / 60_000));
    if (totalMinutes < 60) return `${totalMinutes} min`;

    const totalHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (totalHours < 24) return minutes ? `${totalHours} h ${minutes} min` : `${totalHours} h`;

    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return hours ? `${days} d ${hours} h` : `${days} d`;
}

function formatStatusLabel(status: string) {
    return status.replace(/_/g, ' ');
}

function truncatePreview(value: string, maxLength = 110) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

function renderHighlightedText(value: string, query: string) {
    const needle = query.trim();
    if (!needle) return value;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = value.split(new RegExp(`(${escaped})`, 'gi'));
    return parts.map((part, index) => part.toLocaleLowerCase('es') === needle.toLocaleLowerCase('es')
        ? <mark key={`${part}-${index}`} className="rounded bg-yellow-200 px-0.5 text-inherit">{part}</mark>
        : part);
}

function getSenderPreviewLabel(senderType: Message['sender_type']) {
    if (senderType === 'Admin') return 'Soporte';
    if (senderType === 'System') return 'Sistema';
    return 'Cliente';
}

function buildLatestMessagePreviewMap(rows: Array<{ ticket_id?: string | null; message?: string | null; sender_type?: string | null; created_at?: string | null }>) {
    const previewMap: Record<string, TicketMessagePreview> = {};

    for (const row of rows) {
        const ticketId = String(row.ticket_id || '').trim();
        if (!ticketId || previewMap[ticketId]) continue;

        previewMap[ticketId] = {
            message: String(row.message || '').trim(),
            sender_type: (row.sender_type === 'Admin' || row.sender_type === 'System' ? row.sender_type : 'Client') as Message['sender_type'],
            created_at: String(row.created_at || ''),
        };
    }

    return previewMap;
}

function isClosedTicket(ticket: Ticket) {
    return ticket.status === 'Cerrado' || ticket.resolution_status === 'closed';
}

function isUrgentTicket(ticket: Ticket) {
    return ticket.priority === 'Critica' || ticket.priority === 'Alta';
}

function getPriorityBadgeClass(priority: string) {
    if (priority === 'Critica') {
        return 'border-red-300 bg-red-100 text-red-800 ring-1 ring-red-200 shadow-sm';
    }
    if (priority === 'Alta') {
        return 'border-amber-300 bg-amber-100 text-amber-900 ring-1 ring-amber-200';
    }
    if (priority === 'Media') {
        return 'border-sky-200 bg-sky-50 text-sky-700';
    }
    return 'border-slate-200 bg-slate-50 text-slate-600';
}

function getTicketListCardClass(ticket: Ticket, isSelected: boolean, emphasizeClosed: boolean) {
    if (isSelected) {
        return 'border-blue-400 bg-blue-50 shadow-sm ring-2 ring-blue-500/30';
    }

    const closed = isClosedTicket(ticket);
    const critical = ticket.priority === 'Critica';
    const high = ticket.priority === 'Alta';

    if (critical) {
        return `border-red-300 border-l-4 border-l-red-500 bg-gradient-to-r from-red-50 via-white to-white hover:border-red-400 hover:shadow-md ${ticket.is_unread ? 'ring-2 ring-indigo-300 shadow-md' : 'ring-1 ring-red-100'}`;
    }
    if (high) {
        return `border-amber-300 border-l-4 border-l-amber-500 bg-gradient-to-r from-amber-50/90 via-white to-white hover:border-amber-400 hover:shadow-md ${ticket.is_unread ? 'ring-2 ring-indigo-300 shadow-md' : 'ring-1 ring-amber-100'}`;
    }
    if (ticket.is_unread) {
        return 'border-indigo-300 border-l-4 border-l-indigo-500 bg-indigo-50/80 shadow-sm ring-1 ring-indigo-200 hover:border-indigo-400 hover:shadow-md';
    }
    if (emphasizeClosed && closed) {
        return 'border-slate-300 border-l-4 border-l-slate-400 bg-slate-100/95 text-slate-600 hover:border-slate-400 hover:bg-slate-100';
    }

    return 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm';
}

function getContactLabel(ticket: Ticket) {
    if (ticket.contact?.name) return ticket.contact.name;
    if (ticket.contact?.email) return ticket.contact.email;
    if (ticket.external_sender_email) return ticket.external_sender_email;
    return ticket.tenant_name;
}

function getTicketOwner(ticket: Ticket) {
    return getHelpdeskCompanyName(ticket);
}

function getTicketNumberLabel(ticket: Ticket) {
    return `#${ticket.ticket_number ?? ticket.id.slice(0, 8)}`;
}

function getTicketRecipientEmail(ticket: Ticket) {
    return ticket.contact?.email || ticket.external_sender_email || '';
}

function formatCustomerDate(value?: string | null) {
    if (!value) return 'No definida';
    return new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium' }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

function getDashboardTicketCompany(ticket: HelpdeskAssignmentDashboardTicket) {
    const contact = normalizeRelation(ticket.support_contacts);
    const tenant = normalizeRelation(ticket.tenants);
    return contact?.company_name || tenant?.name || 'Empresa sin identificar';
}

function formatMetricMinutes(value: number | null) {
    if (value === null) return '—';
    if (value < 60) return `${Math.round(value)} min`;
    return `${(value / 60).toFixed(value >= 600 ? 0 : 1)} h`;
}

function normalizeDuplicateKey(value: string) {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'mejora-manual';
}

function normalizeForAnalysis(value: string) {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function getPrimaryClientMessage(messages: Message[]) {
    return messages.find((message) => message.sender_type === 'Client')?.message.trim() ?? '';
}

function inferImprovementModule(ticket: Ticket, requestText: string) {
    const text = normalizeForAnalysis([
        ticket.subject,
        ticket.category,
        requestText,
    ].join(' '));

    if (/(api|integracion|webhook|agente|configurable|parametrizacion|configuracion|endpoint)/.test(text)) return 'Integraciones / API ERP';
    if (/(digifact|facturacion electronica|e-?cf|ecf|ncf|dgii|fiscal|comprobante)/.test(text)) return 'Facturacion electronica / Fiscal';
    if (/(promocion|descuento|oferta|forma de pago|metodo de pago|tipo de cliente|lista de precio)/.test(text)) return 'Promociones';
    if (/(activo fijo|activos fijos|depreciacion|depreciar|asiento|entrada de diario|referencia de asiento)/.test(text)) return 'Activos fijos / Contabilidad';
    if (/(inventario|stock|producto|catalogo|categoria|almacen|sucursal)/.test(text)) return 'Inventario / Catalogo';
    if (/(venta|factura|cotizacion|pedido|cliente|cobro)/.test(text)) return 'Ventas / Facturacion';
    if (/(caja|cierre|cuadre|turno|pago|z\b|pos)/.test(text)) return 'Caja / POS';
    if (/(sync|sincron|cloud|viajar|enviar|offline|internet|conexion|red)/.test(text)) return 'Sincronizacion Cloud';
    if (/(impresora|impresion|comanda|ticket|scanner|lector|hardware|terminal)/.test(text)) return 'Hardware POS';

    const insightModule = ticket.insight?.affected_module?.trim();
    if (insightModule && !/no detectado|pendiente/i.test(insightModule)) return insightModule;

    if (ticket.category && ticket.category !== 'Otros') return ticket.category;

    return 'Pendiente de clasificar';
}

function recommendImprovementImpact(ticket: Ticket, requestText: string, module: string) {
    const text = normalizeForAnalysis(`${ticket.subject} ${module} ${requestText}`);

    if (/(duplic|repet|mas de una vez|m[aá]s de una vez)/.test(text)) {
        return 'Evita registros duplicados y reduce retrabajo operativo, conciliaciones manuales y riesgo de errores contables.';
    }

    if (/(bloquea|no permite|no puedo|error|falla|cierre|caja|venta|factura|facturacion)/.test(text)) {
        return 'Reduce friccion en operaciones criticas y ayuda a evitar interrupciones en ventas, facturacion o cierre de caja.';
    }

    if (/(api|integracion|webhook|agente|configurable|endpoint)/.test(text)) {
        return 'Facilita parametrizaciones e integraciones sin intervencion tecnica recurrente, acelerando implementaciones y soporte.';
    }

    if (/(promocion|descuento|forma de pago|tipo de cliente|lista de precio)/.test(text)) {
        return 'Permite configurar reglas comerciales con mayor precision, reduciendo ajustes manuales y diferencias al facturar.';
    }

    if (/(depreci|activo fijo|asiento|contabilidad)/.test(text)) {
        return 'Mejora el control contable y reduce errores de procesamiento mensual, especialmente en cierres y auditorias.';
    }

    if (/(sync|sincron|cloud|offline|red|internet|viajar)/.test(text)) {
        return 'Aumenta la confiabilidad del flujo Cloud/POS/ERP y reduce revisiones manuales por datos pendientes de sincronizar.';
    }

    return 'Ayuda a documentar una necesidad funcional del cliente para evaluar prioridad, alcance e impacto antes de planificar desarrollo.';
}

function mapAttachmentRecord(item: Record<string, unknown>): MessageAttachment {
    return {
        id: typeof item.id === 'string' ? item.id : undefined,
        name: typeof item.name === 'string' ? item.name : undefined,
        mime_type: typeof item.mime_type === 'string' ? item.mime_type : undefined,
        size_bytes: typeof item.size_bytes === 'number' ? item.size_bytes : undefined,
        bucket: typeof item.bucket === 'string' ? item.bucket : undefined,
        path: typeof item.path === 'string' ? item.path : undefined,
        uploaded_at: typeof item.uploaded_at === 'string' ? item.uploaded_at : undefined,
        signed_url: typeof item.signed_url === 'string' ? item.signed_url : null,
        status: typeof item.status === 'string' ? item.status : undefined,
        error: typeof item.error === 'string' ? item.error : undefined,
    };
}

function normalizeMessageAttachments(value: unknown): MessageAttachment[] {
    if (Array.isArray(value)) {
        return value
            .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
            .map((item) => mapAttachmentRecord(item))
            .filter((attachment) => Boolean(attachment.name || attachment.path || attachment.signed_url));
    }

    if (!value || typeof value !== 'object') return [];

    const envelope = value as Record<string, unknown>;
    const embedded = Array.isArray(envelope.files)
        ? envelope.files
        : Array.isArray(envelope.attachments)
            ? envelope.attachments
            : [];

    return embedded
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
        .map((item) => mapAttachmentRecord(item))
        .filter((attachment) => Boolean(attachment.name || attachment.path || attachment.signed_url));
}

function getMessageDeliveryRecipient(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    const recipient = (value as Record<string, unknown>).to;
    return typeof recipient === 'string' ? recipient : '';
}

function parseEmailList(value: string) {
    return Array.from(new Set(value
        .split(/[;,\s]+/)
        .map((email) => email.trim().toLowerCase())
        .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))));
}

function formatAttachmentSize(sizeBytes?: number) {
    if (!sizeBytes || sizeBytes <= 0) return 'Tamano no disponible';
    if (sizeBytes < 1024) return `${sizeBytes} B`;
    if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getAttachmentName(attachment: MessageAttachment) {
    if (attachment.name) return attachment.name;
    if (attachment.path) return attachment.path.split('/').filter(Boolean).at(-1) ?? 'Adjunto';
    return 'Adjunto';
}

function isImageAttachment(attachment: MessageAttachment) {
    return attachment.mime_type?.startsWith('image/') ?? false;
}

function truncateDraftContext(value: string, maxLength = 180) {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function isElectronicInvoiceConfigurationQuestion(text: string) {
    const asksConfiguration = /(configur|activar|habilitar|parametr|integrar|conectar|instalar|setup|credencial)/i.test(text);
    const isElectronicInvoice = /(digifact|facturaci[oó]n electronica|facturaci[oó]n electr[oó]nica|e-?cf|ecf|dgii)/i.test(text);

    return asksConfiguration && isElectronicInvoice;
}

function hasAlreadyAskedConfigurationPrereqs(messages: Message[]) {
    return messages.some((message) => (
        message.sender_type === 'Admin'
        && /no tengo cargada aqui una guia confirmada de configuracion inicial de digifact/i.test(message.message)
        && /credenciales\/ambiente digifact/i.test(message.message)
    ));
}

function clientConfirmedConfigurationPrereqs(messages: Message[]) {
    const text = [...messages].reverse().find((message) => message.sender_type === 'Client')?.message.toLowerCase() ?? '';
    const confirms = /(ya tenemos|tenemos todo|todo lo indicado|si tenemos|sí tenemos|confirmo|contamos con|ya esta|ya está)/i.test(text);
    const asksNextStep = /(configur|llegar|ruta|paso|pasos|que debo|qué debo|como sigo|cómo sigo|que sigue|qué sigue|tener en cuenta)/i.test(text);

    return confirms && asksNextStep;
}

function buildContextualFallbackDraft(ticket: Ticket, messages: Message[]) {
    const subject = `${ticket.subject} ${ticket.category} ${ticket.insight?.affected_module ?? ''}`.toLowerCase();
    const owner = getTicketOwner(ticket);
    const lastClientMessage = [...messages].reverse().find((message) => message.sender_type === 'Client')?.message;
    const opening = `Hola ${owner},`;
    const evidence = lastClientMessage ? ` Tomamos como referencia: "${truncateDraftContext(lastClientMessage)}".` : '';
    const lastError = ticket.technical_context?.last_5_errors?.[0];
    const terminalContext = [
        ticket.technical_context?.app_version ? `version ${ticket.technical_context.app_version}` : null,
        ticket.technical_context?.network_type ? `red ${ticket.technical_context.network_type}` : null,
        ticket.technical_context?.battery_level ? `bateria ${ticket.technical_context.battery_level}` : null,
    ].filter(Boolean).join(', ');

    if (hasAlreadyAskedConfigurationPrereqs(messages) && clientConfirmedConfigurationPrereqs(messages)) {
        return `${opening} gracias por confirmarlo. Como ya tienen credenciales/ambiente DigiFact y secuencias e-CF/NCF, el siguiente paso no es volver a pedir prerequisitos: debo validarte la ruta exacta de parametrizacion en Clic-ERP para no indicarte un menu incorrecto.\n\nVoy a confirmar internamente el flujo correcto de configuracion y dejarlo documentado en nuestra base de conocimiento. En la proxima respuesta te compartimos los pasos exactos para activarlo en facturas y que debes revisar antes de emitir.`;
    }

    if (isElectronicInvoiceConfigurationQuestion(`${subject}\n${lastClientMessage ?? ''}`)) {
        return `${opening} para no darte una ruta incorrecta de Clic-ERP, no tengo cargada aqui una guia confirmada de configuracion inicial de DigiFact/facturacion electronica. Lo correcto es validarlo como parametrizacion fiscal antes de indicar menus o pasos.\n\nPara avanzar, confirmanos dos cosas: si la empresa ya tiene credenciales/ambiente DigiFact activo (prueba o produccion) y si ya tiene asignadas sus secuencias e-CF/NCF/RNC emisor. Con eso te guiamos con el flujo exacto y dejamos documentada la configuracion correcta. Si el caso es un error al emitir, envianos folio, NCF/e-CF y captura del rechazo.`;
    }

    if (/(impres|printer|cocina|comanda|hardware)/i.test(subject)) {
        return `${opening} vamos a validar el hardware del POS.${evidence} Confirma si ocurre en una sola terminal o en todas, revisa conexion/emparejamiento de impresora o scanner, y prueba una reimpresion o recibo de prueba. Si falla, envianos modelo del equipo, terminal afectada, version del POS y foto/captura del error${lastError ? `; tambien vemos "${lastError}" en contexto tecnico.` : '.'}`;
    }

    if (/(factura|fiscal|ncf|e-?cf|digifact|rnc|comprobante)/i.test(subject)) {
        return `${opening} revisemos el flujo fiscal en Clic-ERP/Clic-POS.${evidence} Valida primero tipo de comprobante, RNC/consumidor final, secuencia NCF/e-CF disponible e internet estable. Luego intenta reenviar solo ese comprobante desde historial, sin recrear la venta. Si vuelve a fallar, envianos folio, NCF/e-CF, hora exacta y captura del error${lastError ? `; en los logs vemos "${lastError}".` : '.'}`;
    }

    if (/(sync|sincron|red|internet|conexion|offline|enviar|viajar|cierre|z\b)/i.test(subject)) {
        return `${opening} esto parece sincronizacion entre Clic-POS y Cloud/ERP.${evidence} Confirma que las ventas esten visibles localmente, que la terminal tenga internet estable y fecha/hora correcta, y luego fuerza la sincronizacion desde el POS. No borres datos ni reinstales antes de confirmar respaldo. Si no viaja, envianos terminal, usuario, hora del cierre/caja y cantidad de transacciones pendientes${terminalContext ? ` (${terminalContext})` : ''}${lastError ? `; ultimo error "${lastError}".` : '.'}`;
    }

    if (/(inventario|stock|producto|catalogo)/i.test(subject)) {
        return `${opening} revisemos inventario/catalogo.${evidence} Confirma que el producto exista y este activo en Clic-ERP para la sucursal, valida precio/impuesto y luego sincroniza catalogo en el POS. Si sigue sin aparecer o el stock no coincide, envianos codigo del producto, sucursal, terminal, cantidad esperada y captura de la busqueda.`;
    }

    if (/(pago|caja|cierre|z|cuadre|turno)/i.test(subject)) {
        return `${opening} validemos el pago/cierre en Clic-POS.${evidence} Revisa si la venta quedo completada, pendiente o duplicada en el historial y comparala contra el cuadre de caja. Envianos folio, monto, metodo de pago, hora, caja y terminal para identificar si es registro, sincronizacion o conciliacion.`;
    }

    const improvementPattern = /(necesito que|queremos que|ser[ií]a bueno|me gustar[ií]a|opci[oó]n para|funci[oó]n para|hace falta|solicitamos (una|un|que|como mejora)|sugeri(mos|ria|r[ií]a|do|da|encia).{0,80}(mejora|cambio|funci[oó]n|m[oó]dulo|modulo|sistema)|(proponemos|recomendamos).{0,80}(mejora|cambio|funci[oó]n|m[oó]dulo|modulo|sistema)|no permita(n)? .{0,100}(duplic|repet|m[aá]s de una vez|mas de una vez|depreci)|evit(a|ar|e).{0,100}(duplic|repet|m[aá]s de una vez|mas de una vez)|poder (aplicar|asignar|filtrar|configurar|seleccionar|elegir|limitar|condicionar)|promocion(es)?.{0,100}(forma de pago|m[eé]todo de pago|tipo de cliente|cliente|categor[ií]a|sucursal|lista de precio))/i;

    if (improvementPattern.test(subject) || (lastClientMessage && improvementPattern.test(lastClientMessage))) {
        return `${opening} lo que solicitas parece una mejora funcional para Clic-ERP/Clic-POS. La registraremos para evaluacion de producto con el caso de uso e impacto operativo. Para documentarla bien, confirmanos modulo, pasos actuales, resultado esperado, frecuencia de uso y si bloquea ventas, facturacion o cierre de caja.`;
    }

    return `${opening} necesito ubicar el punto exacto del caso en Clic-ERP/Clic-POS.${evidence} Confirma modulo afectado, usuario, sucursal/caja, terminal, version, hora aproximada y captura del mensaje. Mientras tanto valida conectividad, fecha/hora del equipo y si ocurre en una sola terminal o en todas${lastError ? `; el ultimo error registrado es "${lastError}".` : '.'}`;
}

const SupportCommandCenter: React.FC = () => {
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
    const [agents, setAgents] = useState<HelpdeskAgentOption[]>([]);
    const [teams, setTeams] = useState<HelpdeskTeamOption[]>([]);
    const [replyTemplates, setReplyTemplates] = useState<HelpdeskReplyTemplate[]>([]);
    const [searchInput, setSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([]);
    const [isRefreshingTickets, setIsRefreshingTickets] = useState(false);
    const [refreshVersion, setRefreshVersion] = useState(0);
    const [replyText, setReplyText] = useState('');
    const [replyMode, setReplyMode] = useState<HelpdeskReplyMode>('reply');
    const [isComposerOpen, setIsComposerOpen] = useState(false);
    const [ccText, setCcText] = useState('');
    const [bccText, setBccText] = useState('');
    const [forwardTo, setForwardTo] = useState('');
    const [isPrivateNote, setIsPrivateNote] = useState(false);
    const [showReplyOptions, setShowReplyOptions] = useState(false);
    const [workspacePresence, setWorkspacePresence] = useState<HelpdeskPresence[]>([]);
    const [currentActorId, setCurrentActorId] = useState<string | null>(null);
    const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [bulkActionError, setBulkActionError] = useState<string | null>(null);
    const [actionNotice, setActionNotice] = useState<string | null>(null);
    const [tagInput, setTagInput] = useState('');
    const [pendingReplyAttachments, setPendingReplyAttachments] = useState<PendingReplyAttachment[]>([]);
    const [replyAttachmentError, setReplyAttachmentError] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [filterStatus, setFilterStatus] = useState('Todos');
    const [mailboxFilter, setMailboxFilter] = useState<'active' | 'spam'>('active');
    const [filterSource, setFilterSource] = useState('Todos');
    const [filterTeam, setFilterTeam] = useState('Todos');
    const [filterAssignee, setFilterAssignee] = useState('Todos');
    const [filterCompany, setFilterCompany] = useState('Todos');
    const [filterContact, setFilterContact] = useState('Todos');
    const [filterDateFrom, setFilterDateFrom] = useState('');
    const [filterDateTo, setFilterDateTo] = useState('');
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [ticketSort, setTicketSort] = useState<HelpdeskTicketSortKey>('activity_desc');
    const [showContextPanel, setShowContextPanel] = useState(true);
    const [isFocusMode, setIsFocusMode] = useState(false);
    const [actorDepartmentAccess, setActorDepartmentAccess] = useState<{ all: boolean; ids: string[] }>({ all: false, ids: [] });
    const [canDeleteTickets, setCanDeleteTickets] = useState(false);
    const [canManageAssignments, setCanManageAssignments] = useState(false);
    const [isAssignmentDashboardOpen, setIsAssignmentDashboardOpen] = useState(false);
    const [assignmentDashboard, setAssignmentDashboard] = useState<HelpdeskAssignmentDashboard | null>(null);
    const [assignmentDashboardTab, setAssignmentDashboardTab] = useState<'assigned' | 'resolved' | 'overdue'>('assigned');
    const [isLoadingAssignmentDashboard, setIsLoadingAssignmentDashboard] = useState(false);
    const [isRunningCopilotAssignment, setIsRunningCopilotAssignment] = useState(false);
    const [assignmentDashboardError, setAssignmentDashboardError] = useState<string | null>(null);
    const [conversationSearch, setConversationSearch] = useState('');
    const [conversationMatchIndex, setConversationMatchIndex] = useState(0);
    const [messageExpansion, setMessageExpansion] = useState<Record<string, boolean>>({});
    const [quickFilter, setQuickFilter] = useState<'none' | 'critical' | 'unassigned'>('none');
    const [isCreatingContact, setIsCreatingContact] = useState(false);
    const [isSendingReply, setIsSendingReply] = useState(false);
    const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
    const [isResolvingTicket, setIsResolvingTicket] = useState(false);
    const [isContactModalOpen, setIsContactModalOpen] = useState(false);
    const [contactForm, setContactForm] = useState<ContactFormState>(emptyContactForm);
    const [isImprovementModalOpen, setIsImprovementModalOpen] = useState(false);
    const [isSavingImprovement, setIsSavingImprovement] = useState(false);
    const [improvementDraft, setImprovementDraft] = useState<ImprovementDraft>(initialImprovementDraft);
    const [improvementError, setImprovementError] = useState<string | null>(null);
    const [improvementNotice, setImprovementNotice] = useState<string | null>(null);
    const [deleteTicketIds, setDeleteTicketIds] = useState<string[]>([]);
    const [deleteReason, setDeleteReason] = useState('');
    const [isDeletingTickets, setIsDeletingTickets] = useState(false);
    const [lastMessageByTicketId, setLastMessageByTicketId] = useState<Record<string, TicketMessagePreview>>({});
    const messagesPaneRef = useRef<HTMLDivElement>(null);
    const replyTextareaRef = useRef<HTMLTextAreaElement>(null);
    const replyFileInputRef = useRef<HTMLInputElement>(null);
    const pendingReplyAttachmentsRef = useRef<PendingReplyAttachment[]>([]);
    const searchDebounceRef = useRef<number | undefined>(undefined);
    const searchQueryRef = useRef('');
    const lastSavedDraftRef = useRef<string | null>(null);
    const messageElementRefs = useRef<Record<string, HTMLDivElement | null>>({});

    const selectedTicketId = selectedTicket?.id;

    useEffect(() => {
        setMessageExpansion({});
    }, [selectedTicketId]);

    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || isContactModalOpen || isImprovementModalOpen || deleteTicketIds.length > 0) return;
            setIsFocusMode(false);
            setSelectedTicket(null);
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [deleteTicketIds.length, isContactModalOpen, isImprovementModalOpen]);

    useEffect(() => {
        const pane = messagesPaneRef.current;
        if (!pane) return;
        pane.scrollTo({ top: pane.scrollHeight, behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        const textarea = replyTextareaRef.current;
        if (!textarea) return;

        textarea.style.height = 'auto';
        const nextHeight = Math.min(textarea.scrollHeight, REPLY_TEXTAREA_MAX_HEIGHT);
        textarea.style.height = `${nextHeight}px`;
        textarea.style.overflowY = textarea.scrollHeight > REPLY_TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
    }, [replyText, selectedTicketId]);

    useEffect(() => {
        if (!isComposerOpen) return;
        window.requestAnimationFrame(() => replyTextareaRef.current?.focus());
    }, [isComposerOpen, isPrivateNote, replyMode]);

    useEffect(() => {
        pendingReplyAttachmentsRef.current = pendingReplyAttachments;
    }, [pendingReplyAttachments]);

    useEffect(() => {
        return () => {
            pendingReplyAttachmentsRef.current.forEach((attachment) => {
                URL.revokeObjectURL(attachment.previewUrl);
            });
        };
    }, []);

    useEffect(() => {
        pendingReplyAttachmentsRef.current.forEach((attachment) => {
            URL.revokeObjectURL(attachment.previewUrl);
        });
        setPendingReplyAttachments([]);
        setReplyAttachmentError(null);
        if (replyFileInputRef.current) {
            replyFileInputRef.current.value = '';
        }
    }, [selectedTicketId]);

    useEffect(() => {
        let mounted = true;
        const fetchTickets = async () => {
            setIsRefreshingTickets(true);
            try {
                const response = await fetchHelpdeskBootstrap(searchQuery);
                if (!mounted) return;

                const unreadStateByTicketId = new Map(
                    response.unread_states.map((state) => [state.ticket_id, state]),
                );
                const mappedTickets = (response.tickets as TicketRow[]).map((ticket) => {
                    const mappedTicket = mapTicketRow(ticket);
                    return applyUnreadState(mappedTicket, unreadStateByTicketId.get(mappedTicket.id));
                });

                setTickets(mappedTickets);
                setAgents(response.agents);
                setTeams(response.teams);
                setActorDepartmentAccess({
                    all: response.actor_access.all_departments,
                    ids: response.actor_access.department_ids,
                });
                setCanDeleteTickets(response.actor_access.can_delete_tickets);
                setCanManageAssignments(response.actor_access.can_manage_assignments);
                setReplyTemplates(response.templates);
                setLastMessageByTicketId(buildLatestMessagePreviewMap(response.previews as Array<{ ticket_id?: string | null; message?: string | null; sender_type?: string | null; created_at?: string | null }>));
                setSelectedTicket((current) => current
                    ? mappedTickets.find((ticket) => ticket.id === current.id) ?? null
                    : current);
                setSelectedTicketIds((current) => current.filter((id) => mappedTickets.some((ticket) => ticket.id === id)));
            } catch (error) {
                console.error('Admin: error fetching secure helpdesk workspace', error);
                if (mounted) setBulkActionError(error instanceof Error ? error.message : 'No se pudo cargar el HelpDesk.');
            } finally {
                if (mounted) setIsRefreshingTickets(false);
            }
        };

        void fetchTickets();

        return () => {
            mounted = false;
        };
    }, [refreshVersion, searchQuery]);

    useEffect(() => {
        searchQueryRef.current = searchQuery;
    }, [searchQuery]);

    useEffect(() => {
        setConversationSearch('');
        setConversationMatchIndex(0);
        setIsComposerOpen(false);
        setShowReplyOptions(false);
        messageElementRefs.current = {};
    }, [selectedTicketId]);

    useEffect(() => {
        const refreshTimers = new Map<string, number>();
        let searchRefreshTimer: number | undefined;
        let mounted = true;
        let channel: ReturnType<typeof supabase.channel> | null = null;

        const removeTicket = (ticketId: string) => {
            setTickets((current) => current.filter((ticket) => ticket.id !== ticketId));
            setSelectedTicket((current) => current?.id === ticketId ? null : current);
            setSelectedTicketIds((current) => current.filter((id) => id !== ticketId));
            setLastMessageByTicketId((current) => {
                const next = { ...current };
                delete next[ticketId];
                return next;
            });
        };

        const refreshTicket = async (ticketId: string) => {
            try {
                const response = await fetchHelpdeskTicketSnapshot(ticketId);
                if (!mounted) return;
                if (!response.ticket) {
                    removeTicket(ticketId);
                    return;
                }
                const mappedTicket = applyUnreadState(
                    mapTicketRow(response.ticket as TicketRow),
                    response.unread_state,
                );
                setTickets((current) => {
                    const index = current.findIndex((ticket) => ticket.id === ticketId);
                    if (index < 0) return [mappedTicket, ...current];
                    const next = [...current];
                    next[index] = mappedTicket;
                    return next;
                });
                setSelectedTicket((current) => current?.id === ticketId ? mappedTicket : current);
                if (response.preview) {
                    setLastMessageByTicketId((current) => ({
                        ...current,
                        ...buildLatestMessagePreviewMap([response.preview as Record<string, string | null>]),
                    }));
                }
            } catch (error) {
                console.error('Admin: error refreshing changed support ticket', error);
                const message = error instanceof Error ? error.message : String(error ?? '');
                if (/forbidden|unauthorized/i.test(message)) removeTicket(ticketId);
            }
        };

        const scheduleFullRefresh = () => {
            window.clearTimeout(searchRefreshTimer);
            searchRefreshTimer = window.setTimeout(() => {
                if (mounted) setRefreshVersion((value) => value + 1);
            }, 800);
        };

        const handleHelpdeskChange = (broadcast: { payload?: unknown }) => {
            if (!mounted) return;

            const change = broadcast.payload && typeof broadcast.payload === 'object'
                ? broadcast.payload as Record<string, unknown>
                : {};
            const oldRecord = change.old_record && typeof change.old_record === 'object'
                ? change.old_record as Record<string, unknown>
                : {};
            const newRecord = change.record && typeof change.record === 'object'
                ? change.record as Record<string, unknown>
                : {};
            const table = String(change.table || '');
            const ticketId = String(
                change.ticket_id
                || newRecord.ticket_id
                || oldRecord.ticket_id
                || (table === 'support_tickets' ? newRecord.id || oldRecord.id : '')
                || '',
            );

            if (!ticketId || searchQueryRef.current) {
                scheduleFullRefresh();
                return;
            }

            if (table === 'support_tickets' && change.operation === 'DELETE') {
                removeTicket(ticketId);
                return;
            }

            window.clearTimeout(refreshTimers.get(ticketId));
            refreshTimers.set(ticketId, window.setTimeout(() => {
                refreshTimers.delete(ticketId);
                void refreshTicket(ticketId);
            }, 250));
        };

        const subscribe = async () => {
            await authorizeAdminRealtime();
            if (!mounted) return;

            channel = supabase
                .channel('cloud-admin:helpdesk', {
                    config: { private: true },
                })
                .on('broadcast', { event: 'helpdesk_changed' }, handleHelpdeskChange)
                .subscribe((status, error) => {
                    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                        console.error(`Admin: Helpdesk Broadcast subscription ${status}`, error);
                    }
                });
        };

        void subscribe().catch((error: unknown) => {
            console.error('Admin: error authorizing Helpdesk Broadcast', error);
        });

        return () => {
            mounted = false;
            refreshTimers.forEach((timer) => window.clearTimeout(timer));
            window.clearTimeout(searchRefreshTimer);
            if (channel) {
                void supabase.removeChannel(channel);
            }
        };
    }, []);

    useEffect(() => {
        window.clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = window.setTimeout(() => setSearchQuery(searchInput.trim()), 350);
        return () => window.clearTimeout(searchDebounceRef.current);
    }, [searchInput]);

    useEffect(() => {
        if (!selectedTicketId) {
            setMessages([]);
            setWorkspacePresence([]);
            setCurrentActorId(null);
            return;
        }

        let mounted = true;
        let messageRefreshTimer: number | undefined;
        let msgChannel: ReturnType<typeof supabase.channel> | null = null;

        const fetchMessages = async () => {
            try {
                const response = await fetchSupportMessages(selectedTicketId);
                if (!mounted) return;
                setMessages((response.messages ?? []) as Message[]);
            } catch (error) {
                console.error('Admin: error fetching support messages', error);
                if (mounted) setReplyAttachmentError(error instanceof Error ? error.message : 'No se pudo cargar la conversación.');
                return;
            }

            try {
                const readState = await markHelpdeskTicketRead(selectedTicketId);
                if (!mounted) return;
                setTickets((current) => current.map((ticket) => ticket.id === selectedTicketId
                    ? { ...ticket, is_unread: false, last_read_at: readState.last_read_at ?? null }
                    : ticket));
                setSelectedTicket((current) => current?.id === selectedTicketId
                    ? { ...current, is_unread: false, last_read_at: readState.last_read_at ?? null }
                    : current);
            } catch (error) {
                console.error('Admin: error marking support conversation as read', error);
                if (mounted) setBulkActionError(error instanceof Error ? error.message : 'No se pudo marcar el ticket como leído.');
            }
        };

        void fetchMessages();

        const subscribe = async () => {
            await authorizeAdminRealtime();
            if (!mounted) return;

            msgChannel = supabase
                .channel(`cloud-admin:helpdesk:ticket:${selectedTicketId}`, {
                    config: { private: true },
                })
                .on('broadcast', { event: 'helpdesk_changed' }, () => {
                    if (!mounted || document.visibilityState !== 'visible') return;
                    window.clearTimeout(messageRefreshTimer);
                    messageRefreshTimer = window.setTimeout(() => void fetchMessages(), 250);
                })
                .subscribe((status, error) => {
                    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                        console.error(`Admin: ticket Broadcast subscription ${status}`, error);
                    }
                });
        };

        void subscribe().catch((error: unknown) => {
            console.error('Admin: error authorizing ticket Broadcast', error);
        });

        return () => {
            mounted = false;
            window.clearTimeout(messageRefreshTimer);
            if (msgChannel) {
                void supabase.removeChannel(msgChannel);
            }
        };
    }, [selectedTicketId]);

    useEffect(() => {
        if (!selectedTicketId) return;
        let mounted = true;

        const refreshWorkspace = async (restoreDraft: boolean) => {
            try {
                const workspace = await loadHelpdeskWorkspace(selectedTicketId);
                if (!mounted) return;
                setWorkspacePresence(workspace.presence);
                setCurrentActorId(workspace.actor_id);
                if (restoreDraft && workspace.draft) {
                    setReplyText(workspace.draft.body ?? '');
                    setReplyMode(workspace.draft.mode ?? 'reply');
                    setCcText((workspace.draft.cc ?? []).join(', '));
                    setBccText((workspace.draft.bcc ?? []).join(', '));
                    setForwardTo(workspace.draft.forward_to ?? '');
                    lastSavedDraftRef.current = serializeDraft({
                        body: workspace.draft.body ?? '',
                        mode: workspace.draft.mode ?? 'reply',
                        cc: workspace.draft.cc ?? [],
                        bcc: workspace.draft.bcc ?? [],
                        forwardTo: workspace.draft.forward_to ?? '',
                    });
                    setDraftStatus('saved');
                }
            } catch (error) {
                console.error('Admin: error loading collaborative workspace', error);
            }
        };

        void refreshWorkspace(true);
        const heartbeatWorkspace = async () => {
            if (document.visibilityState !== 'visible') return;
            try {
                const response = await heartbeatHelpdeskTicket(selectedTicketId);
                if (mounted) setWorkspacePresence(response.presence);
            } catch (error) {
                console.error('Admin: helpdesk heartbeat failed', error);
            }
        };
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') void heartbeatWorkspace();
        };
        const heartbeat = window.setInterval(() => void heartbeatWorkspace(), 30_000);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            mounted = false;
            window.clearInterval(heartbeat);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [selectedTicketId]);

    useEffect(() => {
        if (!selectedTicketId) return;
        const draft = {
            body: replyText,
            mode: replyMode,
            cc: parseEmailList(ccText),
            bcc: parseEmailList(bccText),
            forwardTo,
        };
        const serializedDraft = serializeDraft(draft);
        if (serializedDraft === lastSavedDraftRef.current) return;
        const timer = window.setTimeout(async () => {
            setDraftStatus('saving');
            try {
                await saveHelpdeskDraft(selectedTicketId, draft);
                lastSavedDraftRef.current = serializedDraft;
                setDraftStatus('saved');
            } catch (error) {
                console.error('Admin: error saving helpdesk draft', error);
                setDraftStatus('error');
            }
        }, 1_500);
        return () => window.clearTimeout(timer);
    }, [bccText, ccText, forwardTo, replyMode, replyText, selectedTicketId]);

    const ticketStats = useMemo(() => {
        const activeTickets = tickets.filter((ticket) => ticket.assignment_status !== 'spam');
        return {
            critical: activeTickets.filter((ticket) => ticket.priority === 'Critica').length,
            open: activeTickets.filter((ticket) => ticket.status === 'Abierto').length,
            email: activeTickets.filter((ticket) => ticket.source === 'Email').length,
            unassigned: activeTickets.filter((ticket) => ticket.assignment_status === 'needs_assignment').length,
            unread: activeTickets.filter((ticket) => ticket.is_unread).length,
            active: activeTickets.length,
            spam: tickets.length - activeTickets.length,
        };
    }, [tickets]);

    const companyOptions = useMemo(() => Array.from(new Set(
        tickets
            .map(getHelpdeskCompanyName)
            .filter((company) => company !== UNKNOWN_HELPDESK_COMPANY),
    )).sort((left, right) => left.localeCompare(right, 'es', { sensitivity: 'base', numeric: true })), [tickets]);
    const contactOptions = useMemo(() => {
        const options = new Map<string, string>();
        tickets.forEach((ticket) => {
            const value = ticket.contact?.id || ticket.contact?.email || ticket.external_sender_email;
            if (!value) return;
            options.set(value, ticket.contact?.name || ticket.contact?.company_name || ticket.contact?.email || ticket.external_sender_email || value);
        });
        return Array.from(options, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
    }, [tickets]);

    const departmentUnreadCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        tickets.forEach((ticket) => {
            if (ticket.team_id && ticket.is_unread) counts[ticket.team_id] = (counts[ticket.team_id] ?? 0) + 1;
        });
        return counts;
    }, [tickets]);

    const conversationMatches = useMemo(() => {
        const needle = conversationSearch.trim().toLocaleLowerCase('es');
        if (!needle) return [];
        return messages.filter((message) => message.message.toLocaleLowerCase('es').includes(needle));
    }, [conversationSearch, messages]);

    const ticketTimeline = useMemo(() => {
        if (!selectedTicket) return null;
        const publicMessages = messages.filter((message) => message.visibility !== 'private');
        const firstAgentReply = publicMessages.find((message) => message.sender_type === 'Admin');
        const lastMessage = publicMessages[publicMessages.length - 1];
        return {
            firstResponse: firstAgentReply ? formatDuration(selectedTicket.created_at, firstAgentReply.created_at) : 'Pendiente',
            openTime: formatDuration(selectedTicket.created_at, isClosedTicket(selectedTicket) ? lastMessage?.created_at : undefined),
            lastActivity: lastMessage ? formatTime(lastMessage.created_at) : formatTime(selectedTicket.created_at),
        };
    }, [messages, selectedTicket]);

    useEffect(() => {
        if (!conversationMatches.length) {
            setConversationMatchIndex(0);
            return;
        }
        setConversationMatchIndex((current) => Math.min(current, conversationMatches.length - 1));
    }, [conversationMatches.length]);

    useEffect(() => {
        if (!conversationSearch.trim()) return;
        const activeMatch = conversationMatches[conversationMatchIndex];
        if (!activeMatch) return;
        setMessageExpansion((current) => current[activeMatch.id]
            ? current
            : { ...current, [activeMatch.id]: true });
    }, [conversationMatchIndex, conversationMatches, conversationSearch]);

    const goToConversationMatch = (direction: 1 | -1) => {
        if (!conversationMatches.length) return;
        const nextIndex = (conversationMatchIndex + direction + conversationMatches.length) % conversationMatches.length;
        const nextMessageId = conversationMatches[nextIndex].id;
        setConversationMatchIndex(nextIndex);
        setMessageExpansion((current) => ({ ...current, [nextMessageId]: true }));
        window.requestAnimationFrame(() => {
            messageElementRefs.current[nextMessageId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    };

    const filteredTickets = useMemo(() => {
        return tickets.filter((ticket) => {
            const mailboxMatches = mailboxFilter === 'spam'
                ? ticket.assignment_status === 'spam'
                : ticket.assignment_status !== 'spam';
            const statusMatches = filterStatus === 'Todos' || ticket.status === filterStatus;
            const sourceMatches = filterSource === 'Todos' || ticket.source === filterSource;
            const teamMatches = filterTeam === 'Todos' || (filterTeam === 'Sin_departamento' ? !ticket.team_id : ticket.team_id === filterTeam);
            const assigneeMatches = filterAssignee === 'Todos' || (filterAssignee === 'Sin_asignar' ? !ticket.assignee_id : ticket.assignee_id === filterAssignee);
            const companyMatches = filterCompany === 'Todos' || getHelpdeskCompanyName(ticket) === filterCompany;
            const contactValue = ticket.contact?.id || ticket.contact?.email || ticket.external_sender_email;
            const contactMatches = filterContact === 'Todos' || contactValue === filterContact;
            const createdAt = new Date(ticket.created_at).getTime();
            const fromMatches = !filterDateFrom || createdAt >= new Date(`${filterDateFrom}T00:00:00`).getTime();
            const toMatches = !filterDateTo || createdAt <= new Date(`${filterDateTo}T23:59:59.999`).getTime();
            const criticalMatches = quickFilter !== 'critical' || ticket.priority === 'Critica';
            const unassignedMatches = quickFilter !== 'unassigned' || ticket.assignment_status === 'needs_assignment';
            return mailboxMatches && statusMatches && sourceMatches && teamMatches && assigneeMatches && companyMatches
                && contactMatches && fromMatches && toMatches && criticalMatches && unassignedMatches;
        });
    }, [filterAssignee, filterCompany, filterContact, filterDateFrom, filterDateTo, filterSource, filterStatus, filterTeam, mailboxFilter, quickFilter, tickets]);

    const organizedTickets = useMemo(() => sortHelpdeskTickets(
        filteredTickets,
        ticketSort,
        (ticketId) => lastMessageByTicketId[ticketId]?.created_at,
    ), [filteredTickets, lastMessageByTicketId, ticketSort]);

    const selectedTicketIndex = selectedTicket
        ? organizedTickets.findIndex((ticket) => ticket.id === selectedTicket.id)
        : -1;

    const navigateTicket = (direction: -1 | 1) => {
        if (selectedTicketIndex < 0 || !organizedTickets.length) return;
        const nextIndex = selectedTicketIndex + direction;
        if (nextIndex < 0 || nextIndex >= organizedTickets.length) return;
        setSelectedTicket(organizedTickets[nextIndex]);
    };

    const clearPendingReplyAttachments = () => {
        pendingReplyAttachments.forEach((attachment) => {
            URL.revokeObjectURL(attachment.previewUrl);
        });
        setPendingReplyAttachments([]);
        setReplyAttachmentError(null);
        if (replyFileInputRef.current) {
            replyFileInputRef.current.value = '';
        }
    };

    const handleReplyAttachmentSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = Array.from(event.target.files ?? []);
        event.target.value = '';

        if (!selectedFiles.length) return;

        setReplyAttachmentError(null);
        const availableSlots = MAX_REPLY_ATTACHMENTS - pendingReplyAttachments.length;
        if (availableSlots <= 0) {
            setReplyAttachmentError(`Solo puedes adjuntar hasta ${MAX_REPLY_ATTACHMENTS} imagenes por respuesta.`);
            return;
        }

        const accepted: PendingReplyAttachment[] = [];
        const rejected: string[] = [];

        for (const file of selectedFiles.slice(0, availableSlots)) {
            if (!ALLOWED_REPLY_IMAGE_TYPES.has(file.type)) {
                rejected.push(`${file.name}: formato no permitido`);
                continue;
            }
            if (file.size > MAX_REPLY_ATTACHMENT_BYTES) {
                rejected.push(`${file.name}: supera 5 MB`);
                continue;
            }

            accepted.push({
                id: crypto.randomUUID(),
                file,
                previewUrl: URL.createObjectURL(file),
            });
        }

        if (rejected.length) {
            setReplyAttachmentError(rejected.join(' · '));
        }

        if (accepted.length) {
            setPendingReplyAttachments((current) => [...current, ...accepted]);
        }
    };

    const removePendingReplyAttachment = (attachmentId: string) => {
        setPendingReplyAttachments((current) => {
            const target = current.find((attachment) => attachment.id === attachmentId);
            if (target) URL.revokeObjectURL(target.previewUrl);
            return current.filter((attachment) => attachment.id !== attachmentId);
        });
    };

    const uploadPendingReplyAttachments = async (ticketId: string) => {
        return uploadHelpdeskAttachments(ticketId, pendingReplyAttachments.map((pending) => pending.file));
    };

    const handleSendReply = async () => {
        const text = replyText.trim();
        const hasAttachments = pendingReplyAttachments.length > 0;
        if ((!text && !hasAttachments) || !selectedTicket || isSendingReply) return;

        const recipientEmail = getTicketRecipientEmail(selectedTicket);
        const messageText = text || 'Imagen adjunta enviada por soporte.';
        const savedReplyText = replyText;
        const savedAttachments = pendingReplyAttachments;

        setReplyText('');
        setIsSendingReply(true);
        setReplyAttachmentError(null);

        try {
            if (isPrivateNote && hasAttachments) {
                throw new Error('Las notas internas no admiten adjuntos por ahora.');
            }
            const uploadedAttachments = hasAttachments
                ? await uploadPendingReplyAttachments(selectedTicket.id)
                : [];

            if (isPrivateNote) {
                await addPrivateHelpdeskNote(selectedTicket.id, messageText);
            } else if (recipientEmail || replyMode === 'forward') {
                await sendHelpdeskReply({
                    ticketId: selectedTicket.id,
                    message: messageText,
                    attachments: uploadedAttachments,
                    mode: replyMode,
                    cc: parseEmailList(ccText),
                    bcc: parseEmailList(bccText),
                    forwardTo,
                });
            } else {
                await addPublicHelpdeskReply(selectedTicket.id, messageText, uploadedAttachments);
            }
            clearPendingReplyAttachments();
            setIsComposerOpen(false);
            setCcText('');
            setBccText('');
            setForwardTo('');
            setDraftStatus('idle');
            const response = await fetchSupportMessages(selectedTicket.id);
            setMessages((response.messages ?? []) as Message[]);
            setRefreshVersion((value) => value + 1);
        } catch (error) {
            console.error('Admin: unexpected error sending support reply', error);
            setReplyText(savedReplyText);
            setPendingReplyAttachments(savedAttachments);
            setReplyAttachmentError(error instanceof Error ? error.message : 'Error inesperado al enviar adjuntos.');
        } finally {
            setIsSendingReply(false);
        }
    };

    const updateStatus = async (newStatus: string) => {
        if (!selectedTicket) return;

        if (newStatus === 'Resuelto') {
            setIsResolvingTicket(true);
            try {
                await resolveHelpdeskTicket(selectedTicket.id);

                setSelectedTicket({
                    ...selectedTicket,
                    status: 'Resuelto',
                    resolution_status: 'pending_customer_confirmation',
                    customer_rating: null,
                });
            } catch (error) {
                console.error('Admin: unexpected error resolving support ticket', error);
            } finally {
                setIsResolvingTicket(false);
            }
            return;
        }

        try {
            await updateHelpdeskTicket(selectedTicket.id, {
                status: newStatus,
                resolution_status: newStatus === 'En_Proceso' ? 'reopened' : 'open',
            });
        } catch (error) {
            console.error('Admin: error updating ticket status', error);
            return;
        }

        setSelectedTicket({
            ...selectedTicket,
            status: newStatus,
            resolution_status: newStatus === 'En_Proceso' ? 'reopened' : 'open',
        });
    };

    const openContactModal = () => {
        if (!selectedTicket?.external_sender_email && !selectedTicket?.contact?.email) return;

        const email = selectedTicket.contact?.email || selectedTicket.external_sender_email || '';
        const fallbackName = email ? email.split('@')[0] : '';

        setContactForm({
            name: selectedTicket.contact?.name || fallbackName,
            phone: selectedTicket.contact?.phone || '',
            email,
            companyName: selectedTicket.contact?.company_name || '',
            sla: selectedTicket.contact?.metadata?.sla || 'standard',
        });
        setIsContactModalOpen(true);
    };

    const saveContactFromTicket = async () => {
        if (!selectedTicket || (!selectedTicket.external_sender_email && !selectedTicket.contact?.email)) return;

        setIsCreatingContact(true);

        const contactPayload = {
            contact_id: selectedTicket.contact?.id ?? null,
            email: contactForm.email.trim().toLowerCase(),
            name: contactForm.name.trim(),
            phone: contactForm.phone.trim(),
            company_name: contactForm.companyName.trim(),
            sla: contactForm.sla,
        };

        try {
            const response = await saveHelpdeskContact(selectedTicket.id, contactPayload);
            const contact = response.contact as unknown as SupportContact;
            setSelectedTicket({
                ...selectedTicket,
                contact,
                assignment_status: response.assignment_status,
            });
            setIsContactModalOpen(false);
            setRefreshVersion((value) => value + 1);
        } catch (error) {
            console.error('Admin: error creating support contact', error);
        } finally {
            setIsCreatingContact(false);
        }
    };

    const generateDraft = async () => {
        if (!selectedTicket || isGeneratingDraft) return;

        const fallbackDraft = buildContextualFallbackDraft(selectedTicket, messages);
        setIsGeneratingDraft(true);

        try {
            const payload = await generateHelpdeskDraft(selectedTicket.id);
            if (!payload.draft) {
                console.error('Admin: error generating support draft', payload);
                setReplyText(fallbackDraft);
                return;
            }

            setReplyText(payload.draft);
        } catch (error) {
            console.error('Admin: unexpected error generating support draft', error);
            setReplyText(fallbackDraft);
        } finally {
            setIsGeneratingDraft(false);
        }
    };

    const openImprovementModal = () => {
        if (!selectedTicket) return;

        const primaryClientMessage = getPrimaryClientMessage(messages);
        const requestedCapability = primaryClientMessage || selectedTicket.subject;
        const affectedModule = inferImprovementModule(selectedTicket, requestedCapability);

        setImprovementDraft({
            title: selectedTicket.subject,
            requestedCapability,
            affectedModule,
            customerImpact: recommendImprovementImpact(selectedTicket, requestedCapability, affectedModule),
            priority: selectedTicket.priority === 'Critica' ? 'Alta' : 'Media',
        });
        setImprovementError(null);
        setImprovementNotice(null);
        setIsImprovementModalOpen(true);
    };

    const closeImprovementModal = () => {
        if (isSavingImprovement) return;
        setIsImprovementModalOpen(false);
        setImprovementDraft(initialImprovementDraft);
        setImprovementError(null);
    };

    const updateImprovementDraft = <K extends keyof ImprovementDraft>(field: K, value: ImprovementDraft[K]) => {
        setImprovementDraft((current) => ({ ...current, [field]: value }));
    };

    const handleCreateImprovement = async () => {
        if (!selectedTicket) return;

        const title = improvementDraft.title.trim();
        const requestedCapability = improvementDraft.requestedCapability.trim();
        const affectedModule = improvementDraft.affectedModule.trim();
        const customerImpact = improvementDraft.customerImpact.trim();

        if (!title || !requestedCapability) {
            setImprovementError('Completa el titulo y la solicitud antes de registrarla.');
            return;
        }

        setIsSavingImprovement(true);
        setImprovementError(null);

        const duplicateGroupKey = normalizeDuplicateKey(`${selectedTicket.id}-${title}`);
        const payload = {
            priority: improvementDraft.priority,
            title,
            requested_capability: requestedCapability,
            affected_module: affectedModule || selectedTicket.insight?.affected_module || selectedTicket.category,
            customer_impact: customerImpact || 'Registrada manualmente desde HelpDesk para evaluacion de producto.',
            duplicate_group_key: duplicateGroupKey,
        };

        try {
            const result = await createHelpdeskImprovement(selectedTicket.id, payload);
            setImprovementNotice(result.already_existed ? 'La mejora ya existia; se notifico al cliente.' : 'Mejora registrada y cliente notificado.');
            setIsImprovementModalOpen(false);
            setImprovementDraft(initialImprovementDraft);
        } catch (error) {
            console.error('Admin: error creating customer improvement', error);
            setImprovementError(error instanceof Error ? error.message : 'No se pudo registrar la mejora solicitada.');
        } finally {
            setIsSavingImprovement(false);
        }
    };

    const refreshTickets = () => setRefreshVersion((value) => value + 1);

    const loadAssignmentDashboard = async () => {
        setIsLoadingAssignmentDashboard(true);
        setAssignmentDashboardError(null);
        try {
            setAssignmentDashboard(await fetchHelpdeskAssignmentDashboard());
        } catch (error) {
            setAssignmentDashboardError(error instanceof Error ? error.message : 'No se pudo cargar la operación de agentes.');
        } finally {
            setIsLoadingAssignmentDashboard(false);
        }
    };

    const openAssignmentDashboard = () => {
        setIsAssignmentDashboardOpen(true);
        void loadAssignmentDashboard();
    };

    const runCopilotAssignment = async () => {
        setIsRunningCopilotAssignment(true);
        setAssignmentDashboardError(null);
        try {
            const result = await assignPendingHelpdeskTicketsWithCopilot();
            const assigned = result.decisions.filter((decision) => decision.assigned).length;
            setActionNotice(`Copilot asignó ${assigned} ticket${assigned === 1 ? '' : 's'}.`);
            await loadAssignmentDashboard();
            refreshTickets();
        } catch (error) {
            setAssignmentDashboardError(error instanceof Error ? error.message : 'Copilot no pudo asignar los tickets pendientes.');
        } finally {
            setIsRunningCopilotAssignment(false);
        }
    };

    const changeAssignmentMode = async (mode: HelpdeskAssignmentMode) => {
        if (!assignmentDashboard) return;
        setAssignmentDashboardError(null);
        try {
            const result = await updateHelpdeskAssignmentSettings(
                mode,
                assignmentDashboard.settings.assignment_copilot_min_confidence,
            );
            setAssignmentDashboard((current) => current ? { ...current, settings: result.settings } : current);
        } catch (error) {
            setAssignmentDashboardError(error instanceof Error ? error.message : 'No se pudo guardar el modo de Copilot.');
        }
    };

    const openDashboardTicket = (dashboardTicket: HelpdeskAssignmentDashboardTicket) => {
        const ticket = tickets.find((item) => item.id === dashboardTicket.id);
        if (ticket) setSelectedTicket(ticket);
        setIsAssignmentDashboardOpen(false);
    };

    const updateSelectedTicketFields = async (fields: Record<string, unknown>) => {
        if (!selectedTicket) return;
        setBulkActionError(null);
        try {
            await updateHelpdeskTicket(selectedTicket.id, fields);
            setSelectedTicket((current) => current ? { ...current, ...fields } as Ticket : current);
            refreshTickets();
        } catch (error) {
            setBulkActionError(error instanceof Error ? error.message : 'No se pudo actualizar el ticket.');
        }
    };

    const runBulkUpdate = async (fields: Record<string, unknown>) => {
        if (!selectedTicketIds.length) return;
        setBulkActionError(null);
        try {
            await bulkUpdateHelpdeskTickets(selectedTicketIds, fields);
            setSelectedTicketIds([]);
            refreshTickets();
        } catch (error) {
            setBulkActionError(error instanceof Error ? error.message : 'No se pudo completar la acción masiva.');
        }
    };

    const markTicketsAsSpam = async (ticketIds: string[]) => {
        if (!ticketIds.length) return;
        setBulkActionError(null);
        setActionNotice(null);
        try {
            await markHelpdeskTicketsAsSpam(ticketIds);
            setSelectedTicketIds([]);
            if (selectedTicket && ticketIds.includes(selectedTicket.id)) setSelectedTicket(null);
            setActionNotice(`${ticketIds.length} ticket${ticketIds.length === 1 ? '' : 's'} movido${ticketIds.length === 1 ? '' : 's'} a Spam.`);
            refreshTickets();
        } catch (error) {
            setBulkActionError(error instanceof Error ? error.message : 'No se pudo marcar el ticket como spam.');
        }
    };

    const restoreSpamTickets = async (ticketIds: string[]) => {
        if (!ticketIds.length) return;
        setBulkActionError(null);
        setActionNotice(null);
        try {
            await restoreHelpdeskSpamTickets(ticketIds);
            setSelectedTicketIds([]);
            if (selectedTicket && ticketIds.includes(selectedTicket.id)) setSelectedTicket(null);
            setActionNotice(`${ticketIds.length} ticket${ticketIds.length === 1 ? '' : 's'} restaurado${ticketIds.length === 1 ? '' : 's'} a la bandeja activa.`);
            refreshTickets();
        } catch (error) {
            setBulkActionError(error instanceof Error ? error.message : 'No se pudo restaurar el ticket.');
        }
    };

    const requestTicketDeletion = (ticketIds: string[]) => {
        if (!canDeleteTickets || !ticketIds.length) return;
        setDeleteReason(mailboxFilter === 'spam' ? 'Spam confirmado' : '');
        setDeleteTicketIds(ticketIds);
    };

    const confirmTicketDeletion = async () => {
        const reason = deleteReason.trim();
        if (!deleteTicketIds.length || reason.length < 3) return;
        setIsDeletingTickets(true);
        setBulkActionError(null);
        setActionNotice(null);
        try {
            const result = await deleteHelpdeskTickets(deleteTicketIds, reason);
            const deletedIds = result.deleted_ids;
            setTickets((current) => current.filter((ticket) => !deletedIds.includes(ticket.id)));
            setSelectedTicketIds([]);
            setSelectedTicket((current) => current && deletedIds.includes(current.id) ? null : current);
            setDeleteTicketIds([]);
            setDeleteReason('');
            setActionNotice(`${deletedIds.length} ticket${deletedIds.length === 1 ? '' : 's'} eliminado${deletedIds.length === 1 ? '' : 's'} permanentemente.${result.attachment_cleanup_warnings.length ? ' Algunos archivos requieren limpieza automática posterior.' : ''}`);
            refreshTickets();
        } catch (error) {
            setBulkActionError(error instanceof Error ? error.message : 'No se pudo eliminar el ticket.');
        } finally {
            setIsDeletingTickets(false);
        }
    };

    const mergeSelectedTickets = async () => {
        if (selectedTicketIds.length < 2) return;
        const targetTicketId = selectedTicketIds.includes(selectedTicket?.id ?? '')
            ? selectedTicket!.id
            : selectedTicketIds[0];
        if (!window.confirm(`Se conservará ${tickets.find((ticket) => ticket.id === targetTicketId)?.ticket_number ?? targetTicketId} y se fusionarán ${selectedTicketIds.length - 1} duplicados. ¿Continuar?`)) return;
        setBulkActionError(null);
        try {
            await mergeHelpdeskTickets(targetTicketId, selectedTicketIds);
            setSelectedTicketIds([]);
            setSelectedTicket(tickets.find((ticket) => ticket.id === targetTicketId) ?? null);
            refreshTickets();
        } catch (error) {
            setBulkActionError(error instanceof Error ? error.message : 'No se pudieron fusionar los tickets.');
        }
    };

    const addTagToSelectedTicket = async () => {
        const tag = tagInput.trim().toLowerCase().replace(/[^a-z0-9áéíóúüñ_-]+/gi, '-');
        if (!selectedTicket || !tag) return;
        const tags = Array.from(new Set([...(selectedTicket.tags ?? []), tag]));
        await updateSelectedTicketFields({ tags });
        setTagInput('');
    };

    const createPreventiveTicket = async () => {
        if (!selectedTicket) return;
        try {
            await createPreventiveHelpdeskTicket({
                subject: `Seguimiento preventivo: ${selectedTicket.subject}`,
                tenantId: selectedTicket.tenant_id,
                contactId: selectedTicket.contact?.id,
                priority: selectedTicket.priority === 'Critica' ? 'Alta' : 'Media',
                category: selectedTicket.category,
            });
            refreshTickets();
        } catch (error) {
            setBulkActionError(error instanceof Error ? error.message : 'No se pudo crear el ticket preventivo.');
        }
    };

    const retryDelivery = async (message: Message) => {
        if (!selectedTicket || !['failed', 'bounced'].includes(message.delivery_status ?? '')) return;
        setReplyAttachmentError(null);
        try {
            const retryMode: HelpdeskReplyMode = message.message_kind === 'forward' || message.message_kind === 'reply_all'
                ? message.message_kind
                : 'reply';
            await sendHelpdeskReply({
                ticketId: selectedTicket.id,
                message: message.message,
                attachments: normalizeMessageAttachments(message.attachments).filter((attachment): attachment is MessageAttachment & Required<Pick<MessageAttachment, 'id' | 'name' | 'mime_type' | 'size_bytes' | 'bucket' | 'path' | 'uploaded_at'>> => Boolean(attachment.id && attachment.name && attachment.mime_type && attachment.size_bytes && attachment.bucket && attachment.path && attachment.uploaded_at)),
                mode: retryMode,
                cc: message.cc ?? [],
                bcc: message.bcc ?? [],
                forwardTo: retryMode === 'forward' ? getMessageDeliveryRecipient(message.attachments) : '',
                messageId: message.id,
            });
            const response = await fetchSupportMessages(selectedTicket.id);
            setMessages((response.messages ?? []) as Message[]);
        } catch (error) {
            setReplyAttachmentError(error instanceof Error ? error.message : 'No se pudo reintentar la entrega.');
        }
    };

    const applyReplyTemplate = (templateId: string) => {
        const template = replyTemplates.find((item) => item.id === templateId);
        if (!template || !selectedTicket) return;
        setReplyText(template.body.replaceAll('{{cliente}}', getContactLabel(selectedTicket)));
    };

    return (
        <div className="relative flex h-[calc(100dvh-4rem)] max-h-[calc(100dvh-4rem)] overflow-hidden bg-slate-100">
            <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-white shadow-sm">
                <div className="shrink-0 border-b border-slate-100 px-3 pb-3 pt-2">
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/90 p-3">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                            <input
                                value={searchInput}
                                onChange={(event) => setSearchInput(event.target.value)}
                                placeholder="Buscar ticket, empresa, contacto o mensaje"
                                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-9 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                            />
                            <button type="button" onClick={refreshTickets} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Actualizar tickets">
                                <RefreshCw size={14} className={isRefreshingTickets ? 'animate-spin' : ''} />
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={openAssignmentDashboard}
                            className="flex w-full items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-left text-xs font-bold text-indigo-800 transition-colors hover:border-indigo-300 hover:bg-indigo-100"
                        >
                            <span className="inline-flex items-center gap-2"><BarChart3 size={15} />Operación de agentes</span>
                            <span>{ticketStats.unassigned} pendientes</span>
                        </button>
                        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4" aria-label="Filtros rápidos de tickets">
                            <button
                                type="button"
                                onClick={() => { setQuickFilter('none'); setFilterSource('Todos'); setFilterStatus('Abierto'); }}
                                className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${filterStatus === 'Abierto' && quickFilter === 'none' ? 'border-emerald-400 bg-emerald-50 text-emerald-800 shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/60'}`}
                                aria-pressed={filterStatus === 'Abierto' && quickFilter === 'none'}
                            >
                                <CheckCircle2 className="shrink-0 text-emerald-600" size={18} />
                                <span className="min-w-0"><span className="block text-xs font-bold">Abiertos</span><span className="text-lg font-black leading-none">{ticketStats.open}</span></span>
                            </button>
                            <button
                                type="button"
                                onClick={() => { setFilterStatus('Todos'); setFilterSource('Todos'); setQuickFilter('critical'); }}
                                className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${quickFilter === 'critical' ? 'border-red-400 bg-red-50 text-red-800 shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-red-300 hover:bg-red-50/60'}`}
                                aria-pressed={quickFilter === 'critical'}
                            >
                                <AlertTriangle className="shrink-0 text-red-600" size={18} />
                                <span className="min-w-0"><span className="block text-xs font-bold">Críticos</span><span className="text-lg font-black leading-none">{ticketStats.critical}</span></span>
                            </button>
                            <button
                                type="button"
                                onClick={() => { setQuickFilter('none'); setFilterStatus('Todos'); setFilterSource('Email'); }}
                                className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${filterSource === 'Email' && quickFilter === 'none' ? 'border-violet-400 bg-violet-50 text-violet-800 shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-violet-300 hover:bg-violet-50/60'}`}
                                aria-pressed={filterSource === 'Email' && quickFilter === 'none'}
                            >
                                <Mail className="shrink-0 text-violet-600" size={18} />
                                <span className="min-w-0"><span className="block text-xs font-bold">Email</span><span className="text-lg font-black leading-none">{ticketStats.email}</span></span>
                            </button>
                            <button
                                type="button"
                                onClick={() => { setFilterStatus('Todos'); setFilterSource('Todos'); setQuickFilter('unassigned'); }}
                                className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${quickFilter === 'unassigned' ? 'border-amber-400 bg-amber-50 text-amber-900 shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-amber-300 hover:bg-amber-50/60'}`}
                                aria-pressed={quickFilter === 'unassigned'}
                            >
                                <UserPlus className="shrink-0 text-amber-600" size={18} />
                                <span className="min-w-0"><span className="block text-xs font-bold">Sin asignar</span><span className="text-lg font-black leading-none">{ticketStats.unassigned}</span></span>
                            </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2" aria-label="Bandeja del HelpDesk">
                            <button
                                type="button"
                                onClick={() => { setMailboxFilter('active'); setSelectedTicketIds([]); setSelectedTicket(null); }}
                                className={`rounded-lg border px-3 py-2 text-xs font-bold ${mailboxFilter === 'active' ? 'border-indigo-400 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                            >
                                Bandeja activa <span className="ml-1 rounded-full bg-white/80 px-1.5 py-0.5">{ticketStats.active}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => { setMailboxFilter('spam'); setSelectedTicketIds([]); setSelectedTicket(null); setFilterStatus('Todos'); setQuickFilter('none'); }}
                                className={`rounded-lg border px-3 py-2 text-xs font-bold ${mailboxFilter === 'spam' ? 'border-red-400 bg-red-50 text-red-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-red-50'}`}
                            >
                                Spam <span className="ml-1 rounded-full bg-white/80 px-1.5 py-0.5">{ticketStats.spam}</span>
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {teams
                                .filter((team) => actorDepartmentAccess.all || actorDepartmentAccess.ids.includes(team.id))
                                .map((team) => (
                                    <button
                                        key={team.id}
                                        type="button"
                                        onClick={() => setFilterTeam((current) => current === team.id ? 'Todos' : team.id)}
                                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold ${filterTeam === team.id ? 'border-indigo-400 bg-indigo-100 text-indigo-800' : 'border-slate-200 bg-white text-slate-600'}`}
                                    >
                                        <Bell size={10} />
                                        {team.name}
                                        {departmentUnreadCounts[team.id] ? <span className="rounded-full bg-indigo-600 px-1.5 text-white">{departmentUnreadCounts[team.id]}</span> : null}
                                    </button>
                                ))}
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                            <span className="flex items-center gap-2"><Filter size={12} />Filtros</span>
                            <button type="button" onClick={() => setShowAdvancedFilters((current) => !current)} className="rounded px-1.5 py-1 text-indigo-600 hover:bg-indigo-50">
                                {showAdvancedFilters ? 'Menos' : 'Más filtros'}
                            </button>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                            <div>
                                <label className="mb-1.5 block text-[11px] font-semibold text-slate-600" htmlFor="estado-ticket">
                                    Estado
                                </label>
                                <select
                                    id="estado-ticket"
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                    value={filterStatus}
                                    onChange={(event) => {
                                        setQuickFilter('none');
                                        setFilterStatus(event.target.value);
                                    }}
                                >
                                    {statusFilters.map((status) => (
                                        <option key={status} value={status}>
                                            {formatStatusLabel(status)}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="mb-1.5 block text-[11px] font-semibold text-slate-600" htmlFor="canal-ticket">
                                    Canal
                                </label>
                                <select
                                    id="canal-ticket"
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                    value={filterSource}
                                    onChange={(event) => {
                                        setQuickFilter('none');
                                        setFilterSource(event.target.value);
                                    }}
                                >
                                    {sourceFilters.map((source) => (
                                        <option key={source} value={source}>
                                            {source}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="mb-1.5 block text-[11px] font-semibold text-slate-600" htmlFor="empresa-ticket">
                                    Empresa
                                </label>
                                <select
                                    id="empresa-ticket"
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                    value={filterCompany}
                                    onChange={(event) => setFilterCompany(event.target.value)}
                                >
                                    <option value="Todos">Todas</option>
                                    <option value={UNKNOWN_HELPDESK_COMPANY}>Sin empresa identificada</option>
                                    {companyOptions.map((company) => <option key={company} value={company}>{company}</option>)}
                                </select>
                            </div>

                            <div>
                                <label className="mb-1.5 block text-[11px] font-semibold text-slate-600" htmlFor="orden-ticket">
                                    Ordenar por
                                </label>
                                <select
                                    id="orden-ticket"
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                    value={ticketSort}
                                    onChange={(event) => setTicketSort(event.target.value as HelpdeskTicketSortKey)}
                                >
                                    {ticketSortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                </select>
                            </div>
                        </div>

                        {showAdvancedFilters ? (
                            <div className="grid gap-2 border-t border-slate-200 pt-3 sm:grid-cols-2">
                                <FilterSelect label="Departamento" value={filterTeam} onChange={setFilterTeam}>
                                    <option value="Todos">Todos</option>
                                    <option value="Sin_departamento">Sin departamento</option>
                                    {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                                </FilterSelect>
                                <FilterSelect label="Persona asignada" value={filterAssignee} onChange={setFilterAssignee}>
                                    <option value="Todos">Todas</option>
                                    <option value="Sin_asignar">Sin asignar</option>
                                    {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.full_name}</option>)}
                                </FilterSelect>
                                <FilterSelect label="Cliente" value={filterContact} onChange={setFilterContact}>
                                    <option value="Todos">Todos</option>
                                    {contactOptions.map((contact) => <option key={contact.value} value={contact.value}>{contact.label}</option>)}
                                </FilterSelect>
                                <label className="block">
                                    <span className="mb-1 block text-[11px] font-semibold text-slate-600">Desde</span>
                                    <input type="date" value={filterDateFrom} onChange={(event) => setFilterDateFrom(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700" />
                                </label>
                                <label className="block">
                                    <span className="mb-1 block text-[11px] font-semibold text-slate-600">Hasta</span>
                                    <input type="date" value={filterDateTo} onChange={(event) => setFilterDateTo(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700" />
                                </label>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setFilterTeam('Todos');
                                        setFilterAssignee('Todos');
                                        setFilterContact('Todos');
                                        setFilterCompany('Todos');
                                        setFilterDateFrom('');
                                        setFilterDateTo('');
                                    }}
                                    className="sm:col-span-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                                >
                                    Limpiar filtros avanzados
                                </button>
                            </div>
                        ) : null}

                        <p className="border-t border-slate-200 pt-2 text-[11px] font-medium text-slate-500">
                            Mostrando <span className="font-bold text-slate-800">{filteredTickets.length}</span> de{' '}
                            <span className="font-bold text-slate-800">{tickets.length}</span> tickets
                            {ticketStats.unread > 0 ? (
                                <span className="ml-2 inline-flex items-center gap-1 font-bold text-indigo-700">
                                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                                    {ticketStats.unread} sin leer
                                </span>
                            ) : null}
                        </p>
                        {bulkActionError && <p className="text-xs font-medium text-red-600">{bulkActionError}</p>}
                        {actionNotice && <p className="text-xs font-medium text-emerald-700">{actionNotice}</p>}
                    </div>
                </div>

                {selectedTicketIds.length > 0 && (
                    <div className="shrink-0 border-b border-blue-200 bg-blue-50 p-3">
                        <div className="mb-2 flex items-center justify-between text-xs font-bold text-blue-800">
                            <span>{selectedTicketIds.length} seleccionados</span>
                            <button type="button" onClick={() => setSelectedTicketIds([])} className="text-blue-600 hover:text-blue-900">Limpiar</button>
                        </div>
                        {mailboxFilter === 'active' ? (
                            <div className="grid grid-cols-3 gap-1.5">
                                <button type="button" onClick={() => void runBulkUpdate({ status: 'En_Proceso' })} className="rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-[11px] font-bold text-blue-700">En proceso</button>
                                <button type="button" onClick={() => void runBulkUpdate({ status: 'Cerrado' })} className="rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-[11px] font-bold text-blue-700">Cerrar</button>
                                <button type="button" disabled={!canDeleteTickets} onClick={() => void markTicketsAsSpam(selectedTicketIds)} className="rounded-lg border border-red-200 bg-white px-2 py-1.5 text-[11px] font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-40" title={canDeleteTickets ? 'Mover a Spam' : 'Requiere permiso Gestionar HelpDesk'}>Marcar como spam</button>
                            </div>
                        ) : (
                            <button type="button" disabled={!canDeleteTickets} onClick={() => void restoreSpamTickets(selectedTicketIds)} className="inline-flex w-full items-center justify-center rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-xs font-bold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">
                                Restaurar a bandeja activa
                            </button>
                        )}
                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                            <button type="button" disabled={selectedTicketIds.length < 2 || mailboxFilter === 'spam'} onClick={() => void mergeSelectedTickets()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-2 py-1.5 text-xs font-bold text-white disabled:opacity-40">
                                <GitMerge size={13} /> Fusionar duplicados
                            </button>
                            <button type="button" disabled={!canDeleteTickets} onClick={() => requestTicketDeletion(selectedTicketIds)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-300 bg-white px-2 py-1.5 text-xs font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-40" title={canDeleteTickets ? 'Eliminar permanentemente' : 'Requiere permiso Gestionar HelpDesk'}>
                                <Trash2 size={13} /> Eliminar
                            </button>
                        </div>
                    </div>
                )}

                <div className="min-h-0 flex-1 overflow-auto bg-slate-50/60 p-3 md:p-4">
                    {filteredTickets.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                            No hay tickets con los filtros seleccionados.
                        </div>
                    ) : null}
                    {filteredTickets.length > 0 ? (
                        <div className="mb-1 hidden min-w-[980px] grid-cols-[minmax(360px,2fr)_minmax(180px,1fr)_110px_130px_150px] gap-4 rounded-t-xl border border-slate-200 bg-slate-100 px-12 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 md:grid">
                            <span>Empresa / ticket / conversación</span>
                            <span>Asignación</span>
                            <span>Prioridad</span>
                            <span>Estado / canal</span>
                            <span className="text-right">Última actividad</span>
                        </div>
                    ) : null}
                    <div className="min-w-0 space-y-1 md:min-w-[980px]">
                    {organizedTickets.map((ticket) => {
                        const preview = lastMessageByTicketId[ticket.id];
                        const previewText = preview?.message
                            ? truncatePreview(preview.message)
                            : truncatePreview(ticket.insight?.summary || ticket.subject);
                        const emphasizeClosed = filterStatus === 'Todos';
                        const closed = isClosedTicket(ticket);
                        const urgent = isUrgentTicket(ticket);
                        const isSelected = selectedTicket?.id === ticket.id;

                        return (
                            <div key={ticket.id} className={`group flex min-w-0 items-stretch overflow-hidden rounded-lg border transition-all ${getTicketListCardClass(ticket, isSelected, emphasizeClosed)}`}>
                                <label className="flex w-10 shrink-0 cursor-pointer items-center justify-center border-r border-inherit bg-white/40" title={`Seleccionar ${getTicketNumberLabel(ticket)}`}>
                                    <input
                                        type="checkbox"
                                        checked={selectedTicketIds.includes(ticket.id)}
                                        onChange={(event) => setSelectedTicketIds((current) => event.target.checked ? [...current, ticket.id] : current.filter((id) => id !== ticket.id))}
                                        aria-label={`Seleccionar ${getTicketNumberLabel(ticket)}`}
                                        className="h-4 w-4 rounded border-slate-300 text-blue-600"
                                    />
                                </label>
                                <button type="button" onClick={() => setSelectedTicket(ticket)} className="grid min-w-0 flex-1 grid-cols-1 gap-3 px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 md:grid-cols-[minmax(320px,2fr)_minmax(180px,1fr)_110px_130px_150px] md:items-center md:gap-4">
                                    <div className="min-w-0">
                                        <div className="flex min-w-0 items-center gap-2">
                                            {ticket.is_unread ? <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-600 ring-4 ring-indigo-100" aria-label="Ticket nuevo" /> : null}
                                            <span className="shrink-0 text-xs font-black text-slate-500">{getTicketNumberLabel(ticket)}</span>
                                            {ticket.is_unread ? <span className="shrink-0 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-indigo-700">Nuevo</span> : null}
                                            <span className="inline-flex min-w-0 max-w-[45%] shrink items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-black text-indigo-800" title={`Empresa: ${getHelpdeskCompanyName(ticket)}`}>
                                                <Building2 size={11} className="shrink-0" />
                                                <span className="truncate">{getHelpdeskCompanyName(ticket)}</span>
                                            </span>
                                            <h3 className={`truncate text-sm ${ticket.is_unread ? 'font-black text-slate-950' : 'font-bold text-slate-800'}`}>{ticket.subject}</h3>
                                        </div>
                                        <p className="mt-1 truncate text-xs font-semibold text-slate-600">Contacto: {getContactLabel(ticket)}</p>
                                        <p className={`mt-1 truncate text-xs ${ticket.is_unread ? 'font-medium text-slate-700' : 'text-slate-500'}`}>
                                            {preview ? <><span className="font-semibold">{getSenderPreviewLabel(preview.sender_type)}:</span>{' '}{previewText}</> : previewText}
                                        </p>
                                    </div>
                                    <div className="min-w-0 text-xs">
                                        <p className="truncate font-bold text-indigo-700">{ticket.support_team?.name || 'Sin departamento'}</p>
                                        <p className="mt-1 truncate text-slate-500">{ticket.assignee?.full_name || 'Sin persona asignada'}</p>
                                    </div>
                                    <div><span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold ${getPriorityBadgeClass(ticket.priority)}`}>{urgent ? <AlertTriangle size={10} /> : null}{ticket.priority}</span></div>
                                    <div className="flex flex-wrap gap-1.5 md:block">
                                        <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-bold ${closed ? 'border-slate-300 bg-slate-100 text-slate-600' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{closed ? 'Cerrado' : formatStatusLabel(ticket.status)}</span>
                                        <span className={`ml-0 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold md:ml-1 ${sourceStyles[ticket.source] ?? sourceStyles.POS}`}>{ticket.source === 'Email' ? <Mail size={10} /> : <MonitorSmartphone size={10} />}{ticket.source}</span>
                                    </div>
                                    <div className="flex items-center gap-1 text-xs font-medium text-slate-500 md:justify-end"><Clock3 size={12} />{formatTime(getHelpdeskLastActivityAt(ticket, preview?.created_at))}</div>
                                </button>
                            </div>
                        );
                    })}
                    </div>
                </div>
            </section>

            {selectedTicket ? (
            <div
                className="fixed inset-0 z-40 flex bg-slate-950/45 p-0 backdrop-blur-[1px] md:p-3"
                onMouseDown={(event) => {
                    if (event.target === event.currentTarget) setSelectedTicket(null);
                }}
            >
            <div role="dialog" aria-modal="true" aria-label={`Ticket ${getTicketNumberLabel(selectedTicket)}`} className="mx-auto flex h-full min-h-0 w-full max-w-[1800px] overflow-hidden bg-white shadow-2xl md:rounded-2xl md:border md:border-slate-200">
            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
                {selectedTicket ? (
                    <>
                        <div className="shrink-0 border-b border-slate-200 bg-white px-5 py-4">
                            <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                    <div className="mb-2 flex flex-wrap items-center gap-2">
                                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${sourceStyles[selectedTicket.source] ?? sourceStyles.POS}`}>
                                            {selectedTicket.source === 'Email' ? <Mail size={12} /> : <MonitorSmartphone size={12} />}
                                            {selectedTicket.source}
                                        </span>
                                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                            {formatStatusLabel(selectedTicket.status)}
                                        </span>
                                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                            {selectedTicket.category}
                                        </span>
                                        {selectedTicket.assignment_status === 'spam' ? (
                                            <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">
                                                Spam
                                            </span>
                                        ) : null}
                                        {selectedTicket.resolution_status && selectedTicket.resolution_status !== 'open' && (
                                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${resolutionStatusStyles[selectedTicket.resolution_status] ?? 'border-slate-200 bg-white text-slate-600'}`}>
                                                {resolutionStatusLabels[selectedTicket.resolution_status] ?? selectedTicket.resolution_status}
                                            </span>
                                        )}
                                        {selectedTicket.customer_rating ? (
                                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                                                {selectedTicket.customer_rating}/5 estrellas
                                            </span>
                                        ) : null}
                                        {selectedTicket.insight?.autonomy_action ? (
                                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${selectedTicket.insight.autonomy_action === 'auto_reply' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : selectedTicket.insight.autonomy_action === 'escalate' ? 'border-red-200 bg-red-50 text-red-700' : selectedTicket.insight.autonomy_action === 'draft' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-violet-200 bg-violet-50 text-violet-700'}`} title={(selectedTicket.insight.autonomy_reasons ?? []).join(', ')}>
                                                <Bot size={11} />
                                                IA: {selectedTicket.insight.autonomy_action === 'auto_reply' ? 'respondió' : selectedTicket.insight.autonomy_action === 'escalate' ? 'escaló' : selectedTicket.insight.autonomy_action === 'draft' ? 'borrador' : selectedTicket.insight.autonomy_action === 'observe' ? 'observando' : 'acuse'}
                                                {typeof selectedTicket.insight.response_confidence === 'number' ? ` · ${Math.round(selectedTicket.insight.response_confidence * 100)}%` : ''}
                                            </span>
                                        ) : null}
                                    </div>
                                    <div className="flex min-w-0 items-center gap-2">
                                        <span className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-black text-slate-500">
                                            {getTicketNumberLabel(selectedTicket)}
                                        </span>
                                        <h2 className="truncate text-xl font-black tracking-tight text-slate-950">{selectedTicket.subject}</h2>
                                    </div>
                                    <p className="mt-1 text-sm font-medium text-slate-500">{getTicketOwner(selectedTicket)}</p>
                                </div>

                                <div className="flex shrink-0 gap-2">
                                    <div className="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
                                        <button type="button" onClick={() => navigateTicket(-1)} disabled={selectedTicketIndex <= 0} className="p-2 text-slate-500 hover:bg-slate-50 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-30" title="Ticket anterior">
                                            <ChevronLeft size={15} />
                                        </button>
                                        <span className="border-x border-slate-200 px-2 text-[11px] font-bold text-slate-500">
                                            {selectedTicketIndex + 1}/{filteredTickets.length}
                                        </span>
                                        <button type="button" onClick={() => navigateTicket(1)} disabled={selectedTicketIndex < 0 || selectedTicketIndex >= filteredTickets.length - 1} className="p-2 text-slate-500 hover:bg-slate-50 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-30" title="Ticket siguiente">
                                            <ChevronRight size={15} />
                                        </button>
                                    </div>
                                    <button type="button" onClick={() => setIsFocusMode((current) => !current)} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${isFocusMode ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:text-indigo-700'}`} title={isFocusMode ? 'Salir del modo concentración (Esc)' : 'Ocultar paneles laterales'}>
                                        <Focus size={15} />
                                        <span className="hidden xl:inline">{isFocusMode ? 'Salir de concentración' : 'Modo concentración'}</span>
                                    </button>
                                    <button type="button" onClick={() => { if (isFocusMode) { setIsFocusMode(false); setShowContextPanel(true); } else { setShowContextPanel((current) => !current); } }} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:text-indigo-700" title={showContextPanel && !isFocusMode ? 'Ocultar contexto' : 'Mostrar contexto'}>
                                        {showContextPanel && !isFocusMode ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
                                    </button>
                                    <button onClick={() => updateStatus('En_Proceso')} disabled={isResolvingTicket} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">
                                        En proceso
                                    </button>
                                    <button onClick={() => updateStatus('Resuelto')} disabled={isResolvingTicket} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
                                        {isResolvingTicket ? 'Enviando...' : 'Resolver'}
                                    </button>
                                    <button type="button" onClick={() => setSelectedTicket(null)} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-900" title="Cerrar ticket (Esc)" aria-label="Cerrar ticket">
                                        <X size={16} />
                                    </button>
                                </div>
                            </div>

                            {ticketTimeline ? (
                                <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/80 sm:grid-cols-3 xl:grid-cols-5">
                                    <TicketMetric label="Creado" value={formatTime(selectedTicket.created_at)} />
                                    <TicketMetric label="Primera respuesta" value={ticketTimeline.firstResponse} />
                                    <TicketMetric label="Tiempo abierto" value={ticketTimeline.openTime} />
                                    <TicketMetric label="SLA" value={slaLabels[selectedTicket.contact?.metadata?.sla ?? 'standard'] ?? 'Estándar'} accent />
                                    <TicketMetric label="Última actividad" value={ticketTimeline.lastActivity} />
                                </div>
                            ) : null}

                            {selectedTicket.resolution_status === 'pending_customer_confirmation' && (
                                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                                    Se notifico al cliente para confirmar cierre y valorar la respuesta.
                                </div>
                            )}

                            {selectedTicket.insight?.summary && (
                                <div className="mt-4 rounded-lg border border-violet-100 bg-violet-50 p-3">
                                    <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-violet-700">
                                        <Sparkles size={14} />
                                        Resumen IA
                                    </div>
                                    <p className="text-sm text-violet-900">{selectedTicket.insight.summary}</p>
                                    {selectedTicket.insight.next_best_action && (
                                        <div className="mt-3 rounded-lg border border-violet-200 bg-white/70 p-2">
                                            <p className="text-[11px] font-bold uppercase tracking-wide text-violet-600">Próxima acción</p>
                                            <p className="mt-1 text-sm text-violet-950">{selectedTicket.insight.next_best_action}</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="flex shrink-0 items-center gap-2 border-y border-slate-100 bg-white px-4 py-2">
                            <div className="relative min-w-0 flex-1">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
                                <input
                                    value={conversationSearch}
                                    onChange={(event) => setConversationSearch(event.target.value)}
                                    placeholder="Buscar dentro de esta conversación"
                                    className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs outline-none focus:border-indigo-400 focus:bg-white"
                                />
                            </div>
                            {conversationSearch.trim() ? (
                                <>
                                    <span className="shrink-0 text-[11px] font-bold text-slate-500">
                                        {conversationMatches.length ? `${conversationMatchIndex + 1}/${conversationMatches.length}` : '0 resultados'}
                                    </span>
                                    <button type="button" disabled={!conversationMatches.length} onClick={() => goToConversationMatch(-1)} className="rounded border border-slate-200 px-2 py-1 text-xs font-black text-slate-600 disabled:opacity-40" aria-label="Coincidencia anterior">↑</button>
                                    <button type="button" disabled={!conversationMatches.length} onClick={() => goToConversationMatch(1)} className="rounded border border-slate-200 px-2 py-1 text-xs font-black text-slate-600 disabled:opacity-40" aria-label="Coincidencia siguiente">↓</button>
                                    <button type="button" onClick={() => setConversationSearch('')} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Limpiar búsqueda"><X size={13} /></button>
                                </>
                            ) : null}
                        </div>

                        <div ref={messagesPaneRef} className="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_120px)] px-4 py-4">
                            {messages.length === 0 ? (
                                <div className="flex h-full min-h-[160px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/70 text-sm text-slate-500">
                                    Aún no hay mensajes en este ticket.
                                </div>
                            ) : null}
                            <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
                            {messages.map((message, messageIndex) => {
                                const attachments = normalizeMessageAttachments(message.attachments);
                                const isAdminMessage = message.sender_type === 'Admin';
                                const isSystemMessage = message.sender_type === 'System';
                                const isPrivateMessage = message.visibility === 'private';
                                const isLatestMessage = messageIndex === messages.length - 1;
                                const isExpanded = messageExpansion[message.id] ?? isLatestMessage;
                                const senderLabel = isPrivateMessage ? 'Nota interna' : isAdminMessage ? 'Cloud Admin' : isSystemMessage ? 'Sistema' : getContactLabel(selectedTicket);

                                return (
                                    <div
                                        key={message.id}
                                        ref={(element) => { messageElementRefs.current[message.id] = element; }}
                                        className={`rounded-xl ${conversationMatches[conversationMatchIndex]?.id === message.id ? 'ring-2 ring-yellow-300 ring-offset-2' : ''}`}
                                    >
                                        <article className={`overflow-hidden rounded-xl border text-sm shadow-sm transition-colors ${isPrivateMessage ? 'border-amber-300 bg-amber-50 text-amber-950' : isAdminMessage ? 'border-blue-100 bg-blue-50 text-slate-800' : isSystemMessage ? 'border-slate-200 bg-slate-50 text-slate-500' : 'border-slate-200 bg-white text-slate-700'}`}>
                                            <button
                                                type="button"
                                                onClick={() => setMessageExpansion((current) => ({ ...current, [message.id]: !isExpanded }))}
                                                className="flex w-full items-start gap-3 px-4 py-3 text-left outline-none hover:bg-slate-950/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                                                aria-expanded={isExpanded}
                                                aria-controls={`support-message-${message.id}`}
                                            >
                                                <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-black ${isPrivateMessage ? 'bg-amber-200 text-amber-900' : isAdminMessage ? 'bg-blue-600 text-white' : isSystemMessage ? 'bg-slate-200 text-slate-600' : 'bg-violet-100 text-violet-700'}`}>
                                                    {senderLabel.split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase() || 'M'}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="flex items-center gap-2">
                                                        <span className="truncate font-bold">{senderLabel}</span>
                                                        <span className="shrink-0 text-xs font-medium text-slate-500">{formatTime(message.created_at)}</span>
                                                        {attachments.length ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold text-slate-500"><Paperclip size={10} />{attachments.length}</span> : null}
                                                    </span>
                                                    {!isExpanded ? (
                                                        <span className="mt-1 block truncate text-sm font-normal text-slate-600">{message.message.replace(/\s+/g, ' ').trim() || 'Mensaje sin contenido'}</span>
                                                    ) : null}
                                                </span>
                                                {isExpanded ? <ChevronDown className="mt-1 shrink-0 text-slate-400" size={17} /> : <ChevronRight className="mt-1 shrink-0 text-slate-400" size={17} />}
                                            </button>

                                            {isExpanded ? <div id={`support-message-${message.id}`} className="border-t border-current/10 px-5 py-4">
                                            <p className="whitespace-pre-wrap break-words text-pretty leading-6">{renderHighlightedText(message.message, conversationSearch)}</p>

                                            {isAdminMessage && !isPrivateMessage && message.delivery_status && (
                                                <div className={`mt-2 flex items-center justify-end gap-1 text-[10px] font-semibold ${['failed', 'bounced'].includes(message.delivery_status) ? 'text-red-600' : 'text-slate-500'}`}>
                                                    {message.delivery_status === 'sent' || message.delivery_status === 'delivered' ? <CheckCircle2 size={11} /> : ['failed', 'bounced'].includes(message.delivery_status) ? <AlertTriangle size={11} /> : <Clock3 size={11} />}
                                                    {message.delivery_status === 'bounced' ? 'Correo rebotado' : message.delivery_status === 'failed' ? 'Falló la entrega' : message.delivery_status === 'delivered' ? 'Entregado' : message.delivery_status === 'queued' ? 'En cola' : 'Enviado'}
                                                    {['failed', 'bounced'].includes(message.delivery_status) && <button type="button" onClick={() => void retryDelivery(message)} className="ml-1 rounded border border-white/30 px-1.5 py-0.5 hover:bg-white/10">Reintentar</button>}
                                                </div>
                                            )}

                                            {attachments.length ? (
                                                <div className="mt-3 grid gap-2">
                                                    {attachments.map((attachment, index) => {
                                                        const fileName = getAttachmentName(attachment);
                                                        const canOpen = Boolean(attachment.signed_url);
                                                        const content = (
                                                            <>
                                                                <div className={`h-16 w-20 shrink-0 overflow-hidden rounded-lg border ${isAdminMessage ? 'border-white/20 bg-white/10' : 'border-slate-200 bg-slate-50'}`}>
                                                                    {canOpen && isImageAttachment(attachment) ? (
                                                                        <img
                                                                            src={attachment.signed_url ?? undefined}
                                                                            alt={fileName}
                                                                            className="h-full w-full object-cover"
                                                                            loading="lazy"
                                                                        />
                                                                    ) : (
                                                                        <div className={`flex h-full w-full items-center justify-center ${isAdminMessage ? 'text-white/80' : 'text-slate-400'}`}>
                                                                            {isImageAttachment(attachment) ? <ImageIcon size={22} /> : <Paperclip size={22} />}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="flex min-w-0 items-center gap-1">
                                                                        <span className="truncate text-xs font-bold">{fileName}</span>
                                                                        {canOpen && <ExternalLink className="shrink-0 opacity-70" size={12} />}
                                                                    </div>
                                                                    <p className={`mt-1 text-[11px] ${isAdminMessage ? 'text-white/75' : 'text-slate-500'}`}>
                                                                        {formatAttachmentSize(attachment.size_bytes)}
                                                                    </p>
                                                                    {!canOpen && (
                                                                        <p className={`mt-1 text-[11px] font-medium ${isAdminMessage ? 'text-white/70' : 'text-amber-700'}`}>
                                                                            {attachment.error || 'Archivo no disponible'}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            </>
                                                        );

                                                        const className = `flex min-w-0 items-center gap-3 rounded-xl border p-2 text-left ${isAdminMessage ? 'border-white/20 bg-white/10 text-white' : 'border-slate-200 bg-slate-50 text-slate-700'}`;
                                                        const hoverClassName = isAdminMessage ? 'hover:bg-white/15' : 'hover:bg-slate-100';

                                                        return canOpen ? (
                                                            <a
                                                                key={attachment.id ?? `${fileName}-${index}`}
                                                                href={attachment.signed_url ?? undefined}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className={`${className} ${hoverClassName}`}
                                                            >
                                                                {content}
                                                            </a>
                                                        ) : (
                                                            <div key={attachment.id ?? `${fileName}-${index}`} className={className}>
                                                                {content}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ) : null}
                                            </div> : null}
                                        </article>
                                    </div>
                                );
                            })}
                            </div>
                        </div>

                        <div className="shrink-0 border-t border-slate-200 bg-slate-50 p-4">
                            <div className="mx-auto w-full max-w-6xl rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                                {workspacePresence.some((presence) => presence.admin_user_id !== currentActorId) && (
                                    <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                                        <Users size={14} />
                                        {workspacePresence.filter((presence) => presence.admin_user_id !== currentActorId).map((presence) => normalizeRelation(presence.cloud_admin_users)?.full_name ?? 'Otro agente').join(', ')} también está viendo este ticket.
                                    </div>
                                )}
                                <div className="mb-3 flex flex-wrap items-center gap-2">
                                    <button type="button" onClick={() => { setIsComposerOpen(true); setIsPrivateNote(false); setReplyMode('reply'); setShowReplyOptions(false); }} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold ${isComposerOpen && !isPrivateNote && replyMode === 'reply' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}><Send size={12} /> Responder</button>
                                    <button type="button" onClick={() => { setIsComposerOpen(true); setIsPrivateNote(false); setReplyMode('reply_all'); setShowReplyOptions(true); }} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold ${isComposerOpen && !isPrivateNote && replyMode === 'reply_all' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}><ReplyAll size={12} /> Responder a todos</button>
                                    <button type="button" onClick={() => { setIsComposerOpen(true); setIsPrivateNote(false); setReplyMode('forward'); setShowReplyOptions(true); }} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold ${isComposerOpen && replyMode === 'forward' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}><Forward size={12} /> Reenviar</button>
                                    <button type="button" onClick={() => { setIsComposerOpen(true); setIsPrivateNote(true); setReplyMode('reply'); setShowReplyOptions(false); }} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold ${isComposerOpen && isPrivateNote ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-600'}`}><StickyNote size={12} /> Nota interna</button>
                                    <FileText className="ml-auto text-slate-400" size={14} />
                                    <select defaultValue="" onChange={(event) => { setIsComposerOpen(true); setIsPrivateNote(false); setReplyMode('reply'); applyReplyTemplate(event.target.value); event.target.value = ''; }} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600">
                                        <option value="">Plantilla…</option>
                                        {replyTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                                    </select>
                                    {isComposerOpen ? <button type="button" onClick={() => setIsComposerOpen(false)} className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-700" title="Ocultar editor" aria-label="Ocultar editor"><X size={13} /></button> : null}
                                </div>
                                {isComposerOpen ? (
                                <>
                                {showReplyOptions && !isPrivateNote && (
                                    <div className="mb-3 grid gap-2 sm:grid-cols-2">
                                        {replyMode === 'forward' ? (
                                            <label className="sm:col-span-2"><span className="mb-1 block text-[10px] font-bold uppercase text-slate-400">Reenviar a</span><input value={forwardTo} onChange={(event) => setForwardTo(event.target.value)} type="email" className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-blue-400" placeholder="persona@empresa.com" /></label>
                                        ) : (
                                            <>
                                                <label><span className="mb-1 block text-[10px] font-bold uppercase text-slate-400">CC</span><input value={ccText} onChange={(event) => setCcText(event.target.value)} className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-blue-400" placeholder="correo1@empresa.com, correo2…" /></label>
                                                <label><span className="mb-1 block text-[10px] font-bold uppercase text-slate-400">BCC</span><input value={bccText} onChange={(event) => setBccText(event.target.value)} className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-blue-400" /></label>
                                            </>
                                        )}
                                    </div>
                                )}
                                {selectedTicket.insight?.suggested_replies?.length ? (
                                    <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                                        {selectedTicket.insight.suggested_replies.slice(0, 3).map((reply) => (
                                            <button
                                                key={reply}
                                                type="button"
                                                onClick={() => setReplyText(reply)}
                                                className="shrink-0 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-left text-xs font-medium text-violet-700 hover:bg-violet-100"
                                            >
                                                {reply.slice(0, 92)}
                                            </button>
                                        ))}
                                    </div>
                                ) : null}

                                <input
                                    ref={replyFileInputRef}
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp,image/gif"
                                    multiple
                                    className="hidden"
                                    onChange={handleReplyAttachmentSelection}
                                />

                                {pendingReplyAttachments.length ? (
                                    <div className="mb-3 flex flex-wrap gap-2">
                                        {pendingReplyAttachments.map((attachment) => (
                                            <div
                                                key={attachment.id}
                                                className="group relative h-20 w-20 overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
                                            >
                                                <img
                                                    src={attachment.previewUrl}
                                                    alt={attachment.file.name}
                                                    className="h-full w-full object-cover"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => removePendingReplyAttachment(attachment.id)}
                                                    className="absolute right-1 top-1 rounded-full bg-slate-900/75 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
                                                    aria-label="Quitar adjunto"
                                                >
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}

                                {replyAttachmentError ? (
                                    <p className="mb-3 text-xs font-medium text-red-600">{replyAttachmentError}</p>
                                ) : null}

                                <div className={`overflow-hidden rounded-xl border bg-white focus-within:ring-2 ${isPrivateNote ? 'border-amber-300 focus-within:border-amber-500 focus-within:ring-amber-200' : 'border-slate-300 focus-within:border-blue-500 focus-within:ring-blue-500/30'}`}>
                                    <textarea
                                        ref={replyTextareaRef}
                                        rows={1}
                                        value={replyText}
                                        onChange={(event) => setReplyText(event.target.value)}
                                        placeholder={isPrivateNote ? 'Escribe una nota visible solo para el equipo…' : replyMode === 'forward' ? 'Agrega contexto al reenvío…' : 'Escribe tu respuesta…'}
                                        className="max-h-[240px] min-h-[44px] w-full resize-none overflow-hidden border-0 px-3 py-2.5 text-sm leading-5 outline-none focus:ring-0"
                                    />
                                    <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-2 py-2">
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => replyFileInputRef.current?.click()}
                                                disabled={isSendingReply || pendingReplyAttachments.length >= MAX_REPLY_ATTACHMENTS}
                                                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                                                title="Adjuntar imagen"
                                            >
                                                <Paperclip size={14} />
                                                Adjuntar
                                            </button>
                                            <button
                                                type="button"
                                                onClick={generateDraft}
                                                disabled={isGeneratingDraft}
                                                className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                <Wand2 size={14} />
                                                {isGeneratingDraft ? 'Generando...' : 'Borrador IA'}
                                            </button>
                                            <span className="hidden items-center gap-1 text-[10px] font-medium text-slate-400 sm:inline-flex">
                                                {draftStatus === 'saving' ? <Loader2 className="animate-spin" size={11} /> : draftStatus === 'saved' ? <CheckCircle2 size={11} /> : null}
                                                {draftStatus === 'saving' ? 'Guardando…' : draftStatus === 'saved' ? 'Borrador guardado' : draftStatus === 'error' ? 'Error al guardar' : ''}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleSendReply}
                                            disabled={isSendingReply || (!replyText.trim() && pendingReplyAttachments.length === 0)}
                                            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {isSendingReply ? 'Enviando...' : isPrivateNote ? 'Guardar nota' : replyMode === 'forward' ? 'Reenviar' : getTicketRecipientEmail(selectedTicket) ? 'Enviar y notificar' : 'Enviar'}
                                            <Send size={14} />
                                        </button>
                                    </div>
                                </div>
                                </>
                                ) : null}
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-slate-50 text-slate-400">
                        <MessageSquare className="mb-4 text-slate-300" size={56} />
                        <p className="font-medium text-slate-600">Selecciona un ticket para comenzar</p>
                    </div>
                )}
            </main>

            {selectedTicket && showContextPanel && !isFocusMode && (
                <aside className="flex min-h-0 w-[300px] shrink-0 flex-col overflow-hidden border-l border-slate-200 bg-white">
                    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 p-4">
                        <div>
                            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-800">Contexto</h3>
                            <p className="mt-1 text-xs text-slate-500">Tenant, contacto y señales técnicas</p>
                        </div>
                        <button type="button" onClick={() => setShowContextPanel(false)} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:text-indigo-700" title="Ocultar contexto"><PanelRightClose size={15} /></button>
                    </div>

                    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
                        <section>
                            <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-500"><Users size={13} /> Asignación</h4>
                            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Departamento / transferir a</p>
                                <select
                                    value={selectedTicket.team_id ?? ''}
                                    onChange={(event) => void updateSelectedTicketFields({
                                        team_id: event.target.value || null,
                                        assignee_id: null,
                                        assignment_status: 'needs_assignment',
                                    })}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs outline-none focus:border-blue-400"
                                >
                                    <option value="">Sin departamento</option>
                                    {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                                </select>
                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Persona asignada</p>
                                <select
                                    value={selectedTicket.assignee_id ?? ''}
                                    onChange={(event) => void updateSelectedTicketFields({ assignee_id: event.target.value || null, assignment_status: event.target.value ? 'assigned' : 'needs_assignment' })}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs outline-none focus:border-blue-400"
                                >
                                    <option value="">Sin agente</option>
                                    {agents
                                        .filter((agent) => agent.helpdesk_all_departments
                                            || !selectedTicket.team_id
                                            || agent.support_team_members?.some((membership) => membership.team_id === selectedTicket.team_id))
                                        .map((agent) => <option key={agent.id} value={agent.id}>{agent.full_name}</option>)}
                                </select>
                            </div>
                        </section>

                        <section>
                            <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-500"><Tag size={13} /> Etiquetas</h4>
                            <div className="rounded-lg border border-slate-200 bg-white p-3">
                                <div className="mb-2 flex flex-wrap gap-1">
                                    {(selectedTicket.tags ?? []).map((tag) => (
                                        <button key={tag} type="button" title="Quitar etiqueta" onClick={() => void updateSelectedTicketFields({ tags: (selectedTicket.tags ?? []).filter((item) => item !== tag) })} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:border-red-200 hover:text-red-600">{tag} ×</button>
                                    ))}
                                    {!selectedTicket.tags?.length && <span className="text-xs text-slate-400">Sin etiquetas</span>}
                                </div>
                                <div className="flex gap-1.5">
                                    <input value={tagInput} onChange={(event) => setTagInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addTagToSelectedTicket(); } }} placeholder="Agregar etiqueta" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-blue-400" />
                                    <button type="button" onClick={() => void addTagToSelectedTicket()} className="rounded-lg bg-slate-900 px-2.5 text-xs font-bold text-white">+</button>
                                </div>
                            </div>
                        </section>

                        {selectedTicket.insight && (
                            <section>
                                <h4 className="mb-2 text-xs font-semibold text-slate-500">IA operativa</h4>
                                <div className="space-y-3 rounded-lg border border-violet-100 bg-violet-50 p-3 text-xs">
                                    {selectedTicket.insight.duplicate_signal && (
                                        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-800">
                                            <AlertTriangle className="mt-0.5 shrink-0" size={14} />
                                            Posible patrón repetido o falla masiva.
                                        </div>
                                    )}
                                    {selectedTicket.insight.urgency_reason && (
                                        <div>
                                            <p className="font-bold uppercase tracking-wide text-violet-700">Razón de prioridad</p>
                                            <p className="mt-1 text-violet-950">{selectedTicket.insight.urgency_reason}</p>
                                        </div>
                                    )}
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="rounded-lg border border-violet-100 bg-white p-2">
                                            <p className="font-bold text-violet-700">Módulo</p>
                                            <p className="mt-1 text-slate-700">{selectedTicket.insight.affected_module || 'No detectado'}</p>
                                        </div>
                                        <div className="rounded-lg border border-violet-100 bg-white p-2">
                                            <p className="font-bold text-violet-700">Empresa</p>
                                            <p className="mt-1 text-slate-700">{selectedTicket.insight.detected_company || 'No detectada'}</p>
                                        </div>
                                    </div>
                                    {selectedTicket.insight.detected_phone && (
                                        <div className="rounded-lg border border-violet-100 bg-white p-2">
                                            <p className="font-bold text-violet-700">Teléfono detectado</p>
                                            <p className="mt-1 text-slate-700">{selectedTicket.insight.detected_phone}</p>
                                        </div>
                                    )}
                                    {selectedTicket.insight.detected_identifiers?.length ? (
                                        <div className="rounded-lg border border-violet-100 bg-white p-2">
                                            <p className="font-bold text-violet-700">Datos detectados</p>
                                            <p className="mt-1 text-slate-700">{selectedTicket.insight.detected_identifiers.join(' · ')}</p>
                                        </div>
                                    ) : null}
                                    {selectedTicket.insight.ai_tags?.length ? (
                                        <div className="flex flex-wrap gap-1">
                                            {selectedTicket.insight.ai_tags.slice(0, 6).map((tag) => (
                                                <span key={tag} className="rounded-full border border-violet-200 bg-white px-2 py-0.5 font-bold text-violet-700">
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                            </section>
                        )}

                        <section>
                            <h4 className="mb-2 text-xs font-semibold text-slate-500">Contacto</h4>
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                                <p className="font-bold text-slate-800">{getContactLabel(selectedTicket)}</p>
                                <p className="mt-1 text-xs text-slate-500">{selectedTicket.contact?.company_name || selectedTicket.tenant_name}</p>

                                {getTicketRecipientEmail(selectedTicket) && (
                                    <button
                                        onClick={openContactModal}
                                        disabled={isCreatingContact}
                                        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        <UserPlus size={14} />
                                        {selectedTicket.contact?.company_name || selectedTicket.contact?.phone ? 'Editar contacto' : 'Convertir en contacto'}
                                    </button>
                                )}

                                {selectedTicket.contact?.metadata?.sla && (
                                    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-600">
                                        SLA: <span className="font-bold text-slate-800">{slaLabels[selectedTicket.contact.metadata.sla] ?? selectedTicket.contact.metadata.sla}</span>
                                    </div>
                                )}

                                {selectedTicket.contact && (
                                    <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-xs">
                                        <div className="flex items-center justify-between">
                                            <span className="text-slate-500">Contrato</span>
                                            <span className={`rounded-full px-2 py-0.5 font-bold ${selectedTicket.contact.has_retainership ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                                                {selectedTicket.contact.has_retainership ? 'Iguala' : 'Sin iguala'}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between"><span className="text-slate-500">Renovación</span><span className="font-bold text-slate-800">{formatCustomerDate(selectedTicket.contact.renewal_at)}</span></div>
                                        <div>
                                            <p className="mb-1 font-bold text-slate-700">Servicios activos</p>
                                            <div className="flex flex-wrap gap-1">
                                                {(selectedTicket.contact.customer_services ?? []).filter((service) => service.status === 'active').map((service) => (
                                                    <span key={service.id} className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-1 font-bold text-indigo-700">{service.service_name} × {service.quantity}</span>
                                                ))}
                                                {!(selectedTicket.contact.customer_services ?? []).some((service) => service.status === 'active') ? <span className="text-slate-400">Sin servicios registrados</span> : null}
                                            </div>
                                        </div>
                                        {selectedTicket.contact.administrative_notes ? <p className="rounded-lg border border-amber-100 bg-amber-50 p-2 text-amber-800">{selectedTicket.contact.administrative_notes}</p> : null}
                                    </div>
                                )}

                                {selectedTicket.assignment_status === 'needs_assignment' && (
                                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                                        <AlertTriangle className="mt-0.5 shrink-0" size={14} />
                                        Falta vincular este contacto a un tenant.
                                    </div>
                                )}
                            </div>
                        </section>

                        <section>
                            <h4 className="mb-2 text-xs font-semibold text-slate-500">Tenant Health</h4>
                            <div className="space-y-2 rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-xs">
                                <div className="flex items-center justify-between">
                                    <span className="font-medium text-emerald-700">Estado</span>
                                    <span className="font-bold text-emerald-900">{selectedTicket.tenant_id ? 'Conectado' : 'No vinculado'}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="flex items-center gap-1 text-emerald-700"><BatteryLow size={13} /> Batería</span>
                                    <span className="font-bold text-emerald-900">{selectedTicket.technical_context?.battery_level || 'N/A'}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="flex items-center gap-1 text-emerald-700"><WifiOff size={13} /> Red</span>
                                    <span className="font-bold text-emerald-900">{selectedTicket.technical_context?.network_type || 'N/A'}</span>
                                </div>
                            </div>
                        </section>

                        <section>
                            <h4 className="mb-2 text-xs font-semibold text-slate-500">Últimos errores</h4>
                            <div className="rounded-lg bg-slate-950 p-3 font-mono text-[11px] text-emerald-300">
                                {selectedTicket.technical_context?.last_5_errors?.length
                                    ? selectedTicket.technical_context.last_5_errors.map((error) => <p key={error}>{error}</p>)
                                    : <p>No hay errores locales registrados.</p>}
                            </div>
                        </section>

                        <section>
                            <h4 className="mb-2 text-xs font-semibold text-slate-500">Acciones rápidas</h4>
                            <div className="space-y-2">
                                <button
                                    onClick={openImprovementModal}
                                    className="flex w-full items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs font-medium text-amber-800 hover:bg-amber-100"
                                >
                                    Marcar como mejora
                                    <Lightbulb size={13} />
                                </button>
                                <button onClick={refreshTickets} className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-medium text-slate-600 hover:bg-slate-50">
                                    Actualizar bandeja
                                    <RefreshCw size={13} />
                                </button>
                                <button onClick={() => void createPreventiveTicket()} className="flex w-full items-center justify-between rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-left text-xs font-medium text-violet-700 hover:bg-violet-100">
                                    Crear ticket preventivo
                                    <Sparkles size={13} />
                                </button>
                                {selectedTicket.assignment_status === 'spam' ? (
                                    <button disabled={!canDeleteTickets} onClick={() => void restoreSpamTickets([selectedTicket.id])} className="flex w-full items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-left text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40">
                                        Restaurar: no es spam
                                        <RefreshCw size={13} />
                                    </button>
                                ) : (
                                    <button disabled={!canDeleteTickets} onClick={() => void markTicketsAsSpam([selectedTicket.id])} className="flex w-full items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-left text-xs font-medium text-red-800 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40">
                                        Marcar como spam
                                        <AlertTriangle size={13} />
                                    </button>
                                )}
                                <button
                                    onClick={() => requestTicketDeletion([selectedTicket.id])}
                                    disabled={!canDeleteTickets}
                                    className="flex w-full items-center justify-between rounded-lg border border-red-300 bg-white px-3 py-2 text-left text-xs font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                                    title={canDeleteTickets ? 'Eliminar permanentemente' : 'Requiere permiso Gestionar HelpDesk'}
                                >
                                    Eliminar ticket
                                    <Trash2 size={13} />
                                </button>
                            </div>
                        </section>
                    </div>
                </aside>
            )}
            </div>
            </div>
            ) : null}

            {isAssignmentDashboardOpen && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-3" role="dialog" aria-modal="true" aria-labelledby="assignment-dashboard-title">
                    <div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                        <div className="flex items-start gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
                            <div className="rounded-xl bg-indigo-100 p-2.5 text-indigo-700"><BarChart3 size={22} /></div>
                            <div className="min-w-0 flex-1">
                                <h2 id="assignment-dashboard-title" className="text-lg font-black text-slate-900">Operación de agentes</h2>
                                <p className="mt-0.5 text-sm text-slate-500">Carga activa, resultados por agente y tickets fuera de SLA.</p>
                            </div>
                            <button type="button" onClick={() => setIsAssignmentDashboardOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-white" aria-label="Cerrar"><X size={18} /></button>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto p-5">
                            {isLoadingAssignmentDashboard && !assignmentDashboard ? (
                                <div className="flex min-h-72 items-center justify-center gap-2 text-sm font-bold text-slate-500"><Loader2 size={18} className="animate-spin" />Cargando operación…</div>
                            ) : assignmentDashboard ? (
                                <div className="space-y-5">
                                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                        {[
                                            ['Sin asignar', assignmentDashboard.unassigned_count, 'text-amber-700 bg-amber-50 border-amber-200'],
                                            ['Asignados activos', assignmentDashboard.assigned_tickets.length, 'text-indigo-700 bg-indigo-50 border-indigo-200'],
                                            ['Resueltos · 30 días', assignmentDashboard.resolved_tickets.length, 'text-emerald-700 bg-emerald-50 border-emerald-200'],
                                            ['Fuera de SLA', assignmentDashboard.overdue_tickets.length, 'text-red-700 bg-red-50 border-red-200'],
                                        ].map(([label, value, color]) => (
                                            <div key={String(label)} className={`rounded-xl border p-4 ${color}`}>
                                                <p className="text-xs font-bold uppercase tracking-wide">{label}</p>
                                                <p className="mt-1 text-3xl font-black">{value}</p>
                                            </div>
                                        ))}
                                    </div>

                                    {canManageAssignments && (
                                        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-indigo-200 bg-indigo-50/70 p-4">
                                            <label className="block">
                                                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-indigo-700">Modo Copilot</span>
                                                <select value={assignmentDashboard.settings.assignment_copilot_mode} onChange={(event) => void changeAssignmentMode(event.target.value as HelpdeskAssignmentMode)} className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
                                                    <option value="off">Desactivado</option>
                                                    <option value="suggest">Solo sugerir</option>
                                                    <option value="auto">Asignación automática</option>
                                                </select>
                                            </label>
                                            <p className="min-w-56 flex-1 text-xs leading-5 text-indigo-800">En automático, cada ticket nuevo se asigna solo cuando la recomendación supera {Math.round(assignmentDashboard.settings.assignment_copilot_min_confidence * 100)}% de confianza.</p>
                                            <button type="button" onClick={() => void runCopilotAssignment()} disabled={isRunningCopilotAssignment || assignmentDashboard.unassigned_count === 0} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                                                {isRunningCopilotAssignment ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                                                Asignar pendientes
                                            </button>
                                        </div>
                                    )}

                                    <section>
                                        <h3 className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Rendimiento por agente</h3>
                                        <div className="overflow-x-auto rounded-xl border border-slate-200">
                                            <table className="w-full min-w-[760px] text-left text-xs">
                                                <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Agente</th><th className="px-3 py-2">Carga</th><th className="px-3 py-2">Resueltos</th><th className="px-3 py-2">Retrasados</th><th className="px-3 py-2">1ª respuesta</th><th className="px-3 py-2">Resolución</th><th className="px-3 py-2">Valoración</th></tr></thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {assignmentDashboard.metrics.map((metric) => (
                                                        <tr key={metric.agent_id} className="text-slate-700">
                                                            <td className="px-3 py-3"><span className="block font-bold text-slate-900">{metric.full_name}</span><span className={metric.is_available ? 'text-emerald-600' : 'text-slate-400'}>{metric.is_available ? 'Disponible' : 'No disponible'}</span></td>
                                                            <td className="px-3 py-3"><span className="font-bold">{metric.active_tickets}/{metric.max_active_tickets}</span><span className="ml-2 text-slate-400">{metric.load_ratio}%</span>{metric.critical_tickets ? <span className="ml-2 text-red-600">{metric.critical_tickets} críticos</span> : null}</td>
                                                            <td className="px-3 py-3 font-bold text-emerald-700">{metric.resolved_tickets}</td>
                                                            <td className={`px-3 py-3 font-bold ${metric.overdue_tickets ? 'text-red-700' : 'text-slate-500'}`}>{metric.overdue_tickets}</td>
                                                            <td className="px-3 py-3">{formatMetricMinutes(metric.average_first_response_minutes)}</td>
                                                            <td className="px-3 py-3">{formatMetricMinutes(metric.average_resolution_minutes)}</td>
                                                            <td className="px-3 py-3">{metric.average_rating === null ? '—' : `${metric.average_rating.toFixed(1)} / 5`}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </section>

                                    <section>
                                        <div className="mb-3 flex flex-wrap gap-2">
                                            {([
                                                ['assigned', `Asignados (${assignmentDashboard.assigned_tickets.length})`],
                                                ['resolved', `Resueltos (${assignmentDashboard.resolved_tickets.length})`],
                                                ['overdue', `Retrasados (${assignmentDashboard.overdue_tickets.length})`],
                                            ] as const).map(([tab, label]) => <button key={tab} type="button" onClick={() => setAssignmentDashboardTab(tab)} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${assignmentDashboardTab === tab ? 'border-indigo-400 bg-indigo-100 text-indigo-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{label}</button>)}
                                        </div>
                                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                                            {(assignmentDashboardTab === 'assigned' ? assignmentDashboard.assigned_tickets : assignmentDashboardTab === 'resolved' ? assignmentDashboard.resolved_tickets : assignmentDashboard.overdue_tickets).map((ticket) => {
                                                const agent = agents.find((item) => item.id === ticket.assignee_id);
                                                const eventDate = assignmentDashboardTab === 'resolved' ? ticket.resolved_at : assignmentDashboardTab === 'overdue' ? (ticket.resolution_due_at ?? ticket.first_response_due_at) : ticket.assigned_at;
                                                return <button key={ticket.id} type="button" onClick={() => openDashboardTicket(ticket)} className="rounded-xl border border-slate-200 p-3 text-left hover:border-indigo-300 hover:bg-indigo-50/40"><span className="text-[10px] font-black uppercase tracking-wide text-indigo-600">#{ticket.ticket_number ?? '—'} · {ticket.priority}</span><span className="mt-1 block truncate text-sm font-bold text-slate-900">{ticket.subject}</span><span className="mt-1 block truncate text-xs font-semibold text-slate-600"><Building2 size={11} className="mr-1 inline" />{getDashboardTicketCompany(ticket)}</span><span className="mt-2 block text-[11px] text-slate-500">{agent?.full_name ?? 'Sin agente'}{eventDate ? ` · ${formatCustomerDate(eventDate)}` : ''}</span></button>;
                                            })}
                                        </div>
                                    </section>
                                </div>
                            ) : null}
                            {assignmentDashboardError && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{assignmentDashboardError}</div>}
                        </div>
                    </div>
                </div>
            )}

            {deleteTicketIds.length > 0 && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-ticket-title">
                    <div className="w-full max-w-lg overflow-hidden rounded-xl border border-red-200 bg-white shadow-2xl">
                        <div className="flex items-start gap-3 border-b border-red-100 bg-red-50 p-5">
                            <div className="rounded-full bg-red-100 p-2 text-red-700"><Trash2 size={18} /></div>
                            <div className="min-w-0 flex-1">
                                <h3 id="delete-ticket-title" className="text-lg font-black text-slate-900">Eliminar {deleteTicketIds.length === 1 ? 'ticket' : `${deleteTicketIds.length} tickets`}</h3>
                                <p className="mt-1 text-sm text-slate-600">Esta acción es irreversible. Se borrarán la conversación, borradores, presencia, auditoría de IA y archivos adjuntos asociados.</p>
                            </div>
                            <button type="button" onClick={() => { setDeleteTicketIds([]); setDeleteReason(''); }} disabled={isDeletingTickets} className="rounded-lg p-2 text-slate-500 hover:bg-white" aria-label="Cerrar"><X size={16} /></button>
                        </div>
                        <div className="space-y-3 p-5">
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Tickets seleccionados</p>
                            <div className="max-h-28 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                                {deleteTicketIds.map((ticketId) => {
                                    const ticket = tickets.find((item) => item.id === ticketId);
                                    return <p key={ticketId} className="truncate"><span className="font-bold">{ticket ? getTicketNumberLabel(ticket) : ticketId}</span>{ticket?.subject ? ` · ${ticket.subject}` : ''}</p>;
                                })}
                            </div>
                            <label className="block">
                                <span className="mb-1 block text-xs font-bold text-slate-700">Motivo del borrado</span>
                                <textarea
                                    value={deleteReason}
                                    onChange={(event) => setDeleteReason(event.target.value)}
                                    rows={3}
                                    maxLength={500}
                                    autoFocus
                                    placeholder="Ej. Spam confirmado, prueba interna o duplicado inválido"
                                    className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
                                />
                                <span className="mt-1 block text-[11px] text-slate-500">El motivo quedará en el registro de auditoría.</span>
                            </label>
                        </div>
                        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 p-4">
                            <button type="button" onClick={() => { setDeleteTicketIds([]); setDeleteReason(''); }} disabled={isDeletingTickets} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 disabled:opacity-50">Cancelar</button>
                            <button type="button" onClick={() => void confirmTicketDeletion()} disabled={isDeletingTickets || deleteReason.trim().length < 3} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
                                {isDeletingTickets ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                                {isDeletingTickets ? 'Eliminando...' : 'Eliminar permanentemente'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isImprovementModalOpen && selectedTicket && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
                    <div className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl">
                        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
                            <div>
                                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">
                                    <Lightbulb size={14} />
                                    Mejora solicitada
                                </div>
                                <h2 className="text-lg font-black text-slate-900">Enviar caso a mejoras</h2>
                                <p className="mt-1 text-sm text-slate-500">Se creara una oportunidad vinculada al ticket y se notificara al cliente.</p>
                            </div>
                            <button
                                onClick={closeImprovementModal}
                                className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50"
                                aria-label="Cerrar"
                                type="button"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="space-y-4 p-5">
                            <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
                                <label className="block">
                                    <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Titulo</span>
                                    <input
                                        value={improvementDraft.title}
                                        onChange={(event) => updateImprovementDraft('title', event.target.value)}
                                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                        placeholder="Ej. Promociones por forma de pago"
                                    />
                                </label>
                                <label className="block">
                                    <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Prioridad</span>
                                    <select
                                        value={improvementDraft.priority}
                                        onChange={(event) => updateImprovementDraft('priority', event.target.value as ImprovementPriority)}
                                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                    >
                                        <option value="Baja">Baja</option>
                                        <option value="Media">Media</option>
                                        <option value="Alta">Alta</option>
                                        <option value="Critica">Critica</option>
                                    </select>
                                </label>
                            </div>

                            <label className="block">
                                <span className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                                    Modulo afectado
                                    <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] text-violet-700">Sugerido por IA</span>
                                </span>
                                <input
                                    value={improvementDraft.affectedModule}
                                    onChange={(event) => updateImprovementDraft('affectedModule', event.target.value)}
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                    placeholder="ERP, POS, Promociones, Activos fijos..."
                                />
                            </label>

                            <label className="block">
                                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Solicitud del cliente</span>
                                <textarea
                                    value={improvementDraft.requestedCapability}
                                    onChange={(event) => updateImprovementDraft('requestedCapability', event.target.value)}
                                    rows={4}
                                    className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                    placeholder="Describe lo que el cliente esta solicitando..."
                                />
                            </label>

                            <label className="block">
                                <span className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                                    Impacto operativo
                                    <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] text-violet-700">Sugerido por IA</span>
                                </span>
                                <textarea
                                    value={improvementDraft.customerImpact}
                                    onChange={(event) => updateImprovementDraft('customerImpact', event.target.value)}
                                    rows={3}
                                    className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                    placeholder="Ej. Evita doble digitacion, reduce errores, desbloquea cierre de caja..."
                                />
                            </label>

                            {improvementError && (
                                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                                    {improvementError}
                                </div>
                            )}
                            {improvementNotice && (
                                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
                                    {improvementNotice}
                                </div>
                            )}
                        </div>

                        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4">
                            <button
                                onClick={closeImprovementModal}
                                disabled={isSavingImprovement}
                                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                type="button"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleCreateImprovement}
                                disabled={isSavingImprovement}
                                className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                                type="button"
                            >
                                {isSavingImprovement ? <Loader2 className="animate-spin" size={16} /> : <Lightbulb size={16} />}
                                Registrar y notificar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isContactModalOpen && selectedTicket && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
                    <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl">
                        <div className="flex items-center justify-between border-b border-slate-100 p-5">
                            <div>
                                <h3 className="text-lg font-black text-slate-900">Convertir en contacto</h3>
                                <p className="mt-1 text-sm text-slate-500">Completa los datos del remitente y define su nivel de atención.</p>
                            </div>
                            <button
                                onClick={() => setIsContactModalOpen(false)}
                                className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50"
                                type="button"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
                            <label className="block sm:col-span-2">
                                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Nombre</span>
                                <input
                                    value={contactForm.name}
                                    onChange={(event) => setContactForm((current) => ({ ...current, name: event.target.value }))}
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                />
                            </label>
                            <label className="block">
                                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Teléfono</span>
                                <input
                                    value={contactForm.phone}
                                    onChange={(event) => setContactForm((current) => ({ ...current, phone: event.target.value }))}
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                />
                            </label>
                            <label className="block">
                                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">SLA</span>
                                <select
                                    value={contactForm.sla}
                                    onChange={(event) => setContactForm((current) => ({ ...current, sla: event.target.value }))}
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                >
                                    <option value="standard">Estándar</option>
                                    <option value="priority">Prioritario</option>
                                    <option value="critical">Crítico</option>
                                </select>
                            </label>
                            <label className="block sm:col-span-2">
                                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Mail</span>
                                <input
                                    value={contactForm.email}
                                    onChange={(event) => setContactForm((current) => ({ ...current, email: event.target.value }))}
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                />
                            </label>
                            <label className="block sm:col-span-2">
                                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Empresa</span>
                                <input
                                    value={contactForm.companyName}
                                    onChange={(event) => setContactForm((current) => ({ ...current, companyName: event.target.value }))}
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                />
                            </label>
                        </div>

                        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 p-4">
                            <button
                                onClick={() => setIsContactModalOpen(false)}
                                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
                                type="button"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={saveContactFromTicket}
                                disabled={isCreatingContact || !contactForm.email.trim()}
                                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                                type="button"
                            >
                                {isCreatingContact ? 'Guardando...' : 'Guardar contacto'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SupportCommandCenter;

function TicketMetric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
    return (
        <div className="min-w-0 border-b border-r border-slate-200 px-3 py-2.5 last:border-r-0 sm:border-b-0">
            <p className="truncate text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{label}</p>
            <p className={`mt-1 truncate text-xs font-bold ${accent ? 'text-amber-700' : 'text-slate-700'}`}>{value}</p>
        </div>
    );
}

function FilterSelect({ label, value, onChange, children }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    children: React.ReactNode;
}) {
    return (
        <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-slate-600">{label}</span>
            <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700">
                {children}
            </select>
        </label>
    );
}
