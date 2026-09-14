# Identificadores heredados de ALFA-Admin

Este inventario separa la marca visible de los contratos técnicos. Los elementos marcados como “conservar” no deben renombrarse durante cambios de identidad.

| Identificador | Ubicación | Función y visibilidad | Dependencias y riesgo | Recomendación |
| --- | --- | --- | --- | --- |
| `cloud_admin_users` | Supabase, API y tipos | Tabla interna | Auth, perfiles y RLS; renombrarla rompe consultas | Conservar |
| `cloud_admin_profiles` | Supabase, API y tipos | Tabla interna de perfiles | Permisos, joins y sesión | Conservar |
| `cloud_admin_*` | Migraciones y Edge Functions | Contratos de base de datos | SQL, funciones y despliegues históricos | Conservar |
| `CloudAdminSession` | App y API | Tipo TypeScript interno | Resolución de sesión y autorización | Conservar |
| `CloudAdminPermissionKey` | `src/types.ts` | Contrato de permisos | Navegación, gates y perfiles | Conservar |
| `hasCloudAdminPermission` | `src/lib/` | Servicio interno | Permisos granulares y heredados | Conservar |
| `cloudAdmin*` | Servicios TypeScript | Nombres internos | Importaciones y contratos compilados | Conservar; migrar solo en refactor dedicado |
| `cloud-admin` | Valores de producto | Código persistido; etiqueta separada | Registros y filtros existentes | Conservar el valor; mostrar “ALFA-Admin” |
| `cloud-admin-ui` / `cloud-admin-api` | Cabeceras, auditoría y logs | Fuente técnica | Telemetría y trazabilidad histórica | Conservar |
| `X-Cloud-Admin-*` | Peticiones a ALFA-RMS | Cabeceras de integración | Contrato entre sistemas | Conservar |
| `CONFIG_ADMIN_TOKEN` | Funciones heredadas | Variable server-side | Automatizaciones antiguas | Conservar hasta retirar consumidores |
| `SUPABASE_*` / `VITE_SUPABASE_*` | Entornos | Configuración técnica | Build, Auth y funciones | Conservar; nunca exponer `service_role` con `VITE_` |
| Rutas y endpoints actuales | API y React Router | Contratos HTTP y navegación | Clientes, pruebas y bookmarks | Conservar |
| Pruebas con `cloud-admin` | `scripts/` | Regresiones internas | Contratos textuales y archivos | Conservar hasta migración dedicada |
| Logs históricos “Cloud-Admin” | API, funciones y servicios | Telemetría no comercial | Correlación de eventos | Conservar cuando sea clave de búsqueda |
| URLs `cloud-admin-*` | Documentación histórica | Despliegues previos | Auditoría | Conservar documentadas; no mostrar en producto |
| Firma gráfica MsMall | `helpdesk-email-branding.ts` | Imagen externa en correos | Activo alojado existente; no hay URL oficial aprobada de ALFA-Admin | Pendiente reemplazar al publicar el activo oficial; conservar temporalmente |

## Estrategia futura

Una migración técnica debe versionar contratos, aceptar identificadores antiguos y nuevos durante una transición, migrar datos y telemetría, y retirar alias solo después de comprobar que ALFA-RMS y las automatizaciones no los consumen.
