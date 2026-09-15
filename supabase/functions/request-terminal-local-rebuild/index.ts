import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';

declare const Deno: {
    env: {
        get(key: string): string | undefined;
    };
    serve(handler: (request: Request) => Response | Promise<Response>): void;
};

interface RebuildRequest {
    tenant_id?: string;
    terminal_id?: string;
    registry_id?: string | null;
    reason?: string;
    confirm_rebuild?: boolean;
    helpdesk_ticket_id?: string | null;
}

interface TenantRecord {
    id: string;
    name: string;
    email: string;
    status: string;
    type?: string | null;
    cloud_sync?: boolean | null;
    contracted_product?: string | null;
    pos_variant?: string | null;
    offline_mode?: boolean | null;
    explicit_offline?: boolean | null;
    cloud_channel?: string | null;
    pos_runtime?: string | null;
}

interface RegistryRecord {
    id: string;
    tenant_id: string;
    device_id?: string | null;
    terminal_id?: string | null;
    terminal_name?: string | null;
}

interface PublicTerminalRecord {
    id: string;
    tenant_id: string;
    code?: string | null;
    is_active?: boolean | null;
}

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-actor-user-id, x-actor-email, x-actor-source',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const tokenKeys = new Set([
    'syncAuthToken',
    'sync_auth_token',
    'token',
    'auth_token',
    'access_token',
    'refresh_token',
]);

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
        },
    });
}

function getEnv(...names: string[]) {
    for (const name of names) {
        const value = Deno.env.get(name);
        if (value) return value;
    }
    throw new Error(`Missing required environment variable: ${names.join(' or ')}`);
}

function sanitizePayload(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => sanitizePayload(item));
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (tokenKeys.has(key)) continue;
        output[key] = sanitizePayload(item);
    }
    return output;
}

function getErrorCode(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const record = payload as Record<string, unknown>;
    const candidates = [record.code, record.error, record.error_code];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    return null;
}

function getErrorMessage(status: number, payload: unknown) {
    const code = getErrorCode(payload);
    if (status === 404 && code === 'REBUILD_ENDPOINT_NOT_FOUND') {
        return 'El ERP todavia no tiene habilitado el endpoint de reconstruccion local.';
    }
    if (status === 401 || status === 403) {
        return 'No tienes permiso para preparar reconstruccion local de POS.';
    }
    if (payload && typeof payload === 'object') {
        const record = payload as Record<string, unknown>;
        if (typeof record.message === 'string') return record.message;
        if (typeof record.error === 'string') return record.error;
    }
    return 'El ERP no pudo preparar la reconstruccion local del POS.';
}

function isLocalPosTenant(tenant: TenantRecord) {
    if (tenant.contracted_product) {
        return tenant.contracted_product === 'POS_ONLY' && (tenant.pos_runtime || 'LOCAL_SQLITE') !== 'SLAVE';
    }
    return tenant.type === 'pos_only';
}

function isExplicitOfflinePosTenant(tenant: TenantRecord) {
    return tenant.contracted_product === 'POS_ONLY'
        && (
            tenant.pos_variant === 'POS_ONLY_OFFLINE'
            || tenant.offline_mode === true
            || tenant.explicit_offline === true
            || tenant.cloud_channel === 'NONE'
        );
}

