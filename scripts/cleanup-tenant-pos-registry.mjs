#!/usr/bin/env node
/**
 * Limpia el registry POS de un tenant para reactivar cajas 1 a 1 en pruebas.
 *
 * Uso:
 *   node scripts/cleanup-tenant-pos-registry.mjs
 *   node scripts/cleanup-tenant-pos-registry.mjs --purge
 *   node scripts/cleanup-tenant-pos-registry.mjs --tenant-id <uuid> --dry-run
 *   node scripts/cleanup-tenant-pos-registry.mjs --purge --include-audit
 */
import { createClient } from '@supabase/supabase-js';

const DEFAULT_TENANT_ID = 'b239bf16-6b79-4fd4-8a78-da1881b09261';

function getEnv(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing env ${name}`);
    return value;
}

function parseArgs(argv) {
    const args = {
        tenantId: DEFAULT_TENANT_ID,
        dryRun: false,
        purge: false,
        includeAudit: false,
    };
    for (let i = 2; i < argv.length; i += 1) {
        if (argv[i] === '--tenant-id' && argv[i + 1]) {
            args.tenantId = argv[++i];
        } else if (argv[i] === '--dry-run') {
            args.dryRun = true;
        } else if (argv[i] === '--purge') {
            args.purge = true;
        } else if (argv[i] === '--include-audit') {
            args.includeAudit = true;
        }
    }
    return args;
}

async function fetchRegistrySnapshot(supabase, tenantId) {
    const { data, error } = await supabase
        .from('tenant_server_registry')
        .select('id,terminal_id,terminal_name,device_id,status,auth_status,is_revoked,authorized_device_id,last_seen_at,created_at')
        .eq('tenant_id', tenantId)
        .order('terminal_id', { ascending: true })
        .order('created_at', { ascending: true });

    if (error) throw error;
    return data ?? [];
}

async function fetchTenant(supabase, tenantId) {
    const { data, error } = await supabase
        .from('tenants')
        .select('id,name,email,max_pos_terminals,contracted_product,lifecycle_status,provisioning_status,status')
        .eq('id', tenantId)
        .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error(`Tenant not found: ${tenantId}`);
    return data;
}

function summarizeRegistry(rows) {
    if (rows.length === 0) return [];

    const byTerminal = new Map();
    for (const row of rows) {
        const key = row.terminal_id || '(sin terminal_id)';
        const entry = byTerminal.get(key) ?? {
            terminal_id: key,
            caja: row.terminal_name || null,
            total: 0,
            online: 0,
            devices: new Set(),
        };
        entry.total += 1;
        if ((row.status || '').toUpperCase() === 'ONLINE') entry.online += 1;
        if (row.device_id) entry.devices.add(row.device_id);
        byTerminal.set(key, entry);
    }

    return [...byTerminal.values()].map((entry) => ({
        terminal_id: entry.terminal_id,
        caja: entry.caja,
        filas_registry: entry.total,
        online: entry.online,
        equipos: entry.devices.size,
    }));
}

async function countSeats(supabase, tenantId) {
    const { data, error } = await supabase.rpc('count_tenant_pos_license_seats', {
        p_tenant_id: tenantId,
    });
    if (error) {
        return { error: error.message };
    }
    return data?.[0] ?? data ?? null;
}

async function countAuditRows(supabase, tenantId, tableName) {
    const { count, error } = await supabase
        .from(tableName)
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);

    if (error) {
        return { error: error.message };
    }
    return count ?? 0;
}

async function softResetRegistry(supabase, tenantId) {
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('tenant_server_registry')
        .update({
            status: 'OFFLINE',
            is_revoked: true,
            auth_status: 'OLD_DEVICE_REVOKED',
            authorized_device_id: null,
            current_device_id: null,
            requires_pos_reauth: false,
            last_auth_error: null,
            is_primary: false,
            updated_at: now,
        })
        .eq('tenant_id', tenantId)
        .select('id,terminal_id,device_id,status');

    if (error) throw error;
    return data ?? [];
}

async function purgeRegistry(supabase, tenantId) {
    const { data, error } = await supabase
        .from('tenant_server_registry')
        .delete()
        .eq('tenant_id', tenantId)
        .select('id,terminal_id,device_id');

    if (error) throw error;
    return data ?? [];
}

async function purgeAuditTables(supabase, tenantId) {
    const results = {};

    for (const tableName of ['terminal_device_audit', 'terminal_takeover_audit']) {
        const { data, error } = await supabase
            .from(tableName)
            .delete()
            .eq('tenant_id', tenantId)
            .select('id');

        if (error) {
            if (error.message?.includes('does not exist') || error.code === '42P01') {
                results[tableName] = 0;
                continue;
            }
            throw error;
        }
        results[tableName] = data?.length ?? 0;
    }

    return results;
}

async function unblockTenantIfNeeded(supabase, tenantId, tenant) {
    const tenantPatch = {};
    if (tenant.lifecycle_status === 'BLOCKED') {
        tenantPatch.lifecycle_status = 'CLOUD_STAGING';
    }
    if (tenant.provisioning_status === 'BLOCKED') {
        tenantPatch.provisioning_status = 'CLOUD_STAGING_REQUIRED';
    }

    if (Object.keys(tenantPatch).length === 0) return null;

    const { error } = await supabase
        .from('tenants')
        .update(tenantPatch)
        .eq('id', tenantId);
    if (error) throw error;
    return tenantPatch;
}

async function main() {
    const { tenantId, dryRun, purge, includeAudit } = parseArgs(process.argv);
    const supabase = createClient(
        process.env.SUPABASE_URL || getEnv('VITE_SUPABASE_URL'),
        getEnv('SUPABASE_SERVICE_ROLE_KEY'),
        {
            auth: { autoRefreshToken: false, persistSession: false },
            db: { schema: 'landlord' },
        },
    );

    const tenant = await fetchTenant(supabase, tenantId);
    const beforeRows = await fetchRegistrySnapshot(supabase, tenantId);
    const beforeSeats = await countSeats(supabase, tenantId);
    const beforeDeviceAudit = await countAuditRows(supabase, tenantId, 'terminal_device_audit');
    const beforeTakeoverAudit = await countAuditRows(supabase, tenantId, 'terminal_takeover_audit');

    console.log('Tenant:', tenant.name, tenant.id);
    console.log('Producto:', tenant.contracted_product, '| Licencias:', tenant.max_pos_terminals);
    console.log('Lifecycle:', tenant.lifecycle_status, '| Provisioning:', tenant.provisioning_status);
    console.log('Modo:', purge ? 'PURGE (borrar historico)' : 'SOFT (marcar OFFLINE)');
    console.log('\nRegistry ANTES:', summarizeRegistry(beforeRows));
    console.log('Cupos ANTES:', beforeSeats);
    if (includeAudit) {
        console.log('Auditoria ANTES:', {
            terminal_device_audit: beforeDeviceAudit,
            terminal_takeover_audit: beforeTakeoverAudit,
        });
    }

    if (dryRun) {
        console.log('\n[dry-run] No se aplicaron cambios.');
        return;
    }

    let affectedRows = [];
    if (purge) {
        affectedRows = await purgeRegistry(supabase, tenantId);
    } else {
        affectedRows = await softResetRegistry(supabase, tenantId);
    }

    const tenantPatch = await unblockTenantIfNeeded(supabase, tenantId, tenant);
    if (tenantPatch) {
        console.log('\nTenant desbloqueado:', tenantPatch);
    }

    let auditPurged = null;
    if (includeAudit) {
        auditPurged = await purgeAuditTables(supabase, tenantId);
        console.log('\nAuditoria borrada:', auditPurged);
    }

    const { data: enforceResult, error: enforceError } = await supabase.rpc(
        'enforce_tenant_pos_license_limits',
        { p_tenant_id: tenantId },
    );
    if (enforceError) throw enforceError;

    const afterRows = await fetchRegistrySnapshot(supabase, tenantId);
    const afterSeats = await countSeats(supabase, tenantId);

    console.log(
        `\n${purge ? 'Filas borradas' : 'Filas marcadas OFFLINE/revocadas'}: ${affectedRows.length}`,
    );
    console.log('Enforce:', enforceResult);
    console.log('\nRegistry DESPUES:', summarizeRegistry(afterRows));
    console.log('Cupos DESPUES:', afterSeats);
    console.log(
        purge
            ? '\nRegistry vacio. Activa Caja 1 desde cero en el POS.'
            : '\nListo. Activa Caja 1 en el POS; debe consumir 1/3. Luego Caja 2 y Caja 3.',
    );
}

main().catch((error) => {
    console.error('cleanup-tenant-pos-registry failed:', error.message || error);
    process.exit(1);
});
