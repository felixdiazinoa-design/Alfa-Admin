import { assertHelpdeskTicketAccess, createHelpdeskAdminClient, isAuthorizationError, requireHelpdeskActor } from '../_shared/helpdesk-auth.ts';
import {
    appendHelpdeskEmailSignatureText,
    buildHelpdeskEmailHtmlFromText,
} from '../_shared/helpdesk-email-branding.ts';

declare const Deno: {
    env: {
        get(key: string): string | undefined;
    };
    serve(handler: (request: Request) => Response | Promise<Response>): void;
};

interface OutboundAttachment {
    id?: string;
    name?: string;
    mime_type?: string;
    size_bytes?: number;
    bucket?: string;
    path?: string;
    uploaded_at?: string;
}

interface ReplyPayload {
    ticket_id?: string;
    message?: string;
    message_id?: string;
    attachments?: OutboundAttachment[];
    mode?: 'reply' | 'reply_all' | 'forward';
    cc?: string[];
    bcc?: string[];
    forward_to?: string;
}

interface ResendAttachment {
    filename: string;
    content: string;
    content_type?: string;
}

const HELPDESK_ATTACHMENTS_BUCKET = 'helpdesk-attachments';
const ALLOWED_IMAGE_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
]);

interface SupportContact {
    email?: string | null;
}

interface SupportTicket {
    id: string;
    ticket_number?: number | null;
    subject: string;
    source: string;
    external_sender_email?: string | null;
    first_response_at?: string | null;
    technical_context?: {
        email_thread_message_ids?: string[];
        resend_message_id?: string;
        [key: string]: unknown;
    } | null;
    support_contacts?: SupportContact | SupportContact[] | null;
}

interface AdminMessage {
    id: string;
    message: string;
    delivery_attempts?: number | null;
}

interface IntegrationSettingsRow {
    resend_inbound_email?: string | null;
    resend_from_name?: string | null;
    resend_from_email?: string | null;
}

interface ResendSecretRow {
    secret_ciphertext: string;
    secret_iv: string;
}

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function getEnv(name: string) {
    const value = Deno.env.get(name);
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

function describeError(error: unknown) {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object') {
        const record = error as Record<string, unknown>;
        const parts = [
            typeof record.message === 'string' ? record.message : null,
            typeof record.details === 'string' ? record.details : null,
            typeof record.hint === 'string' ? record.hint : null,
            typeof record.code === 'string' ? `code: ${record.code}` : null,
        ].filter(Boolean);

        if (parts.length) return parts.join(' | ');

        try {
            return JSON.stringify(record);
        } catch {
            return String(error);
        }
    }

    return String(error);
}

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
}

function base64ToBytes(value: string) {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function getDecryptKey() {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(getEnv('INTEGRATION_SECRET_KEY')));
    return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['decrypt']);
}

async function decryptSecret(row: ResendSecretRow) {
    const key = await getDecryptKey();
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBytes(row.secret_iv) },
        key,
        base64ToBytes(row.secret_ciphertext),
    );

    return new TextDecoder().decode(decrypted);
}

function formatFromAddress(name: string, email: string) {
    const cleanName = name.trim() || 'ALFA-Admin Soporte';
    return `${cleanName} <${email.trim().toLowerCase()}>`;
}

function buildThreadSubject(ticket: SupportTicket, mode: ReplyPayload['mode'] = 'reply') {
    const ticketToken = `[Ticket #${ticket.ticket_number ?? ticket.id.slice(0, 8)}]`;
    const cleanSubject = ticket.subject
        .replace(/^\s*(re|fw|fwd):\s*/i, '')
        .replace(ticketToken, '')
        .trim() || 'Solicitud tecnica';

    return `${ticketToken} ${mode === 'forward' ? 'Fwd' : 'Re'}: ${cleanSubject}`;
}

function normalizeEmail(value: unknown) {
    if (typeof value !== 'string') return '';
    const email = value.trim().toLowerCase().slice(0, 254);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function normalizeEmails(value: unknown) {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map(normalizeEmail).filter(Boolean))).slice(0, 20);
}

