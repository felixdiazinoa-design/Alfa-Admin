# ALFA-ADMIN — LICENSING_FLOW

Snapshot auditado: `3cd9866` (`origin/develop`), 2026-09-16. Evidencia estática del repositorio; no acredita configuración ni estado de producción. Las líneas indicadas corresponden a ese snapshot.

## Límites tenant y activación POS

Provisioning persiste `max_pos_terminals/max_erp_users` y verifica lo creado: [api/activation/provision-tenant.ts](../../api/activation/provision-tenant.ts) (línea 300). Comandos separados para leer cupos, liberar asiento y aplicar límites requieren licenses_view/manage: [api/admin/command.ts](../../api/admin/command.ts) (línea 9); implementación de liberación [src/lib/tenantService.ts](../../src/lib/tenantService.ts) (línea 2154) y enforcement [src/lib/tenantService.ts](../../src/lib/tenantService.ts) (línea 2266).

Activación terminal recibe JWT usuario, tenantId y opcionales deviceId/terminalId; valida Auth y pertenencia mediante resolver Cloud/ERP, luego RPC `validate_terminal_activation_license`: [api/activation/validate-terminal-license.ts](../../api/activation/validate-terminal-license.ts) (línea 146). Rate limit en memoria por IP/token (línea 185) no demuestra límite global compartido en serverless.

El recuento y autorización deben distinguir device_id, UUID terminal ERP y tenant Cloud. Migraciones de enforcement/dispositivos/validación existen en `supabase/migrations/202605291200_pos_terminal_license_enforcement.sql`, `202605291400_pos_license_count_by_device.sql`, `202605291500_terminal_activation_license_validation.sql` y `202605291700_fix_terminal_license_release_validation.sql`; su existencia no acredita aplicación en producción.

## Módulos ERP

`module-licensing-api` requiere licenses_view/manage. overview carga catálogo/tenant/entitlements; save valida selección y exige ERP habilitado, llama `apply_tenant_erp_module_entitlements`, audita y devuelve overview: [supabase/functions/module-licensing-api/index.ts](../../supabase/functions/module-licensing-api/index.ts) (línea 110). UI/reglas están en `src/components/ErpModuleStoreModal.tsx`, `src/lib/erpModuleLicensing.ts`, `src/lib/erpModuleLicensingRules.ts`.

Prueba `test:erp-module-licensing` inspecciona catálogo, dependencias, RPC, RLS, ACK y UI mediante contratos textuales. No sustituye confirmación de entitlement efectivo en RMS. Workflow actual no despliega module-licensing-api aunque config la incluye: [.github/workflows/deploy-supabase-functions.yml](../../.github/workflows/deploy-supabase-functions.yml) (línea 3), [supabase/config.toml](../../supabase/config.toml) (línea 1).

No hay evidencia aquí de facturación monetaria, proveedor de cobro o validación online de todo permiso POS. Ver [TENANT_MODEL](TENANT_MODEL.md), [DEPENDENCY_MAP](DEPENDENCY_MAP.md).
