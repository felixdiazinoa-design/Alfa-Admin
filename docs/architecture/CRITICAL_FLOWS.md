# ALFA-ADMIN — CRITICAL_FLOWS

Snapshot auditado: `3cd9866` (`origin/develop`), 2026-09-16. Evidencia estática del repositorio; no acredita configuración ni estado de producción. Las líneas indicadas corresponden a ese snapshot.

## Flujos que requieren regresión específica

| Flujo | Recorrido | Riesgo / validación |
|---|---|---|
| Login y autorización | Supabase Auth → comando session → usuario/perfil activo → permiso por operación | UI no constituye autorización; [api/lib/cloud-admin-session.ts](../../api/lib/cloud-admin-session.ts) (línea 93) |
| Provisioning tenant | RMS bearer servidor → Auth user → RPC → límites → metadata → subscription | Limpieza compensatoria; [PROVISIONING_FLOW](PROVISIONING_FLOW.md) |
| Activación POS | JWT cliente → resolver tenant Cloud/ERP → RPC licencia | No aceptar tenant aportado sin vinculación; [api/activation/validate-terminal-license.ts](../../api/activation/validate-terminal-license.ts) (línea 146) |
| Reautorización dispositivo | Admin autorizado → proxy/Edge → takeover canónico RMS → confirmación | UUID terminal estable, rotación, idempotencia, tenant; [docs/erp-terminal-device-requests-contract.md](../../docs/erp-terminal-device-requests-contract.md) (línea 80) |
| Liberación/cupo POS | comando con licenses_manage → servicio y RPC | Recuento por dispositivo y compatibilidad operativa; [src/lib/tenantService.ts](../../src/lib/tenantService.ts) (línea 2154) |
| Módulos ERP | permiso licencias → entitlement RPC → auditoría | ERP activo/dependencias/ack ERP; [supabase/functions/module-licensing-api/index.ts](../../supabase/functions/module-licensing-api/index.ts) (línea 110) |
| Publicación APK | registrar URL/metadata → internal_testing → QA externo → available | No usar latest para descargar pruebas; [APK_DEPLOYMENT](APK_DEPLOYMENT.md) |
| Suspensión/eliminación tenant | comando administrativo → servicio → historial/ERP/Auth | Eliminación irreversible; integridad append-only, triggers y sync; [src/lib/tenantService.ts](../../src/lib/tenantService.ts) (línea 1225) |
| Soporte/adjuntos | Edge API → Storage privado → enlace firmado → proveedor email | Aislamiento, permisos y webhooks; [supabase/functions/knowledge-api/index.ts](../../supabase/functions/knowledge-api/index.ts) (línea 151) |

El documento de takeover define transacción esperada en RMS; una especificación no prueba implementación remota. Validar el contrato real en ambos repositorios antes de cambiarlo.

Pruebas focalizadas existentes se inventarían en [DISCOVERY](DISCOVERY.md); pruebas estáticas no sustituyen un smoke integrado.
