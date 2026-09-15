# ALFA-Admin

Centro de control y administración de la plataforma ALFA-RMS. Reúne la gestión de tenants, licencias, soporte, seguridad, observabilidad, implementaciones y distribución de versiones.

## Provisioning desde ALFA-RMS

El endpoint `POST /api/activation/provision-tenant` requiere autenticación
servidor-a-servidor. Configura `CLOUD_ADMIN_PROVISION_TOKEN` en Vercel con un
secreto aleatorio de alta entropía y usa el mismo valor como
`CLOUD_ADMIN_API_TOKEN` únicamente en el backend de ALFA-RMS. Nunca expongas
este valor con un prefijo `VITE_`.

## Arquitectura

- React 19 + TypeScript + Vite para la interfaz.
- Funciones serverless en `api/` para operaciones administrativas privilegiadas.
- Supabase para autenticación, datos y Edge Functions.
- Vercel para compilación y despliegue.

La clave pública de Supabase se utiliza en el navegador. La clave `service_role` es exclusivamente server-side y nunca debe tener prefijo `VITE_`.

## Requisitos y configuración local

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Variables públicas: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.

Variables server-side: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `INTEGRATION_SECRET_KEY`.

No agregues secretos al repositorio. Consulta `.env.example` para valores de referencia seguros.

## Scripts principales

- `npm run dev`: servidor local de Vite.
- `npm run build`: TypeScript y build de producción.
- `npm run lint`: ESLint.
- `npm run test:*`: pruebas contractuales y regresiones por módulo.
- `npm run check:supabase-keys`: valida el tipo de las claves locales.

## Validación y despliegue

Antes de abrir un PR ejecuta `npm ci`, `npm run build` y `npm run lint`. Los despliegues de producción salen de `main` hacia el proyecto Vercel `alfa-admin`.

## Relación con ALFA-RMS

ALFA-Admin administra la plataforma, pero conserva contratos técnicos con ALFA-RMS para licenciamiento, sincronización, terminales y distribución del módulo POS. No cambies rutas, códigos de producto, cabeceras ni identificadores heredados únicamente por motivos de marca.

Consulta [la guía de marca](docs/branding/alfa-admin-brand-guide.md) y [el inventario de identificadores heredados](docs/branding/alfa-admin-legacy-identifiers.md).