async function insertAudit(
    supabase: ReturnType<typeof createClient>,
    payload: {
        event: 'TERMINAL_REBUILD_REQUESTED' | 'TERMINAL_REBUILD_COMPLETED';
        tenant_id: string;
        terminal_id: string;
        device_id?: string | null;
        actor_user_id?: string | null;
        actor_email?: string | null;
        reason?: string | null;
        erp_response_status?: number | null;
        erp_error_code?: string | null;
        metadata?: Record<string, unknown>;
    },
) {
    const { error } = await supabase.from('terminal_takeover_audit').insert({
        event: payload.event,
        tenant_id: payload.tenant_id,
        terminal_id: payload.terminal_id,
        previous_device_id: payload.device_id || null,
        new_device_id: payload.device_id || null,
        actor_user_id: payload.actor_user_id || null,
        actor_email: payload.actor_email || null,
        reason: payload.reason || null,
        erp_response_status: payload.erp_response_status || null,
        erp_error_code: payload.erp_error_code || null,
        metadata: payload.metadata || {},
    });

    if (error) {
        console.error('Failed to write terminal rebuild audit', error);
    }
}

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
        return json({ error: 'METHOD_NOT_ALLOWED', message: 'Metodo no permitido.' }, 405);
    }

    try {
        const supabaseUrl = getEnv('SUPABASE_URL');
        const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
        const erpApiUrl = getEnv('ERP_API_URL', 'CLOUD_ADMIN_ERP_API_URL');
        const erpServiceToken = getEnv('ERP_TAKEOVER_SERVICE_TOKEN', 'ERP_SERVICE_TOKEN', 'CLOUD_ADMIN_ERP_SERVICE_TOKEN');
        const supabase = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
            db: { schema: 'landlord' },
        });

        const body = await request.json().catch(() => ({})) as RebuildRequest;
        const tenantId = body.tenant_id?.trim();
        const terminalId = body.terminal_id?.trim();
        const registryId = body.registry_id?.trim() || null;
        const reason = body.reason?.trim();
        const actorUserId = request.headers.get('x-actor-user-id') || null;
        const actorEmail = request.headers.get('x-actor-email') || request.headers.get('x-actor-source') || 'cloud-admin';

        if (!tenantId || !terminalId || !reason) {
            return json({
                error: 'VALIDATION_ERROR',
                message: 'Selecciona tenant, terminal y motivo de la reconstruccion.',
            }, 400);
        }

        if (!body.confirm_rebuild) {
            return json({
                error: 'CONFIRMATION_REQUIRED',
                message: 'Confirma explicitamente que se hara bootstrap completo sin revocar la tablet.',
            }, 400);
        }

        const { data: tenantData, error: tenantError } = await supabase
            .from('tenants')
            .select('id,name,email,status,type,cloud_sync,contracted_product,pos_variant,offline_mode,explicit_offline,cloud_channel,pos_runtime')
            .eq('id', tenantId)
            .maybeSingle();

        if (tenantError) throw tenantError;
        const tenant = tenantData as TenantRecord | null;
        if (!tenant) {
            return json({ error: 'TENANT_NOT_FOUND', message: 'Tenant no encontrado.' }, 404);
        }
        if (tenant.status !== 'ACTIVE') {
            return json({ error: 'TENANT_NOT_ACTIVE', message: 'No se permite reconstruccion si el tenant no esta activo.' }, 400);
        }
        if (!isLocalPosTenant(tenant)) {
            return json({
                error: 'POS_LOCAL_ONLY',
                message: 'La reconstruccion local solo aplica a POS configurado como local. POS + ERP mantiene el flujo actual.',
            }, 400);
        }
        if (isExplicitOfflinePosTenant(tenant)) {
            return json({
                error: 'POS_OFFLINE_NO_CLOUD_RECOVERY',
                message: 'Este tenant POS_ONLY está en modo offline/sin Cloud Staging. No tiene reconstrucción cloud desde ALFA-Admin.',
            }, 400);
        }

        let registry: RegistryRecord | null = null;
        if (registryId) {
            const { data, error } = await supabase
                .from('tenant_server_registry')
                .select('id,tenant_id,device_id,terminal_id,terminal_name')
                .eq('tenant_id', tenantId)
                .eq('id', registryId)
                .maybeSingle();
            if (error) throw error;
            registry = (data as RegistryRecord | null) || null;
        }

        if (!registry) {
            const { data, error } = await supabase
                .from('tenant_server_registry')
                .select('id,tenant_id,device_id,terminal_id,terminal_name')
                .eq('tenant_id', tenantId)
                .eq('terminal_id', terminalId)
                .maybeSingle();
            if (error) throw error;
            registry = (data as RegistryRecord | null) || null;
        }

        const { data: publicTerminalData, error: terminalError } = await supabase
            .schema('public')
            .from('terminals')
            .select('id,tenant_id,code,is_active')
            .eq('tenant_id', tenantId)
            .eq('id', terminalId)
            .maybeSingle();

        if (terminalError) throw terminalError;
        const publicTerminal = publicTerminalData as PublicTerminalRecord | null;

        if (!registry && !publicTerminal) {
            return json({ error: 'TERMINAL_NOT_FOUND', message: 'Terminal no encontrada para este tenant.' }, 404);
        }

        const currentDeviceId = registry?.device_id || null;
        if (!currentDeviceId) {
            return json({
                error: 'DEVICE_ID_NOT_FOUND',
                message: 'La terminal no tiene device_id autorizado para reconstruir la base local.',
            }, 400);
        }

        await insertAudit(supabase, {
            event: 'TERMINAL_REBUILD_REQUESTED',
            tenant_id: tenantId,
            terminal_id: terminalId,
            device_id: currentDeviceId,
            actor_user_id: actorUserId,
            actor_email: actorEmail,
            reason,
            metadata: {
                registry_id: registry?.id || null,
                source: 'cloud-admin',
                recovery_scope: 'LOCAL_DATABASE_REBUILD',
            },
        });

        const erpResponse = await fetch(`${erpApiUrl.replace(/\/$/, '')}/api/settings/terminals/${encodeURIComponent(terminalId)}/rebuild-local`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${erpServiceToken}`,
                'Content-Type': 'application/json',
                'X-Tenant-Id': tenantId,
            },
            body: JSON.stringify({
                device_id: currentDeviceId,
                reason,
                rebuild_scope: 'LOCAL_DATABASE',
                force_full_bootstrap: true,
            }),
        });

        const erpPayload = await erpResponse.json().catch(async () => ({
            message: await erpResponse.text().catch(() => ''),
        }));
        const erpErrorCode = getErrorCode(erpPayload);

        if (!erpResponse.ok) {
            await insertAudit(supabase, {
                event: 'TERMINAL_REBUILD_COMPLETED',
                tenant_id: tenantId,
                terminal_id: terminalId,
                device_id: currentDeviceId,
                actor_user_id: actorUserId,
                actor_email: actorEmail,
                reason,
                erp_response_status: erpResponse.status,
                erp_error_code: erpErrorCode,
                metadata: {
                    success: false,
                    erp_payload: sanitizePayload(erpPayload),
                },
            });

            return json({
                error: erpErrorCode || 'ERP_REBUILD_FAILED',
                message: getErrorMessage(erpResponse.status, erpPayload),
            }, erpResponse.status);
        }

        let registryUpdateError: string | null = null;
        if (registry?.id) {
            const { error: updateError } = await supabase
                .from('tenant_server_registry')
                .update({
                    last_rebuild_at: new Date().toISOString(),
                    current_device_id: currentDeviceId,
                    requires_full_bootstrap: true,
                    requires_pos_reauth: false,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', registry.id);

            if (updateError) {
                registryUpdateError = updateError.message;
                console.error('Failed to update tenant server registry after local rebuild', updateError);
            }
        }

        if (body.helpdesk_ticket_id) {
            const { error: messageError } = await supabase.from('ticket_messages').insert({
                ticket_id: body.helpdesk_ticket_id,
                sender_type: 'System',
                message: `Se preparo reconstruccion local del POS. Dispositivo: ${currentDeviceId}.`,
                attachments: {
                    technical_action: {
                        action: 'terminal_local_rebuild',
                        device_id: currentDeviceId,
                        reason,
                    },
                    notification: {
                        badge: true,
                        increment_unread: true,
                        play_sound: false,
                    },
                },
            });
            if (messageError) console.error('Failed to append helpdesk local rebuild message', messageError);
        }

        await insertAudit(supabase, {
            event: 'TERMINAL_REBUILD_COMPLETED',
            tenant_id: tenantId,
            terminal_id: terminalId,
            device_id: currentDeviceId,
            actor_user_id: actorUserId,
            actor_email: actorEmail,
            reason,
            erp_response_status: erpResponse.status,
            metadata: {
                success: true,
                registry_update_error: registryUpdateError,
                erp_payload: sanitizePayload(erpPayload),
            },
        });

        const sanitizedPayload = sanitizePayload(erpPayload) as Record<string, unknown>;
        return json({
            status: 'success',
            terminal: sanitizedPayload.terminal || null,
            device_id: (sanitizedPayload.device_id as string | undefined) || currentDeviceId,
            requires_full_bootstrap: sanitizedPayload.requires_full_bootstrap ?? true,
            message: 'Reconstruccion local preparada. El POS debe descargar nuevamente su estado desde el ERP sin cambiar de dispositivo.',
        });
    } catch (error) {
        console.error('request-terminal-local-rebuild failed', error);
        return json({
            error: 'INTERNAL_ERROR',
            message: error instanceof Error ? error.message : 'Error interno preparando reconstruccion local del POS.',
        }, 500);
    }
});