function normalizeOutboundAttachments(value: unknown): OutboundAttachment[] {
    if (!Array.isArray(value)) return [];

    return value
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
        .map((item) => ({
            id: typeof item.id === 'string' ? item.id : undefined,
            name: typeof item.name === 'string' ? item.name : undefined,
            mime_type: typeof item.mime_type === 'string' ? item.mime_type : undefined,
            size_bytes: typeof item.size_bytes === 'number' ? item.size_bytes : undefined,
            bucket: typeof item.bucket === 'string' ? item.bucket : undefined,
            path: typeof item.path === 'string' ? item.path : undefined,
            uploaded_at: typeof item.uploaded_at === 'string' ? item.uploaded_at : undefined,
        }))
        .filter((attachment) => Boolean(attachment.path));
}

function bytesToBase64(bytes: Uint8Array) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        const chunk = bytes.subarray(index, index + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}

async function buildResendAttachments(
    supabase: ReturnType<typeof createHelpdeskAdminClient>,
    attachments: OutboundAttachment[],
): Promise<ResendAttachment[]> {
    const output: ResendAttachment[] = [];

    for (const attachment of attachments) {
        const bucket = attachment.bucket || HELPDESK_ATTACHMENTS_BUCKET;
        const path = attachment.path;
        if (!path) continue;

        const mimeType = attachment.mime_type && ALLOWED_IMAGE_MIME_TYPES.has(attachment.mime_type)
            ? attachment.mime_type
            : 'application/octet-stream';

        const { data, error } = await supabase.storage.from(bucket).download(path);
        if (error || !data) {
            console.error('Support reply: unable to download attachment', {
                bucket,
                path,
                error: error?.message,
            });
            continue;
        }

        const bytes = new Uint8Array(await data.arrayBuffer());
        output.push({
            filename: attachment.name || path.split('/').filter(Boolean).at(-1) || 'adjunto',
            content: bytesToBase64(bytes),
            content_type: mimeType,
        });
    }

    return output;
}

function buildThreadHeaders(ticket: SupportTicket, storedMessageIds: string[] = []) {
    const legacyMessageIds = Array.isArray(ticket.technical_context?.email_thread_message_ids)
        ? ticket.technical_context.email_thread_message_ids.filter((value): value is string => typeof value === 'string')
        : [];
    const references = Array.from(new Set([
        ...legacyMessageIds,
        ticket.technical_context?.resend_message_id,
        ...storedMessageIds,
    ].filter((value): value is string => Boolean(value))));
    const latestMessageId = storedMessageIds.at(-1)
        ?? ticket.technical_context?.resend_message_id
        ?? legacyMessageIds.at(-1);

    if (!latestMessageId) return undefined;

    return {
        'In-Reply-To': latestMessageId,
        References: references.join(' '),
    };
}

