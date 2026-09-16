# ALFA-ADMIN — DEPENDENCY_MAP

Snapshot auditado: `3cd9866` (`origin/develop`), 2026-09-16. Evidencia estática del repositorio; no acredita configuración ni estado de producción. Las líneas indicadas corresponden a ese snapshot.

## Dependencias técnicas

| Origen | Destino | Contrato y alcance |
|---|---|---|
| UI Admin | `/api/admin/command` | Bearer sesión y action/payload; [src/lib/adminApi.ts](../../src/lib/adminApi.ts) (línea 17) |
| Command Node | servicios tenant/observability | Imports ESM `.js` desde TS; permiso por action; [api/admin/command.ts](../../api/admin/command.ts) (línea 9) |
| Node/Edge | Supabase landlord | service role, esquema explícito; [api/lib/cloud-admin-session.ts](../../api/lib/cloud-admin-session.ts) (línea 93) |
| Activación | Auth / public / landlord | Resolver IDs distintos; RPC `validate_terminal_activation_license`; [api/activation/validate-terminal-license.ts](../../api/activation/validate-terminal-license.ts) (línea 146) |
| Tenant creation | RPC `create_new_tenant` | Firma con límites iniciales POS/ERP; [api/activation/provision-tenant.ts](../../api/activation/provision-tenant.ts) (línea 300) |
| UI módulos | `module-licensing-api` | licenses_view/manage, entitlement RPC y auditoría; [supabase/functions/module-licensing-api/index.ts](../../supabase/functions/module-licensing-api/index.ts) (línea 110) |
| Proxy terminal | `request-terminal-device-authorization` | Valida actor antes de service-role Edge call; [api/terminal-device-action.ts](../../api/terminal-device-action.ts) (línea 977) |
| Edge terminal | ALFA-RMS | `/api/settings/terminals/:id/takeover`; actor, IDs y rotación; [docs/erp-terminal-device-requests-contract.md](../../docs/erp-terminal-device-requests-contract.md) (línea 80) |
| Releases | URL HTTP(S) externa | Registro metadata, conversión enlaces Drive; no carga binaria identificada; [supabase/functions/pos-apk-releases-api/index.ts](../../supabase/functions/pos-apk-releases-api/index.ts) (línea 91) |
| Latest público | tabla releases | disponible con máximo version_code, redirect opcional; [api/pos-apk/latest.ts](../../api/pos-apk/latest.ts) (línea 64) |
| HelpDesk / knowledge | Storage privado / proveedores | Buckets separados; uploads/downloads firmados; [supabase/functions/knowledge-api/index.ts](../../supabase/functions/knowledge-api/index.ts) (línea 151) |
| GitHub Actions main | Supabase producción | db push + lista explícita functions; [.github/workflows/deploy-supabase-functions.yml](../../.github/workflows/deploy-supabase-functions.yml) (línea 3) |

React, React Router, Recharts, lucide, date-fns y supabase-js aparecen en `package.json`; lockfile fija resolución instalada. No instalar ni actualizar dependencias como parte de documentación.

Hay dos identidades tenant (Cloud y ERP) y tres implementaciones de fallback de permisos. Cambios coordinados requieren comparar contratos, no copiar IDs o mapas a ciegas. Ver [TENANT_MODEL](TENANT_MODEL.md), [PERMISSION_MODEL](PERMISSION_MODEL.md).
