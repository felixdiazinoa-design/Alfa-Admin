import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [
    attemptsProxy,
    actionProxy,
    rejectionProxy,
    sessionGuard,
    edgeAttempts,
    edgeAction,
    tenantService,
    page,
    permissionMigration,
    contract,
] = await Promise.all([
    readFile(new URL('../api/terminal-auth-attempts.ts', import.meta.url), 'utf8'),
    readFile(new URL('../api/terminal-device-action.ts', import.meta.url), 'utf8'),
    readFile(new URL('../api/terminal-device-request.ts', import.meta.url), 'utf8'),
    readFile(new URL('../api/lib/cloud-admin-session.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/request-terminal-auth-attempts/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/request-terminal-device-authorization/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/tenantService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/Tenants.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260830224924_cloud_admin_terminal_reauthorization_permission.sql', import.meta.url), 'utf8'),
    readFile(new URL('../docs/erp-terminal-device-requests-contract.md', import.meta.url), 'utf8'),
]);

for (const source of [attemptsProxy, actionProxy, rejectionProxy]) {
    assert.match(source, /from "\.\/lib\/cloud-admin-session\.js"/, 'Vercel ESM functions must import shared auth with an explicit .js extension');
}

for (const source of [attemptsProxy, edgeAttempts]) {
    assert.doesNotMatch(source, /permissivePosErpAuth/);
    assert.doesNotMatch(source, /authorized_device_id:\s*latestRejected\.requested_device_id/);
    assert.doesNotMatch(source, /registryUpdate\.device_id\s*=\s*latestRejected\.requested_device_id/);
    assert.match(source, /last_rejected_device_id:\s*latestRejected\.requested_device_id/);
    assert.match(source, /dedupePendingAttempts/);
    assert.match(source, /legacyPendingInferred/);
    assert.match(source, /DEVICE_SUPERSEDED/);
    assert.match(source, /resolved_at/);
    assert.match(source, /resolved_by/);
}

