# ALFA-ADMIN — PERMISSION_MODEL

Snapshot auditado: `3cd9866` (`origin/develop`), 2026-09-16. Evidencia estática del repositorio; no acredita configuración ni estado de producción. Las líneas indicadas corresponden a ese snapshot.

## Identidad administrativa y permiso por acción

1. Supabase autentica usuario; App resuelve comando `session`: [src/App.tsx](../../src/App.tsx) (línea 57).
2. Backend valida JWT con `auth.getUser`; obtiene `cloud_admin_users` y perfil relacionado: [api/lib/cloud-admin-session.ts](../../api/lib/cloud-admin-session.ts) (línea 93).
3. Usuario `active`, perfil `is_active=true` y permiso requerido son necesarios.
4. Permiso explícito false deniega; fallback legacy solo si no existe boolean explícito.

| Operación | Permiso demostrado |
|---|---|
| Leer/gestionar tenants | tenants_view / tenants_manage |
| Eliminar tenant | tenants_delete |
| Reautorizar device | terminal_reauthorization |
| Leer/gestionar licencias | licenses_view / licenses_manage |
| APK listar/crear/status | apk_view / apk_manage |
| APK latest privado | tenants_view |

Mapa comandos: [api/admin/command.ts](../../api/admin/command.ts) (línea 9). Módulos: [supabase/functions/module-licensing-api/index.ts](../../supabase/functions/module-licensing-api/index.ts) (línea 110). APK: [supabase/functions/pos-apk-releases-api/index.ts](../../supabase/functions/pos-apk-releases-api/index.ts) (línea 91). `GET /api/pos-apk/latest` es endpoint público separado.

UI `hasCloudAdminPermission`: [src/lib/cloudAdminPermissions.ts](../../src/lib/cloudAdminPermissions.ts) (línea 3); helper Node: [api/lib/cloud-admin-session.ts](../../api/lib/cloud-admin-session.ts) (línea 93); helper Edge: [supabase/functions/_shared/cloud-admin-auth.ts](../../supabase/functions/_shared/cloud-admin-auth.ts) (línea 69). Los fallbacks no son completamente idénticos: por ejemplo UI posee apk/support/users y Node conserva un subconjunto. `licenses_view/manage` remite a plans_view/manage; no asumir fallback transitivo sin revisar código.

La sesión Admin concede acceso administrativo de plataforma, no pertenencia automática de cliente POS a cualquier tenant. El endpoint activation valida usuario cliente y tenant por otro resolver: [api/lib/resolve-landlord-tenant.ts](../../api/lib/resolve-landlord-tenant.ts) (línea 24).

Funciones con verify_jwt=false necesitan revisión de su autenticación propia; configuración no demuestra autorización por sí sola: [supabase/config.toml](../../supabase/config.toml) (línea 1). Nunca trasladar service role a VITE_ para resolver permisos.
