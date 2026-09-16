# ALFA-ADMIN — SYSTEM_MAP

Snapshot auditado: `3cd9866` (`origin/develop`), 2026-09-16. Evidencia estática del repositorio; no acredita configuración ni estado de producción. Las líneas indicadas corresponden a ese snapshot.

## Componentes y responsabilidades

| Componente | Responsabilidad | Evidencia |
|---|---|---|
| React 19 / TypeScript / Vite | Interfaz administrativa; HashRouter y módulos diferidos | [src/App.tsx](../../src/App.tsx) (línea 1) |
| Vercel `api/` | Sesión administrativa, comandos privilegiados, activation y proxy de terminales | [api/admin/command.ts](../../api/admin/command.ts) (línea 9) |
| Supabase Auth | Identidad; JWT validado en servidor | [api/lib/cloud-admin-session.ts](../../api/lib/cloud-admin-session.ts) (línea 93) |
| Esquema `landlord` | Tenants, subscriptions, perfiles, permisos, releases y soporte | [api/lib/cloud-admin-session.ts](../../api/lib/cloud-admin-session.ts) (línea 93) |
| Esquema `public` | Referencias ERP y RPC de activación | [api/activation/validate-terminal-license.ts](../../api/activation/validate-terminal-license.ts) (línea 146) |
| Edge Functions Deno | Operaciones de soporte, acceso, módulos, APK y terminales | [supabase/config.toml](../../supabase/config.toml) (línea 1) |
| Supabase Storage | Adjuntos HelpDesk y recursos de conocimiento privados | [supabase/functions/knowledge-api/index.ts](../../supabase/functions/knowledge-api/index.ts) (línea 151) |
| ALFA-RMS | Autoridad operativa del UUID terminal y takeover | [docs/erp-terminal-device-requests-contract.md](../../docs/erp-terminal-device-requests-contract.md) (línea 80) |
| ALFA-POS | Cliente operativo externo; heartbeat, activación, consumo de releases | [docs/erp-terminal-device-requests-contract.md](../../docs/erp-terminal-device-requests-contract.md) (línea 80) |

El backend Node importa servicios en `src/lib`, que bifurcan según runtime navegador/servidor. No separar esos archivos suponiendo que todo `src` es público: [src/lib/tenantService.ts](../../src/lib/tenantService.ts) (línea 909).

La clave pública vive en navegador; service role es exclusivamente servidor. El cliente comprueba tipo de clave, con escape configurable `VITE_ALLOW_INSECURE_SUPABASE_KEYS`: [src/lib/supabase.ts](../../src/lib/supabase.ts) (línea 9).

Frontend/serverless se documentan en Vercel; schema/functions se publican por GitHub Actions. No existe `vercel.json` en el snapshot. Ver [APK_DEPLOYMENT](APK_DEPLOYMENT.md) y [DEPENDENCY_MAP](DEPENDENCY_MAP.md).
