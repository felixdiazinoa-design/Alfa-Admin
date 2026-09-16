# ALFA-ADMIN — constitución técnica

React 19/TypeScript/Vite y HashRouter; API serverless Vercel (`api/`), Edge Functions Deno (`supabase/functions/`), Supabase Auth y schema `landlord`. Auth y permisos server-side: `api/lib/cloud-admin-session.ts` y `supabase/functions/_shared/cloud-admin-auth.ts`. Service role solo servidor; tenant de payload nunca demuestra autorización.

Comandos administrativos se centralizan en `api/admin/command.ts`. Provisioning, licencias y dispositivos cruzan RMS/POS y requieren REVIEW QA SECURITY TENANT-INTEGRITY. Administrador global landlord y usuario de cliente son actores distintos; probar A→B con roles e IDs manipulados. No probar eliminación/provisioning contra clientes reales.

APK POS registra metadata/URL por `pos-apk-releases-api` con `apk_manage`; upload binario no identificado. Estado internal_testing debe conservarse separado de available. `/api/pos-apk/latest` es público y solo devuelve available. Storage identificado pertenece a helpdesk/knowledge; no asumir bucket APK. Deployment documentado Vercel main y workflow Supabase main: PR integración develop no despliega automáticamente todo ni aprueba producción; confirmar plan coordinado funciones/migraciones.


## Constitución ALFA-ADMIN: procedimiento multiagente obligatorio

ALFA es una plataforma independiente; los nombres históricos en código son evidencia técnica, no equivalencia comercial ni autorización para operar otros repositorios.

Antes de cualquier tarea leer [WORKFLOW.md](./WORKFLOW.md), [.codex/RISK_MATRIX.md](./.codex/RISK_MATRIX.md) y [descubrimiento](./docs/architecture/DISCOVERY.md). Usar agentes de proyecto MD/TOML de `.codex/agents/`. Orchestrator coordina sin desarrollar; analyst investiga; developer implementa; reviewer, QA, integration y validadores especializados verifican en sesiones independientes. Ningún autor del candidato puede aprobarlo. Developer declara solo IMPLEMENTATION COMPLETED.

Base obligatoria `origin/develop`; crear `feature/<modulo>-<tarea>` o `fix/<modulo>-<bug>` y `hotfix/<tema-critico>` solo urgencias. Commits Conventional pequeños; validar, push únicamente rama de tarea y PR hacia `develop`. Nunca push directo a clean-erp/develop/main. Mantener compatibilidad operativa y rollback propio de DB/API/artefactos.

La matriz determina mínimos acumulativos; nunca LOW automático para ventas/cobros/inventario/precios/impuestos/tickets/sync/offline/database/auth/permisos/tenants/licencias. Siempre REVIEW + QA + análisis INTEGRATION + RELEASE. FAILED vuelve a implementación/review/validación. Evidencia estática no certifica producción.

Comandos y alcance: `npm ci`, `npm run lint`, `npm run build`; seleccionar `npm run test:tenant-semantics`, `npm run test:tenant-license-provisioning`, `npm run test:provision-tenant-auth`, `npm run test:terminal-device-auth`, `npm run test:pos-apk-release-status`, `npm run test:erp-module-licensing` según impacto. `verify:supabase-security` requiere entorno seguro configurado; no ejecutar contra producción sin alcance autorizado.

Arquitectura y módulos críticos: [SYSTEM_MAP](./docs/architecture/SYSTEM_MAP.md), [CRITICAL_FLOWS](./docs/architecture/CRITICAL_FLOWS.md), [DEPENDENCY_MAP](./docs/architecture/DEPENDENCY_MAP.md), [RISK_AREAS](./docs/architecture/RISK_AREAS.md). Antes de cambios de datos/security/sync verificar aislamiento, atomicidad real e idempotencia; no asumir que UI PASS equivale a DATA/SECURITY PASS.

`node .codex/workflow.mjs plan origin/develop` genera scope exacto. Evidencias externas deben conservar sourceCommit y scopeHash; cualquier cambio los invalida. `verify` exige autores/validadores diferentes y gates ordenados; las identidades/reportes necesitan revisión humana/observación de sesiones, pues no son firmas criptográficas. Integración considera siempre los tres repos y sus SHAs.

APPROVED_FOR_INTERNAL_TESTING nunca equivale a APPROVED_FOR_PRODUCTION. Release requiere testing interno y aprobación productiva independientes; no hay publicación ni merge automático por crear estos archivos. No imprimir secretos ni consultar/modificar datos reales fuera del alcance de la tarea.
