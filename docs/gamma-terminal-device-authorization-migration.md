# Aplicar autorización de terminal en Supabase (gamma / prod)

ALFA-Admin y el módulo POS esperan columnas como `authorized_device_id` en `landlord.tenant_server_registry`. Si gamma muestra:

`column tenant_server_registry.authorized_device_id does not exist`

falta aplicar la migración **`202605271015_terminal_device_authorization.sql`**.

## Prerrequisito recomendado

Si `current_device_id` o `requires_pos_reauth` tampoco existen, aplica antes (o en el mismo mantenimiento):

- `supabase/migrations/202605241430_terminal_takeover_audit.sql`

## Opción A — Supabase CLI (recomendado)

Desde la raíz de este repo, con el proyecto gamma enlazado:

```bash
# 1) Login (si hace falta)
supabase login

# 2) Enlazar gamma (solo la primera vez; usa el project ref del dashboard)
supabase link --project-ref <TU_PROJECT_REF>

# 3) Ver migraciones pendientes
supabase migration list

# 4) Aplicar todas las pendientes al remoto
supabase db push
```

Para aplicar **solo** el archivo de autorización de dispositivos (si el resto ya está al día), puedes ejecutar su SQL en el SQL Editor (opción B) en lugar de forzar un push parcial.

**Project ref de gamma:** Dashboard → Project Settings → General → Reference ID (también suele estar en `supabase/.temp/project-ref` tras `supabase link` local).

## Opción B — SQL Editor en el Dashboard

