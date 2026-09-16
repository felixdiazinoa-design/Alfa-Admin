# ALFA-ADMIN — DISCOVERY

Snapshot auditado: `3cd9866` (`origin/develop`), 2026-09-16. Evidencia estática del repositorio; no acredita configuración ni estado de producción. Las líneas indicadas corresponden a ese snapshot.

## Alcance y procedencia

Workspace fuente: `/Users/felixdiaz/Documents/ChatGPT/Alfa-Admin`. Worktree documental: `/Users/felixdiaz/Documents/ChatGPT/alfa-workflow/ADMIN`, rama `feature/workflow-multiagent`, creado desde origin/develop. Snapshot `3cd9866`; `git rev-list --left-right --count origin/develop...HEAD` al descubrir: 0/0. Árbol estaba limpio. No se encontró AGENTS.md local antes de esta documentación.

Remoto GitHub `felixdiazinoa-design/Alfa-Admin`; origin/HEAD señala main. main (`447f905`) estaba 4 commits adelante: diff solo `src/pages/Tenants.tsx` (47 inserciones/45 eliminaciones), compactación modal empresa y resumen productos. Arquitectura/backend/CI analizados no difieren entre ambos snapshots. No inferir base de ramas de producción a partir de origin/HEAD; README solo documenta deployment main.

## Inventario documental

- [SYSTEM_MAP](SYSTEM_MAP.md): componentes.
- [CRITICAL_FLOWS](CRITICAL_FLOWS.md): operaciones críticas.
- [DEPENDENCY_MAP](DEPENDENCY_MAP.md): contratos.
- [RISK_AREAS](RISK_AREAS.md): riesgos y límites.
- [TENANT_MODEL](TENANT_MODEL.md): identidades Cloud/ERP/POS.
- [PERMISSION_MODEL](PERMISSION_MODEL.md): autorización.
- [PROVISIONING_FLOW](PROVISIONING_FLOW.md): creación.
- [LICENSING_FLOW](LICENSING_FLOW.md): cupos y módulos.
- [APK_DEPLOYMENT](APK_DEPLOYMENT.md): distribución y deploy.

## Comandos existentes; no ejecutados como parte del descubrimiento

```sh
npm ci
npm run build
npm run lint
npm run test:tenant-semantics
npm run test:tenant-license-provisioning
npm run test:provision-tenant-auth
npm run test:activation-check-auth
npm run test:activation-tenant-resolution
npm run test:terminal-device-auth
npm run test:terminal-device-requests
npm run test:terminal-canonical-identity
npm run test:terminal-reconciliation
npm run test:terminal-activation-license
npm run test:terminal-reauthorization
npm run test:terminal-fiscal-config
npm run test:tenant-delete-sync-versions
npm run test:tenant-delete-timeout
npm run test:tenant-delete-append-only-history
npm run test:auth-user-delete-trigger
npm run test:item-tombstone-tenant-delete
npm run test:erp-tenant-delete-version-trigger
npm run test:erp-orphaned-delete-version-trigger
npm run test:erp-sync-domain-version-delete-regression
npm run test:pos-apk-release-status
npm run test:erp-module-licensing
npm run test:vercel-esm-runtime
```

`package.json` contiene además pruebas de soporte, requests, knowledge y calendar. Varias son readFile/regex; [scripts/test-terminal-device-auth.mjs](../../scripts/test-terminal-device-auth.mjs) (línea 4). Provision-auth importa handler real: `scripts/test-provision-tenant-auth.mjs:5`. Elegir pruebas según cambio; no ejecutar scripts cleanup ni verificaciones remotas de seguridad sin revisar efectos.

## Evidencia pendiente

No se ejecutó lint/build/test, no se inspeccionó dashboard Supabase/Vercel, permisos branch protection ni releases GitHub. No se accedió a secretos, DB productiva, archivos APK o dispositivo POS. No se garantiza que migraciones/functions del repo estén desplegadas. Firmas, hash real, integridad de instalación, rollback efectivo y contrato integrado deben verificarse antes de publicación operativa.
