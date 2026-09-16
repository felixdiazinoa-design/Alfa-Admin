# ALFA-ADMIN — PROVISIONING_FLOW

Snapshot auditado: `3cd9866` (`origin/develop`), 2026-09-16. Evidencia estática del repositorio; no acredita configuración ni estado de producción. Las líneas indicadas corresponden a ese snapshot.

## Dos entradas existentes

- UI Admin → `create_tenant` en comando con `tenants_manage` → `tenantService.createTenant`: [src/lib/tenantService.ts](../../src/lib/tenantService.ts) (línea 909).
- RMS backend → `POST /api/activation/provision-tenant` → bearer `CLOUD_ADMIN_PROVISION_TOKEN`: [api/activation/provision-tenant.ts](../../api/activation/provision-tenant.ts) (línea 426). README relaciona ese secreto con `CLOUD_ADMIN_API_TOKEN` solo en backend RMS. No documentar ni copiar valores.

## Entrada servidor a servidor

1. OPTIONS/POST y bearer timing-safe; falta configuración devuelve 503, token inválido 401.
2. Valida campos name/email/slug/password/contactName/contactEmail/city y tipo tenant.
3. Crea Auth user con contraseña inicial y metadata descriptiva.
4. RPC `create_new_tenant` con límites POS/ERP y contacto/distribuidores.
5. Consulta tenant recién creado y comprueba cantidades de licencias.
6. Actualiza metadata Auth incluyendo tenant_id en app_metadata.
7. Inserta subscription activa y devuelve tenantId/tempPassword.

Evidencia: [api/activation/provision-tenant.ts](../../api/activation/provision-tenant.ts) (línea 300). Ante errores elimina usuario y/o tenant de forma compensatoria; operaciones no están en una transacción compartida y errores de rollback no son verificados.

`POST /api/activations/check` usa el mismo secreto servidor-a-servidor: [api/activations/check.ts](../../api/activations/check.ts) (línea 98). `POST /api/activation/validate-terminal-license` usa JWT cliente, resolver pertenencia y RPC: [api/activation/validate-terminal-license.ts](../../api/activation/validate-terminal-license.ts) (línea 146). No confundir los tipos de bearer.

Este mapa no acredita que RMS configure correctamente el secreto o que la firma RPC desplegada coincida. Pruebas existentes: test:provision-tenant-auth, test:tenant-license-provisioning, test:activation-check-auth, test:activation-tenant-resolution. Ver [LICENSING_FLOW](LICENSING_FLOW.md).
