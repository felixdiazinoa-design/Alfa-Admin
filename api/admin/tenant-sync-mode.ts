import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { requireCloudAdminPermission, CloudAdminAuthError } from '../lib/cloud-admin-session.js';

const SYNC_MODES = ['POS_LOCAL', 'POS_ERP', 'POS_SLAVE'] as const;

type SyncMode = (typeof SYNC_MODES)[number];

type ApiRequest = IncomingMessage & {
    body?: unknown;
    headers: IncomingHttpHeaders;
    method?: string;
};

type TenantSyncModePayload = {
    tenantId?: unknown;
    syncMode?: unknown;
};

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(body));
}

function getEnv(...names: string[]): string {
    for (const name of names) {
        const value = process.env[name];
        if (value) return value;
    }

    throw new Error(`Missing required environment variable: ${names.join(' or ')}`);
}

async function readBody(request: ApiRequest): Promise<unknown> {
    if (request.body) {
        return typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const rawBody = Buffer.concat(chunks).toString('utf8');
    return rawBody ? JSON.parse(rawBody) : {};
}

function isSyncMode(value: unknown): value is SyncMode {
    return typeof value === 'string' && SYNC_MODES.includes(value as SyncMode);
}

function formatUnknownError(error: unknown): string {
    if (error instanceof Error) return error.message;

    if (error && typeof error === 'object') {
        const payload = error as Record<string, unknown>;
        return JSON.stringify(payload);
    }

    return String(error);
}

export default async function handler(request: ApiRequest, response: ServerResponse): Promise<void> {
    if (request.method === 'OPTIONS') {
        sendJson(response, 200, { ok: true });
        return;
    }

    if (request.method !== 'PATCH') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
    }

    try {
        await requireCloudAdminPermission(request.headers, 'tenants_manage');

        const payload = await readBody(request) as TenantSyncModePayload;
        const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId.trim() : '';

        if (!tenantId) {
            sendJson(response, 400, { error: 'tenantId is required' });
            return;
        }

        if (!isSyncMode(payload.syncMode)) {
            sendJson(response, 400, { error: 'syncMode must be POS_LOCAL, POS_ERP, or POS_SLAVE' });
            return;
        }

        const supabase = createClient(
            getEnv('SUPABASE_URL'),
            getEnv('SUPABASE_SERVICE_ROLE_KEY'),
            {
                auth: { autoRefreshToken: false, persistSession: false },
            },
        );

        const { data, error } = await supabase
            .from('erp_tenants')
            .update({ sync_mode: payload.syncMode })
            .eq('id', tenantId)
            .select('id, name, sync_mode')
            .single();

        if (error) throw error;

        sendJson(response, 200, { ok: true, tenant: data });
    } catch (error) {
        if (error instanceof CloudAdminAuthError) {
            sendJson(response, error.status, { error: error.code, detail: error.message });
            return;
        }
        console.error('tenant-sync-mode update failed', error);
        sendJson(response, 500, {
            error: 'Could not update tenant sync mode',
            detail: formatUnknownError(error),
        });
    }
}
