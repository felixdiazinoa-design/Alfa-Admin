# ALFA-ADMIN — RISK_AREAS

Snapshot auditado: `3cd9866` (`origin/develop`), 2026-09-16. Evidencia estática del repositorio; no acredita configuración ni estado de producción. Las líneas indicadas corresponden a ese snapshot.

## Riesgos demostrados y límites

| Área | Evidencia | Implicación |
|---|---|---|
| Deploy schema automático | [.github/workflows/deploy-supabase-functions.yml](../../.github/workflows/deploy-supabase-functions.yml) (línea 3) | main aplica todas migraciones pendientes; sin lint/build/tests en ese workflow |
| Cobertura functions deploy | [.github/workflows/deploy-supabase-functions.yml](../../.github/workflows/deploy-supabase-functions.yml) (línea 3), [supabase/config.toml](../../supabase/config.toml) (línea 1) | module-licensing-api y funciones operativas terminal no están en lista deploy; runtime puede divergir |
| Provisioning no atómico | [api/activation/provision-tenant.ts](../../api/activation/provision-tenant.ts) (línea 300) | Auth/RPC/metadata/subscription separados; compensación sin comprobar sus errores |
| Autoridad tenant | [api/lib/resolve-landlord-tenant.ts](../../api/lib/resolve-landlord-tenant.ts) (línea 24) | Cloud/ERP distintos; metadata editable solo puede ser pista, pertenencia requiere corroboración |
| Fallback permisos duplicado | [src/lib/cloudAdminPermissions.ts](../../src/lib/cloudAdminPermissions.ts) (línea 3), [api/lib/cloud-admin-session.ts](../../api/lib/cloud-admin-session.ts) (línea 93), [supabase/functions/_shared/cloud-admin-auth.ts](../../supabase/functions/_shared/cloud-admin-auth.ts) (línea 69) | UI y backend no tienen mapas completamente idénticos |
| Escape clave pública | [src/lib/supabase.ts](../../src/lib/supabase.ts) (línea 9) | VITE_ALLOW_INSECURE_SUPABASE_KEYS puede omitir guardia local; no prueba que esté habilitado |
| Validación APK | [supabase/functions/pos-apk-releases-api/index.ts](../../supabase/functions/pos-apk-releases-api/index.ts) (línea 91) | checksum opcional valida formato; no descarga binario ni verifica hash/firma reales |
| Última versión | [api/pos-apk/latest.ts](../../api/pos-apk/latest.ts) (línea 64) | Público y disponible solamente; no permite probar un release internal_testing |
| Rollback | [.github/workflows/deploy-supabase-functions.yml](../../.github/workflows/deploy-supabase-functions.yml) (línea 3) | Revert Git no revierte migración ni publicación APK; preparar compensación por sistema |
| Pruebas contractuales | [scripts/test-terminal-device-auth.mjs](../../scripts/test-terminal-device-auth.mjs) (línea 4) | Regex sobre fuente no verifica operación distribuida ni estado productivo |
| CLI CI | [.github/workflows/deploy-supabase-functions.yml](../../.github/workflows/deploy-supabase-functions.yml) (línea 3) | Supabase CLI latest sin fijación; comportamiento puede cambiar |

No se ha auditado exhaustivamente cada policy RLS, función SQL, webhook ni permiso por proveedor. No se conectó a producción, no se inspeccionaron secretos, no se ejecutaron migraciones ni smoke POS. Estas limitaciones evitan presentar revisión estática como garantía de seguridad u operación.

No existe un canal APK binario/upload identificado; no suponer Storage APK por la existencia de otros buckets. Ver [APK_DEPLOYMENT](APK_DEPLOYMENT.md).
