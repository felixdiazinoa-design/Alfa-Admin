# ALFA-ADMIN — TENANT_MODEL

Snapshot auditado: `3cd9866` (`origin/develop`), 2026-09-16. Evidencia estática del repositorio; no acredita configuración ni estado de producción. Las líneas indicadas corresponden a ese snapshot.

## Identidad y semántica

`TenantType`: `full`, `pos_only`, `erp_only`, en [src/types.ts](../../src/types.ts) (línea 2). Los productos y semántica explicitan contractedProduct, POS runtime/variant, cloud channel, data master, customer ERP access y estados de lifecycle/provisioning: [src/lib/tenantProducts.ts](../../src/lib/tenantProducts.ts) (línea 196).

| Variante | Canal / maestro derivados |
|---|---|
| POS_ERP | ERP_ACTIVE / ERP cuando ERP es maestro |
| POS_ONLY_OFFLINE | NONE / POS |
| POS_ONLY_STANDARD | POS_CLOUD_STAGING / POS |
| Producto maestro POS | POS_MASTER / POS_MASTER |

La normalización contiene combinaciones y compatibilidad legacy; esta tabla no reemplaza las reglas completas de `deriveTenantSemanticsFromProducts` (línea 196).

`landlord.tenants.id` identifica tenant Cloud; `public.erp_tenants.id` identifica tenant ERP. No intercambiarlos. Resolver activación utiliza mapping y metadata de servidor, corroborando pertenencia por app_metadata o email autenticado: [api/lib/resolve-landlord-tenant.ts](../../api/lib/resolve-landlord-tenant.ts) (línea 24). `user_metadata` aparece como pista ERP, no debe convertirse en autorización autónoma.

Límites `max_pos_terminals` y `max_erp_users` deben persistirse y verificarse al crear tenant: [api/activation/provision-tenant.ts](../../api/activation/provision-tenant.ts) (línea 300). `subscriptions` registra plan activo, separado de identidad Auth.

Terminal UUID ERP y device_id son identidades distintas. El registro endpoint (`tenant_server_registry`) no es autorización por sí mismo; la autoridad de takeover sigue en ERP: [docs/erp-terminal-device-requests-contract.md](../../docs/erp-terminal-device-requests-contract.md) (línea 80). Registro endpoint administrativo: [src/lib/tenantService.ts](../../src/lib/tenantService.ts) (línea 2687).

Eliminación tenant involucra historial, ERP, sync y Auth: [src/lib/tenantService.ts](../../src/lib/tenantService.ts) (línea 1225). Ver pruebas de timeout, append-only y triggers en [DISCOVERY](DISCOVERY.md).
