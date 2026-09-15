# Contrato ALFA-RMS: solicitudes de dispositivo para terminales POS

ALFA-Admin no persiste ni resuelve solicitudes localmente. ALFA-RMS es la fuente canónica porque recibe el bootstrap del POS y es el único componente que puede cambiar `public.erp_terminals.authorized_device_id`, revocar credenciales y resolver la solicitud en una transacción.

## Persistencia

El ERP debe ampliar `public.terminal_auth_attempts` (o renombrarla sin romper el endpoint existente) para exponer como mínimo:

- `id` UUID, identificador de operación/solicitud.
- `tenant_id`, `terminal_id`, `requested_device_id`, `authorized_device_id`.
- `resolution_status`: `PENDING`, `APPROVED`, `REJECTED` o `EXPIRED`.
- `created_at`, `updated_at`, `approved_at`, `approved_by`.
- Metadatos opcionales sin tokens: `device_name`, versión POS, IP y motivo.

Debe existir una restricción idempotente para una solicitud pendiente por `(tenant_id, terminal_id, requested_device_id)`. Repetir el bootstrap del mismo dispositivo actualiza `updated_at` y los metadatos; no inserta otra fila.

Compatibilidad temporal: el runtime serverless actualmente guarda estos eventos como `REJECTED` aunque no exista rechazo administrativo (`reason = DEVICE_SUPERSEDED`, `metadata.runtime = serverless`, sin `resolved_at` ni `resolved_by`). ALFA-Admin interpreta únicamente el evento legacy más reciente como pendiente. El hotfix de ALFA-RMS debe persistirlo directamente como `PENDING` y eliminar esta ambigüedad.

## Bootstrap POS

`POST /api/sync/bootstrap/check`

Cuando `terminal_id` es UUID canónico y `request_device_id` difiere del dispositivo autorizado:

1. Validar que terminal y tenant pertenecen al mismo contexto.
2. Bloquear o hacer UPSERT de la solicitud pendiente.
3. No crear otra terminal y no modificar el UUID ERP.
4. No autorizar ni emitir credenciales.

Respuesta mientras está pendiente:

```json
{
  "success": false,
  "code": "DEVICE_SUPERSEDED",
  "terminal_id": "6f0b1dad-591a-4848-9a13-7839d44b3202",
  "request_device_id": "DEV-N9E5WC8D",
  "authorized_device_id": "DEV-YUXCYHCG",
  "authorization_status": "PENDING",
  "can_register": false
}
```

Después de aprobar, el mismo bootstrap para el dispositivo nuevo debe responder:

```json
{
  "success": true,
  "terminal_id": "6f0b1dad-591a-4848-9a13-7839d44b3202",
  "request_device_id": "DEV-N9E5WC8D",
  "authorized_device_id": "DEV-N9E5WC8D",
  "authorization_status": "AUTHORIZED",
  "can_register": true,
  "next_action": "REGISTER"
}
```

Para el dispositivo anterior debe conservarse:

```json
{
  "success": false,
  "code": "DEVICE_SUPERSEDED",
  "terminal_id": "6f0b1dad-591a-4848-9a13-7839d44b3202",
  "request_device_id": "DEV-YUXCYHCG",
  "authorized_device_id": "DEV-N9E5WC8D",
  "authorization_status": "DEVICE_SUPERSEDED",
  "can_register": false
}
```

El botón “Reintentar” del POS solo vuelve a consultar este endpoint.

## Consulta para ALFA-Admin

Se mantiene `GET /api/sync/terminals/{terminal_id}/auth-attempts`. Cada elemento debe incluir los campos canónicos anteriores y nunca incluir tokens. El endpoint debe verificar el tenant de la credencial de servicio y la terminal.

Mientras ALFA-RMS normaliza ese contrato HTTP, el backend server-side de ALFA-Admin valida la solicitud seleccionada directamente contra `public.terminal_auth_attempts`, usando el tenant ALFA-RMS resuelto desde la sesión y el UUID canónico de la terminal. Esta lectura no autoriza, no resuelve solicitudes y no modifica terminales: la única mutación sigue siendo el takeover canónico de ALFA-RMS. El navegador no aporta el tenant ni puede acceder con la service role.

