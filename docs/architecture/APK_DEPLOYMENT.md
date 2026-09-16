# ALFA-ADMIN — APK_DEPLOYMENT

Snapshot auditado: `3cd9866` (`origin/develop`), 2026-09-16. Evidencia estática del repositorio; no acredita configuración ni estado de producción. Las líneas indicadas corresponden a ese snapshot.

## Distribución APK identificada

Admin registra metadata y enlaces del APK mediante Edge `pos-apk-releases-api`, con apk_manage; no compila ni firma APK. Campos incluyen version_name, version_code, apk_url/direct_download_url, checksum_sha256, notas y checklist: [supabase/functions/pos-apk-releases-api/index.ts](../../supabase/functions/pos-apk-releases-api/index.ts) (línea 91).

**No se identificó Storage de binarios APK ni canal de upload APK.** Storage encontrado sirve HelpDesk y conocimiento. La URL puede ser HTTP(S) y enlaces Drive se normalizan a descarga directa. El checksum es opcional y solo se comprueba su formato; el servidor no inspecciona el binario, firma, package ID ni hash real.

## Estados y prueba

Estados técnicos: `draft`, `internal_testing`, `beta`, `available`, `retired`. El default de registro es **internal_testing**. Si se solicita available al crear, se inserta primero internal_testing y luego se cambia por RPC. [supabase/functions/pos-apk-releases-api/index.ts](../../supabase/functions/pos-apk-releases-api/index.ts) (línea 91)

Para pruebas internas usar exclusivamente el enlace técnico específico del release obtenido en gestión APK. **No usar `/api/pos-apk/latest` para internal_testing ni beta**: latest filtra `release_status=available` y selecciona mayor version_code, no el release que acaba de registrarse. [api/pos-apk/latest.ts](../../api/pos-apk/latest.ts) (línea 64)

Antes de available, el proceso externo POS debe aportar APK firmado, versión/package correctos, SHA-256 comprobado, enlace estable y smoke con conservación de datos. Este es requisito recomendado de publicación; Admin no impone automáticamente esos controles. No instalar, actualizar, publicar ni cambiar estados por esta documentación.

RPC `set_pos_apk_release_status` bloquea tabla, cambia estado/actor/notas y recalcula is_latest; solo service_role puede ejecutarla: [supabase/migrations/20260912192818_manage_pos_apk_release_status.sql](../../supabase/migrations/20260912192818_manage_pos_apk_release_status.sql) (línea 51). Tabla releases tiene RLS deny-public: [supabase/migrations/202605221000_pos_apk_releases.sql](../../supabase/migrations/202605221000_pos_apk_releases.sql) (línea 22).

`GET /api/pos-apk/latest` es público, JSON o redirect 302 con download=1; sin available devuelve release null o 404 en descarga. Actualizar ERP/terminales contra este endpoint implica canal disponible.

## Deployment Admin y Supabase

README declara Vercel alfa-admin y producción main. Workflow main/dispatch hace Supabase link, db push dry-run y db push real antes de deploy explícito de functions: [.github/workflows/deploy-supabase-functions.yml](../../.github/workflows/deploy-supabase-functions.yml) (línea 3). No corre lint/build/tests ni incluye todas functions existentes. No existe vercel.json; configuración Vercel remota no inspeccionada.

Revert Git no revierte schema ni available. Retirar un release es operación independiente; migraciones requieren compensación específica. Ver [RISK_AREAS](RISK_AREAS.md).