1. Abre [Supabase Dashboard](https://supabase.com/dashboard) → tu proyecto gamma → **SQL Editor** → **New query**.
2. Pega el contenido completo de:

   `supabase/migrations/202605271015_terminal_device_authorization.sql`

3. Ejecuta (**Run**). Debe terminar sin error.

El archivo es idempotente (`IF NOT EXISTS` / `DROP CONSTRAINT IF EXISTS`).

## Verificar que quedó aplicado

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'landlord'
  AND table_name = 'tenant_server_registry'
  AND column_name IN (
    'authorized_device_id',
    'auth_status',
    'current_device_id',
    'requires_pos_reauth'
  )
ORDER BY column_name;
```

Debes ver al menos `authorized_device_id` y `auth_status`.

## Backfill para terminales ya online (opcional)

Después de la migración, alinea registros existentes con el `device_id` del heartbeat:

```sql
UPDATE landlord.tenant_server_registry
SET
  authorized_device_id = device_id,
  current_device_id = COALESCE(NULLIF(TRIM(current_device_id), ''), device_id),
  auth_status = 'AUTHORIZED',
  last_auth_error = NULL,
  requires_pos_reauth = FALSE,
  updated_at = timezone('utc', now())
WHERE authorized_device_id IS NULL
  AND device_id IS NOT NULL
  AND TRIM(device_id) <> '';
```

## Edge Functions (mismo proyecto)

Tras el schema, despliega (CLI o workflow manual):

```bash
supabase functions deploy request-terminal-device-authorization \
  --project-ref <TU_PROJECT_REF> \
  --no-verify-jwt

supabase functions deploy request-pos-erp-readiness \
  --project-ref <TU_PROJECT_REF> \
  --no-verify-jwt
```

## ALFA-Admin (Vercel gamma)

1. Merge/despliega el PR con el fix de **Persistir device autorizado** (actualización vía `supabaseAdmin` + fallback de columnas).
2. En **Tenants → terminales → Persistir device autorizado** → OK.
3. En el POS: **Reintentar conexión**.

Si el tenant quedó con `lifecycle_status = 'BLOCKED'`, en la UI usa **Quitar bloqueo POS** (POS_ONLY) o corrige manualmente:

```sql
UPDATE landlord.tenants
SET lifecycle_status = 'CLOUD_READY',
    provisioning_status = 'CLOUD_STAGING_REQUIRED'
WHERE id = '<TENANT_UUID>'
  AND contracted_product = 'POS_ONLY'
  AND lifecycle_status = 'BLOCKED';
```

## Licencias POS (limite de terminales)

Para bloquear cajas que excedan `max_pos_terminals`, aplica tambien:

`supabase/migrations/202605291200_pos_terminal_license_enforcement.sql`  
`supabase/migrations/202605291400_pos_license_count_by_device.sql` (cuenta por **device_id**, no por terminal_id compartido)

Eso actualiza `register_tenant_server_endpoint`, `resolve_tenant_license` y agrega `enforce_tenant_pos_license_limits`.

El POS debe leer `device_license_allowed` / `license_block_reason` de `resolve_tenant_license(..., p_device_id)` o `auth_status = LICENSE_EXCEEDED` en registry.

## Validación de licencia en activación POS (API de ALFA-Admin)

Para bloquear el wizard de instalacion cuando no hay cupo, aplica tambien:

`supabase/migrations/202605291500_terminal_activation_license_validation.sql`

Eso agrega `landlord.validate_terminal_activation_license` y el fallback REST `public.check_terminal_license_availability`.

Despliega ALFA-Admin (Vercel gamma) con la ruta:

`POST /api/activation/validate-terminal-license`

El APK de ALFA-RMS POS (v1.0.703+) llama ese endpoint con el JWT del login de activación. Si responde 404/501, intenta RPC Supabase y luego ALFA-RMS en modo estricto.

Para **POS_ONLY**, aplica tambien:

`supabase/migrations/202605291600_pos_only_terminal_slot_licensing.sql`

- 1 licencia = 1 terminal/caja (`terminal_id`), no 1 licencia por cada `device_id` historico.
- Nombres de caja unicos por tenant (`Caja 1`, `Caja 2`, ...); duplicados rechazados en `register_tenant_server_endpoint`.
- Reinstalar la misma caja con otro equipo no consume licencias extra si conserva el mismo `terminal_id`.

Limpieza opcional si un tenant acumulo muchos `device_id` sobre la misma caja:

```sql
-- Ver cupos reales (POS_ONLY cuenta terminal_id, no device_id)
SELECT * FROM landlord.count_tenant_pos_license_seats('<TENANT_UUID>');

-- Marcar equipos historicos offline salvo los activos de cada caja
UPDATE landlord.tenant_server_registry AS registry
SET status = 'OFFLINE', updated_at = timezone('utc', now())
WHERE tenant_id = '<TENANT_UUID>'
  AND status = 'ONLINE'
  AND device_id NOT IN ('DEV-....'); -- conservar solo el device vivo por caja

SELECT landlord.enforce_tenant_pos_license_limits('<TENANT_UUID>');
```

## Orden sugerido de migraciones relacionadas (referencia)

Si gamma está muy atrás, revisa también en `supabase/migrations/`:

| Archivo | Qué aporta |
|---------|------------|
| `202605241430_terminal_takeover_audit.sql` | `current_device_id`, `requires_pos_reauth`, auditoría takeover |
| `20260524234158_pos_erp_readiness_audit.sql` | `erp_readiness` en registry |
| `202605271015_terminal_device_authorization.sql` | **`authorized_device_id`**, `auth_status`, `terminal_device_audit` |
| `202605291200_pos_terminal_license_enforcement.sql` | Limite `max_pos_terminals`, `LICENSE_EXCEEDED`, RPC enforce |
| `202605291400_pos_license_count_by_device.sql` | Corrige conteo: 1 licencia = 1 equipo (`device_id`) |
| `202605291500_terminal_activation_license_validation.sql` | RPC activacion POS + fallback `check_terminal_license_availability` |
| `202605291600_pos_only_terminal_slot_licensing.sql` | POS_ONLY: licencia por caja/terminal_id + nombre unico de caja |
| `20260525101500_tenant_pos_erp_semantics.sql` | Semántica tenant (`lifecycle_status`, `backup_enabled`, etc.) |

`supabase db push` aplica las pendientes en orden de timestamp del nombre del archivo.