assert.match(sessionGuard, /admin\.auth\.getUser\(accessToken\)/);
assert.match(sessionGuard, /const explicitPermission = session\.actor\.permissions\[permission\]/);
assert.match(sessionGuard, /if \(!allowed\)/);
assert.match(actionProxy, /requireCloudAdminPermission\(request\.headers, "terminal_reauthorization"\)/);
assert.match(attemptsProxy, /requireCloudAdminPermission\(request\.headers, "terminal_reauthorization"\)/);
assert.doesNotMatch(`${attemptsProxy}\n${actionProxy}`, /bearerToken === serviceRoleKey/);
assert.match(actionProxy, /validateCanonicalErpActionScope/);
assert.match(actionProxy, /validatePendingDeviceRequest/);
assert.match(actionProxy, /\.from\("terminal_auth_attempts"\)/, 'takeover preflight must read the persisted canonical ERP request');
assert.match(actionProxy, /\.eq\("tenant_id", erpTenantId\)/, 'takeover preflight must scope the request with the ERP tenant resolved server-side');
assert.match(actionProxy, /\.eq\("terminal_id", terminalId\)/, 'takeover preflight must scope the request to the canonical terminal');
assert.doesNotMatch(
    actionProxy.match(/async function validatePendingDeviceRequest[\s\S]*?function getTextCandidate/)?.[0] || '',
    /fetch\(/,
    'takeover preflight must not reinterpret an unstable auth-attempts HTTP envelope',
);
assert.match(actionProxy, /attempts\.find\(isMatchingPendingAttempt\)/, 'retry churn must resolve the newest equivalent pending request for the same device');
assert.match(actionProxy, /request_id: validatedRequestId/, 'takeover must forward the canonical request id selected during validation');
assert.match(actionProxy, /expected_authorized_device_id: canonicalExpectedAuthorizedDeviceId/, 'takeover CAS must use the authorized device read from canonical ERP state');
assert.match(actionProxy, /DEVICE_REQUEST_NOT_PENDING/);
assert.match(actionProxy, /DEVICE_REQUEST_NOT_FOUND/);
assert.match(rejectionProxy, /Array\.isArray\(payload\)/, 'request rejection must accept a root-array ERP response');
assert.match(rejectionProxy, /record\.items/, 'request rejection must accept the canonical ERP items collection');
assert.doesNotMatch(actionProxy, /terminalId === catalogTerminalId/, 'a catalog row may legitimately reuse the canonical ERP UUID after database scope verification');
assert.doesNotMatch(edgeAction, /terminalId === catalogTerminalId/, 'the Edge Function must rely on the canonical ERP\/store\/tenant lookup, not UUID inequality');

assert.match(edgeAction, /request_id:\s*requestId/);
assert.match(edgeAction, /expected_authorized_device_id:\s*expectedAuthorizedDeviceId/);
assert.match(edgeAction, /request_status:/);
assert.match(tenantService, /payload\?\.request_id === input\.requestId/);
assert.match(tenantService, /payload\.request_status\?\.toUpperCase\(\) === "APPROVED"/);
assert.match(tenantService, /Authorization: `Bearer \$\{accessToken\}`/);
assert.doesNotMatch(tenantService.match(/export async function getTerminalAuthAttempts[\s\S]*?return Array\.isArray\(payload\?\.attempts\)/)?.[0] || '', /supabaseServiceRoleKey/);

assert.match(rejectionProxy, /auth-attempts\/\$\{encodeURIComponent\(requestId\)\}\/reject/);
assert.match(rejectionProxy, /!isPendingRequest\(pending\)/);
assert.match(rejectionProxy, /REJECTION_RESPONSE_AMBIGUOUS/);
assert.match(rejectionProxy, /responseStatus !== "REJECTED"/);
assert.match(rejectionProxy, /DEVICE_REQUEST_REJECTED/);

assert.match(page, /Solicitudes de dispositivo/);
assert.match(page, /No se pudieron cargar las solicitudes de dispositivo\./, 'UI must not present request API failures as an empty list');
assert.match(page, /Autorizar y reemplazar/);
assert.match(page, /Rechazar/);
assert.match(page, /UUID ERP:/);
assert.match(page, /canReauthorizeTerminals/);
assert.match(page, /deviceActionSubmittingKey !== null/);
assert.match(page, /requestId: request\?\.id \|\| null/);
assert.match(page, /attempt\.authorized_device_id \|\| getTerminalAuthorizedDeviceId\(terminal\)/, 'takeover must use the previous authorized device captured by the selected ERP request');
assert.match(page, /getTenantTerminalOverview/);
assert.match(page, /type TerminalRequestFilter = 'ALL' \| 'PENDING'/);
assert.match(page, /pendingDeviceRequestTerminalCount = tenantTerminals\.filter\(hasPendingDeviceRequest\)\.length/);
assert.match(page, /terminalRequestFilter === 'PENDING' && !hasPendingDeviceRequest\(terminal\)/);
assert.match(page, /Con solicitudes pendientes \(\{pendingDeviceRequestTerminalCount\}\)/);
assert.match(page, /No hay terminales con solicitudes pendientes que coincidan con los filtros seleccionados\./);

assert.match(permissionMigration, /'terminal_reauthorization', code in \('owner', 'admin'\)/);
assert.match(permissionMigration, /'DEVICE_REQUEST_REJECTED'/);
assert.match(contract, /POST \/api\/sync\/bootstrap\/check/);
assert.match(contract, /POST \/api\/settings\/terminals\/\{terminal_id\}\/takeover/);
assert.match(contract, /FOR UPDATE/);
assert.match(contract, /\/auth-attempts\/\{request_id\}\/reject/);
assert.match(contract, /Ninguno de estos flujos puede usar `\/api\/sync\/terminals\/register`/);

console.log('Terminal device request contract checks passed.');
