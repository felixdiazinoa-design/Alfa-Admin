import { assertHelpdeskTicketAccess, createHelpdeskAdminClient, isAuthorizationError, requireHelpdeskActor } from '../_shared/helpdesk-auth.ts';
import {
    appendHelpdeskEmailSignatureHtml,
    appendHelpdeskEmailSignatureText,
} from '../_shared/helpdesk-email-branding.ts';

declare const Deno: {
    env: {
        get(key: string): string | undefined;
    };
    serve(handler: (request: Request) => Response | Promise<Response>): void;
};

interface ResolvePayload {
    ticket_id?: string;
    notify_email?: boolean;
}

interface SupportContact {
    email?: string | null;
}

interface SupportTicket {
    id: string;
    ticket_number?: number | null;
    subject: string;
    source: string;
    external_sender_email?: string | null;
    technical_context?: {
        email_thread_message_ids?: string[];
        resend_message_id?: string;
        [key: string]: unknown;
    } | null;
    support_contacts?: SupportContact | SupportContact[] | null;
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

function getOptionalEnv(name: string) {
    return Deno.env.get(name)?.trim() || undefined;
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

async function sha256Hex(value: string) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function createFeedbackToken() {
    return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

function formatFromAddress(name: string, email: string) {
    const cleanName = name.trim() || 'ALFA-Admin Soporte';
    return `${cleanName} <${email.trim().toLowerCase()}>`;
}

function buildThreadSubject(ticket: SupportTicket) {
    const ticketToken = `[Ticket #${ticket.ticket_number ?? ticket.id.slice(0, 8)}]`;
    const cleanSubject = ticket.subject
        .replace(/^\s*(re|fw|fwd):\s*/i, '')
        .replace(ticketToken, '')
        .trim() || 'Solicitud tecnica';

    return `${ticketToken} Confirmacion de solucion: ${cleanSubject}`;
}

function buildThreadHeaders(ticket: SupportTicket) {
    const messageIds = Array.isArray(ticket.technical_context?.email_thread_message_ids)
        ? ticket.technical_context.email_thread_message_ids.filter((value): value is string => typeof value === 'string')
        : [];
    const latestMessageId = ticket.technical_context?.resend_message_id ?? messageIds.at(-1);
    const references = Array.from(new Set([...messageIds, latestMessageId].filter((value): value is string => Boolean(value))));

    if (!latestMessageId) return undefined;

    return {
        'In-Reply-To': latestMessageId,
        References: references.join(' '),
    };
}

async function assertAuthorized(request: Request) {
    return requireHelpdeskActor(request);
}

function buildFeedbackUrl(ticketId: string, token: string, params: Record<string, string>) {
    const baseUrl = `${getEnv('SUPABASE_URL')}/functions/v1/submit-support-feedback`;
    const url = new URL(baseUrl);
    url.searchParams.set('ticket_id', ticketId);
    url.searchParams.set('token', token);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.toString();
}

function buildFeedbackRequest(ticket: SupportTicket, token: string) {
    const closeActions = [1, 2, 3, 4, 5].map((rating) => ({
        action: 'close',
        rating,
        label: `${rating} estrella${rating === 1 ? '' : 's'}`,
        url: buildFeedbackUrl(ticket.id, token, { action: 'close', rating: String(rating) }),
    }));

    return {
        version: 1,
        type: 'resolution_confirmation',
        prompt: '¿La respuesta solucionó tu problema?',
        close_label: 'Sí, cerrar ticket',
        reopen_label: 'No, necesito ayuda',
        rating_label: 'Valora la atención',
        rating_scale: [1, 2, 3, 4, 5],
        ui: {
            component: 'resolution_feedback',
            rating_style: 'amazon_stars',
            rating_selection: 'single',
            require_rating_for_close: true,
        },
        endpoint: `${getEnv('SUPABASE_URL')}/functions/v1/submit-support-feedback`,
        method: 'POST',
        ticket_id: ticket.id,
        ticket_number: ticket.ticket_number ?? null,
        token,
        close_action: {
            action: 'close',
            label: 'Sí, cerrar ticket',
        },
        actions: {
            close: closeActions,
            reopen: {
                action: 'reopen',
                label: 'No, necesito ayuda',
                url: buildFeedbackUrl(ticket.id, token, { action: 'reopen' }),
            },
        },
    };
}

function escapeHtml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function buildFeedbackEmail(ticket: SupportTicket, token: string) {
    const closeLinks = [1, 2, 3, 4, 5].map((rating) => ({
        rating,
        url: buildFeedbackUrl(ticket.id, token, { action: 'close', rating: String(rating) }),
    }));
    const reopenUrl = buildFeedbackUrl(ticket.id, token, { action: 'reopen' });
    const ticketLabel = `#${ticket.ticket_number ?? ticket.id.slice(0, 8)}`;

    const text = [
        `Marcamos el ticket ${ticketLabel} como resuelto: ${ticket.subject}`,
        '',
        'Si todo quedo conforme, selecciona una valoracion:',
        ...closeLinks.map((link) => `${link.rating} estrella${link.rating === 1 ? '' : 's'}: ${link.url}`),
        '',
        `Si aun necesitas ayuda, reabre el caso aqui: ${reopenUrl}`,
    ].join('\n');

    const starLinks = closeLinks.map((link) => (
        `<a href="${link.url}" style="display:inline-block;margin:0 4px;padding:10px 12px;border-radius:10px;background:#eff6ff;color:#1d4ed8;text-decoration:none;font-weight:700">${'★'.repeat(link.rating)}</a>`
    )).join('');

    const html = `
        <div style="font-family:Inter,Arial,sans-serif;line-height:1.5;color:#0f172a">
            <p>Marcamos el ticket <strong>${escapeHtml(ticketLabel)}</strong> como resuelto:</p>
            <p><strong>${escapeHtml(ticket.subject)}</strong></p>
            <p>¿La respuesta solucionó tu problema? Si estás conforme, selecciona una valoración:</p>
            <p>${starLinks}</p>
            <p style="margin-top:24px">
                <a href="${reopenUrl}" style="display:inline-block;padding:12px 16px;border-radius:10px;background:#fee2e2;color:#991b1b;text-decoration:none;font-weight:700">
                    No, necesito ayuda
                </a>
            </p>
        </div>
    `;

    return { text, html };
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

        const payload = await request.json() as ResolvePayload;
        const ticketId = payload.ticket_id?.trim();
        if (!ticketId) {
            return json({ error: 'ticket_id is required' }, 400);
        }
        const shouldNotifyEmail = payload.notify_email === true;

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
                technical_context,
                support_contacts (
                    email
                )
            `)
            .eq('id', ticketId)
            .single();

        if (ticketError) throw ticketError;

        const supportTicket = ticket as SupportTicket;
        const token = createFeedbackToken();
        const tokenHash = await sha256Hex(token);

        const { error: updateError } = await supabase
            .from('support_tickets')
            .update({
                status: 'Resuelto',
                resolution_status: 'pending_customer_confirmation',
                resolved_at: new Date().toISOString(),
                resolved_by: actor.id,
                closed_at: null,
                reopened_at: null,
                customer_confirmed_at: null,
                customer_rating: null,
                customer_feedback: null,
                resolution_feedback_token_hash: tokenHash,
                resolution_feedback_requested_at: new Date().toISOString(),
            })
            .eq('id', supportTicket.id);

        if (updateError) throw updateError;

        const feedbackRequest = buildFeedbackRequest(supportTicket, token);
        const notificationMessage = [
            feedbackRequest.prompt,
            'Si la solucion fue satisfactoria, selecciona "Si, cerrar ticket" y una valoracion de 1 a 5 estrellas.',
            'Si aun necesitas ayuda, selecciona "No, necesito ayuda".',
        ].join('\n\n');

        await supabase.from('ticket_messages').insert({
            ticket_id: supportTicket.id,
            sender_type: 'Admin',
            sender_id: actor.authUserId,
            created_by: actor.id,
            message: notificationMessage,
            visibility: 'public',
            message_kind: 'resolution_feedback_request',
            delivery_status: 'internal',
            delivery_channel: 'in_app',
            attachments: {
                channel: 'resolution',
                delivery_status: 'in_app',
                event: 'resolution_feedback_requested',
                message_kind: 'resolution_feedback_request',
                notified_client: true,
                notify_client: true,
                requires_customer_action: true,
                client_alert: {
                    badge: true,
                    increment_unread: true,
                    open_ticket_id: supportTicket.id,
                },
                notification: {
                    badge: true,
                    increment_unread: true,
                    play_sound: true,
                    sound: 'support-resolution-request',
                    title: 'Soporte respondió tu caso',
                    body: feedbackRequest.prompt,
                },
                feedback_request: feedbackRequest,
            },
        });

        const contact = normalizeRelation(supportTicket.support_contacts);
        const recipientEmail = contact?.email || supportTicket.external_sender_email;
        let notified = false;

        if (recipientEmail && shouldNotifyEmail) {
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
                : getOptionalEnv('RESEND_API_KEY');

            if (resendApiKey) {
                const settingsRow = (settings ?? {}) as IntegrationSettingsRow;
                const fromAddress = settingsRow.resend_from_email
                    ? formatFromAddress(settingsRow.resend_from_name === 'Cloud Admin Soporte' ? 'ALFA-Admin Soporte' : settingsRow.resend_from_name ?? 'ALFA-Admin Soporte', settingsRow.resend_from_email)
                    : getEnv('HELPDESK_FROM_EMAIL');
                const replyToAddress = settingsRow.resend_inbound_email ?? getEnv('HELPDESK_INBOUND_EMAIL');
                const emailBody = buildFeedbackEmail(supportTicket, token);

                const resendResponse = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${resendApiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        from: fromAddress,
                        to: [recipientEmail],
                        subject: buildThreadSubject(supportTicket),
                        text: appendHelpdeskEmailSignatureText(emailBody.text),
                        html: appendHelpdeskEmailSignatureHtml(emailBody.html),
                        reply_to: [replyToAddress],
                        headers: buildThreadHeaders(supportTicket),
                    }),
                });

                if (!resendResponse.ok) {
                    throw new Error(`Resend failed: ${await resendResponse.text()}`);
                }

                notified = true;
            }
        }

        return json({
            ok: true,
            status: 'Resuelto',
            resolution_status: 'pending_customer_confirmation',
            notified,
            feedback_request: true,
        });
    } catch (error) {
        return json({
            error: isAuthorizationError(error) ? 'unauthorized' : 'Could not resolve support ticket',
            detail: describeError(error),
        }, isAuthorizationError(error) ? 401 : 500);
    }
});