## Aprobar y reemplazar

ALFA-Admin usa exclusivamente `POST /api/settings/terminals/{terminal_id}/takeover` con:

```json
{
  "terminal_id": "6f0b1dad-591a-4848-9a13-7839d44b3202",
  "request_id": "<uuid-solicitud>",
  "device_id": "DEV-N9E5WC8D",
  "device_name": "<opcional>",
  "tenant_id": "<uuid-tenant-erp>",
  "cloud_admin_tenant_id": "f823d900-07c6-4318-aeb0-b287b0bd9652",
  "expected_authorized_device_id": "DEV-YUXCYHCG",
  "reason": "CLOUD_ADMIN_TERMINAL_REAUTHORIZATION",
  "requested_by": "<usuario-cloud-admin-verificado>",
  "takeover": true,
  "rotate_device_token": true,
  "idempotency_key": "<uuid-operacion>"
}
```

La transacción ERP debe:

1. Bloquear `terminal_auth_attempts` y `erp_terminals` con `FOR UPDATE`.
2. Validar tenant, terminal, solicitud `PENDING`, dispositivo solicitante y `expected_authorized_device_id`.
3. Ejecutar el takeover con control CAS.
4. Revocar tokens/credenciales del dispositivo anterior y rotar las del nuevo.
5. Marcar la solicitud `APPROVED`, con `approved_at`, `approved_by` y `updated_at`.
6. Insertar auditoría con tenant, terminal, dispositivos, actor e identificador de operación.
7. Confirmar todo o revertir todo.

Respuesta obligatoria:

```json
{
  "success": true,
  "operation_id": "<uuid-operacion>",
  "request_id": "<uuid-solicitud>",
  "request_status": "APPROVED",
  "terminal_id": "6f0b1dad-591a-4848-9a13-7839d44b3202",
  "previous_device_id": "DEV-YUXCYHCG",
  "new_device_id": "DEV-N9E5WC8D",
  "authorized_device_id": "DEV-N9E5WC8D",
  "takeover_confirmed": true,
  "previous_device_revoked": true,
  "rotate_device_token": true,
  "tokens_revoked": 1
}
```

## Rechazar

ALFA-Admin llama `POST /api/sync/terminals/{terminal_id}/auth-attempts/{request_id}/reject` con `tenant_id`, `cloud_admin_tenant_id`, `requested_device_id`, `reason` y `requested_by`. La operación debe ser idempotente, bloquear la solicitud, validar tenant/terminal/dispositivo y devolver:

```json
{
  "success": true,
  "operation_id": "<uuid-operacion>",
  "request_id": "<uuid-solicitud>",
  "request_status": "REJECTED"
}
```

Rechazar no modifica `erp_terminals.authorized_device_id` ni las credenciales del dispositivo vigente.

## Errores

El ERP debe devolver códigos estables: `DEVICE_SUPERSEDED`, `DEVICE_NOT_AUTHORIZED`, `TAKEOVER_REQUIRED`, `TAKEOVER_POLICY_DENIED`, `TERMINAL_NOT_FOUND`, `TENANT_MISMATCH`, `DEVICE_REQUEST_MISMATCH`, `DEVICE_REQUEST_NOT_PENDING`, `TERMINAL_BINDING_CHANGED_RETRY` y `TAKEOVER_RESPONSE_AMBIGUOUS`.

Ninguno de estos flujos puede usar `/api/sync/terminals/register`, `/api/setup/bind-terminal` ni un JWT administrativo enviado desde el POS.

El `catalog_terminal_id` puede coincidir con el `terminal_id` canónico cuando el catálogo cloud fue reconciliado reutilizando el UUID de ALFA-RMS. Esa igualdad no bloquea la operación: el backend debe comprobar que el UUID existe en `erp_terminals`, que su `store_id` coincide y que la tienda pertenece al tenant ALFA-RMS resuelto para el tenant de ALFA-Admin.