async function assertAuthorized(request: Request) {
    return requireHelpdeskActor(request);
}

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
        return json({ ok: true });
    }

    if (request.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405);
    }

    try {
        const actor = await assertAuthorized(request);

        const payload = await request.json() as ReplyPayload;
        const ticketId = payload.ticket_id?.trim();
        const replyText = payload.message?.trim();
        const existingMessageId = payload.message_id?.trim();
        const mode = payload.mode === 'forward' || payload.mode === 'reply_all' ? payload.mode : 'reply';
        const cc = normalizeEmails(payload.cc);
        const bcc = normalizeEmails(payload.bcc);

        const outboundAttachments = normalizeOutboundAttachments(payload.attachments);

        if (!ticketId || (!replyText && !existingMessageId && outboundAttachments.length === 0)) {
            return json({ error: 'ticket_id and message, message_id, or attachments are required' }, 400);
        }

        const supabase = createHelpdeskAdminClient();
        await assertHelpdeskTicketAccess(supabase, actor, [ticketId]);

        const { data: ticket, error: ticketError } = await supabase
            .from('support_tickets')
            .select(`
                id,
                ticket_number,
                subject,
                source,
                external_sender_email,
                first_response_at,
                technical_context,
                support_contacts (
                    email
                )
            `)
            .eq('id', ticketId)
            .single();

        if (ticketError) throw ticketError;

        const supportTicket = ticket as SupportTicket;
        const { data: storedThreadMessages, error: storedThreadError } = await supabase
            .from('ticket_messages')
            .select('email_message_id')
            .eq('ticket_id', supportTicket.id)
            .not('email_message_id', 'is', null)
            .order('created_at', { ascending: true })
            .limit(100);
        if (storedThreadError) throw storedThreadError;
        const storedThreadMessageIds = (storedThreadMessages ?? [])
            .map((message) => message.email_message_id)
            .filter((messageId): messageId is string => typeof messageId === 'string' && Boolean(messageId));

        const contact = normalizeRelation(supportTicket.support_contacts);
        const recipientEmail = mode === 'forward'
            ? normalizeEmail(payload.forward_to)
            : normalizeEmail(contact?.email || supportTicket.external_sender_email);
        if (!recipientEmail) {
            return json({ error: 'Ticket does not have a recipient email' }, 400);
        }

        let adminMessage: AdminMessage | null = null;
        if (existingMessageId) {
            const { data: messageRow, error: messageError } = await supabase
                .from('ticket_messages')
                .select('id, message, delivery_attempts')
                .eq('id', existingMessageId)
                .eq('ticket_id', ticketId)
                .eq('sender_type', 'Admin')
                .single();

            if (messageError) throw messageError;
            adminMessage = messageRow as AdminMessage;
        }

        const messageText = (adminMessage?.message ?? replyText)?.trim()
            || (outboundAttachments.length ? 'Imagen adjunta enviada por soporte.' : '');
        if (!messageText) {
            return json({ error: 'Reply message is empty' }, 400);
        }

        const emailSubject = buildThreadSubject(supportTicket, mode);
        const queuedMetadata = {
            channel: 'email',
            source: supportTicket.source,
            subject: emailSubject,
            to: recipientEmail,
            cc,
            bcc,
            mode,
            delivery_status: 'queued',
            notified_client: true,
            notify_client: true,
            files: outboundAttachments,
            notification: {
                play_sound: true,
                sound: 'support-reply',
            },
        };

        if (!adminMessage) {
            const { data: savedMessage, error: messageError } = await supabase
                .from('ticket_messages')
                .insert({
                    ticket_id: supportTicket.id,
                    message: messageText,
                    sender_type: 'Admin',
                    sender_id: actor.authUserId,
                    created_by: actor.id,
                    visibility: 'public',
                    message_kind: mode,
                    delivery_status: 'queued',
                    delivery_channel: 'email',
                    delivery_attempts: 0,
                    cc,
                    bcc,
                    attachments: queuedMetadata,
                })
                .select('id, message, delivery_attempts')
                .single();
            if (messageError) throw messageError;
            adminMessage = savedMessage as AdminMessage;
        } else {
            const { error: queueError } = await supabase
                .from('ticket_messages')
                .update({
                    delivery_status: 'queued',
                    delivery_error: null,
                    failed_at: null,
                    cc,
                    bcc,
                    attachments: { ...queuedMetadata, retry: true },
                })
                .eq('id', adminMessage.id);
            if (queueError) throw queueError;
        }

        const { data: settings, error: settingsError } = await supabase
            .from('support_integration_settings')
            .select('resend_inbound_email, resend_from_name, resend_from_email')
            .eq('id', 'helpdesk')
            .maybeSingle();

        if (settingsError) throw settingsError;

        const { data: resendSecret, error: secretError } = await supabase
            .from('support_integration_secrets')
            .select('secret_ciphertext, secret_iv')
            .eq('provider', 'resend')
            .maybeSingle();

        if (secretError) throw secretError;

        const resendApiKey = resendSecret
            ? await decryptSecret(resendSecret as ResendSecretRow)
            : getEnv('RESEND_API_KEY');
        const settingsRow = (settings ?? {}) as IntegrationSettingsRow;
        const fromAddress = settingsRow.resend_from_email
            ? formatFromAddress(settingsRow.resend_from_name === 'Cloud Admin Soporte' ? 'ALFA-Admin Soporte' : settingsRow.resend_from_name ?? 'ALFA-Admin Soporte', settingsRow.resend_from_email)
            : getEnv('HELPDESK_FROM_EMAIL');
        const replyToAddress = settingsRow.resend_inbound_email ?? getEnv('HELPDESK_INBOUND_EMAIL');

        const resendAttachments = await buildResendAttachments(supabase, outboundAttachments);
        const resendBody: Record<string, unknown> = {
            from: fromAddress,
            to: [recipientEmail],
            subject: emailSubject,
            text: appendHelpdeskEmailSignatureText(messageText),
            html: buildHelpdeskEmailHtmlFromText(messageText),
            reply_to: [replyToAddress],
        };

        if (mode !== 'forward') resendBody.headers = buildThreadHeaders(supportTicket, storedThreadMessageIds);
        if (cc.length) resendBody.cc = cc;
        if (bcc.length) resendBody.bcc = bcc;

        if (resendAttachments.length) {
            resendBody.attachments = resendAttachments;
        }

        const nextAttempt = (adminMessage.delivery_attempts ?? 0) + 1;
        let resendResponse: Response;
        try {
            resendResponse = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${resendApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(resendBody),
            });

            if (!resendResponse.ok) {
                throw new Error(`Resend failed: ${await resendResponse.text()}`);
            }
        } catch (deliveryError) {
            const detail = describeError(deliveryError);
            await Promise.all([
                supabase.from('ticket_messages').update({
                    delivery_status: 'failed',
                    delivery_attempts: nextAttempt,
                    delivery_error: detail,
                    failed_at: new Date().toISOString(),
                    attachments: { ...queuedMetadata, delivery_status: 'failed', delivery_error: detail },
                }).eq('id', adminMessage.id),
                supabase.from('support_tickets').update({
                    last_delivery_status: 'failed',
                    last_delivery_error: detail,
                }).eq('id', supportTicket.id),
                supabase.from('support_delivery_attempts').insert({
                    ticket_id: supportTicket.id,
                    message_id: adminMessage.id,
                    attempted_by: actor.id,
                    status: 'failed',
                    error_message: detail,
                }),
            ]);
            return json({ error: 'Could not deliver support reply', detail, message_id: adminMessage.id }, 502);
        }

        const resendPayload = await resendResponse.json() as { id?: string };
        const deliveryMetadata = {
            channel: 'email',
            source: supportTicket.source,
            subject: emailSubject,
            resend_email_id: resendPayload.id,
            to: recipientEmail,
            delivery_status: 'sent',
            notified_client: true,
            notify_client: true,
            files: outboundAttachments,
            notification: {
                play_sound: true,
                sound: 'support-reply',
            },
        };

        const sentAt = new Date().toISOString();
        const results = await Promise.all([
            supabase.from('ticket_messages').update({
                delivery_status: 'sent',
                delivery_channel: 'email',
                provider_message_id: resendPayload.id ?? null,
                delivery_attempts: nextAttempt,
                delivery_error: null,
                delivered_at: sentAt,
                failed_at: null,
                cc,
                bcc,
                attachments: { ...deliveryMetadata, mode, cc, bcc },
            }).eq('id', adminMessage.id),
            supabase.from('support_tickets').update({
                first_response_at: supportTicket.first_response_at ?? sentAt,
                last_response_at: sentAt,
                last_delivery_status: 'sent',
                last_delivery_error: null,
            }).eq('id', supportTicket.id),
            supabase.from('support_delivery_attempts').insert({
                ticket_id: supportTicket.id,
                message_id: adminMessage.id,
                attempted_by: actor.id,
                status: 'sent',
                provider_message_id: resendPayload.id ?? null,
            }),
            supabase.from('support_ticket_drafts').delete()
                .eq('ticket_id', supportTicket.id)
                .eq('admin_user_id', actor.id),
        ]);
        const resultError = results.find((result) => result.error)?.error;
        if (resultError) throw resultError;

        return json({
            ok: true,
            message_id: adminMessage.id,
            resend_email_id: resendPayload.id,
        });
    } catch (error) {
        return json({
            error: isAuthorizationError(error) ? 'unauthorized' : 'Could not send support reply',
            detail: describeError(error),
        }, isAuthorizationError(error) ? 401 : 500);
    }
});
