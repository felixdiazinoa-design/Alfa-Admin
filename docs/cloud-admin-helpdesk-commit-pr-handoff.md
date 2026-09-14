# Cloud Admin HelpDesk Handoff

Fecha: 2026-05-18
Repo: `fdiazinoa/cloud-admin`
Workspace: `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/Cloud-Admin`

## Objetivo

Preparar commit y PR de los cambios del HelpDesk omnicanal de Cloud Admin: email inbound con Resend, triage IA, contactos externos, adjuntos, secuencia de tickets, respuestas por email desde Command Center y threading de correos.

## Estado Git Actual

Rama local actual:

```bash
feat/support-ai-triage-insights
```

Estado observado:

```text
## feat/support-ai-triage-insights...origin/feat/support-ai-triage-insights [ahead 1]
 M supabase/functions/process-inbound-email/index.ts
 M supabase/functions/send-support-reply/index.ts
```

Commits relevantes:

```text
ffe56a3 chore(ci): deploy support reply function
3d64420 fix(support): preserve email threads and attachments
b408421 feat(support): enrich AI ticket triage
```

Importante:

- `3d64420` ya fue empujado a `origin/feat/support-ai-triage-insights`.
- `ffe56a3` esta solo local. El push fallo porque el token local de GitHub no tiene scope `workflow`.
- Hay cambios locales sin commit en:
  - `supabase/functions/process-inbound-email/index.ts`
  - `supabase/functions/send-support-reply/index.ts`

## Cambios Ya Implementados

- Ticket number secuencial (`ticket_number`) en vez de UUID para el numero visible.
- Email inbound desde Resend hacia `process-inbound-email`.
- Creacion/lookup de contactos externos por email.
- Triage IA:
  - categoria
  - prioridad
  - sentimiento
  - resumen
  - borradores sugeridos
  - posible falla masiva / incidente similar
- Guardado de adjuntos inbound en Supabase Storage bucket `support-attachments`.
- Render de adjuntos en Command Center.
- Respuestas desde Cloud Admin usando Edge Function `send-support-reply`.
- Threading de email con:
  - `In-Reply-To`
  - `References`
  - `reply_to` hacia el inbound de Resend.
- Subject de respuestas desde Cloud Admin:

```text
[Ticket #N] Re: Asunto original
```

## Deploys Hechos Manualmente

Proyecto Supabase:

```text
cdfdgxejnbznjxuokrrx
```

Edge Functions:

- `process-inbound-email`
  - desplegada manualmente como version 8
  - `verify_jwt=false`
  - usa un entrypoint que importa el codigo del commit remoto `3d64420`
- `send-support-reply`
  - desplegada manualmente como version 5
  - `verify_jwt=false`
  - incluye subject `[Ticket #N] Re: ...`

Vercel:

- Production deploy realizado.
- URL principal validada:

```text
https://cloud-admin-gamma.vercel.app
```

- Alias de preview repuntado al deploy nuevo:

```text
https://cloud-admin-git-feat-support-ai-tr-0e719a-felix-diaz-s-projects.vercel.app
```

## Configuracion Actual

En `landlord.support_integration_settings`:

- `resend_inbound_email`: `test@zaelgi.resend.app`
- `resend_from_email`: `notificaciones@mercasend.net`

Notas:

- El inbound real se esta usando via Resend.
- Las respuestas del cliente deben ir al `reply_to` configurado en Resend inbound.
- El `from` visible puede ser `notificaciones@mercasend.net`.

## Problemas Detectados

### 1. GitHub Actions no despliega

El workflow `.github/workflows/deploy-supabase-functions.yml` fallo en `Validate secrets`.

Faltan secretos en GitHub:

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_PROJECT_REF
```

Ademas, el workflow original no desplegaba `send-support-reply`. Hay un commit local (`ffe56a3`) que agrega ese paso, pero no pudo subirse porque el token local no tiene permiso `workflow`.

### 2. Algunos links de Vercel apuntan a builds viejos

Sintoma:

- El agente responde en Cloud Admin.
- El mensaje se guarda en `ticket_messages`.
- Pero queda con `attachments: []`, sin `resend_email_id`.

Eso significa que la UI usada es vieja y esta insertando directo en Supabase, sin llamar a `send-support-reply`.

Usar:

```text
https://cloud-admin-gamma.vercel.app
```

Evitar links tipo:

```text
cloud-admin-re62tqvwu-felix-diaz-s-projects.vercel.app
```

porque son deployments antiguos/inmutables.

### 3. Gmail puede mostrar el subject original del hilo

Aunque el email saliente tenga:

```text
[Ticket #N] Re: Asunto
```

Gmail puede mostrar arriba el subject original del primer correo en la conversacion. Esto no significa que el email no tenga el numero; es comportamiento de la vista de hilo.

## Pruebas Realizadas

Build local:

```bash
npm run build
```

Resultado:

```text
✓ built
```

Edge Function `send-support-reply`:

```text
OPTIONS /functions/v1/send-support-reply -> 200 {"ok":true}
```

Edge Function `process-inbound-email`:

```text
POST ping -> 200 {"ok":true,"ignored":true}
```

Envios retroactivos confirmados:

- Ticket #7:
  - `resend_email_id`: `11ecd667-a7ec-430e-8034-493f0e642b08`
- Ticket #5:
  - `resend_email_id`: `1b0948e1-e22d-43b3-b01a-f6a915b84d0c`
  - subject guardado: `[Ticket #5] Re: Error en NCF`

## Pendiente Recomendado Para El Proximo Hilo

1. Resolver el estado Git local.
   - Revisar si se conserva o se rehace el commit local `ffe56a3`.
   - Evitar `git reset --hard` sin confirmacion del usuario.

2. Crear una rama correcta desde `develop`, segun AGENTS.md, si se va a formalizar PR:

```bash
git fetch origin
git checkout develop
git pull origin develop
git checkout -b fix/support-email-replies
```

3. Portar los cambios necesarios desde `feat/support-ai-triage-insights`.

4. Incluir en el PR:
   - `src/pages/SupportCommandCenter.tsx`
   - `supabase/functions/process-inbound-email/index.ts`
   - `supabase/functions/send-support-reply/index.ts`
   - `supabase/config.toml`
   - migraciones de soporte/tickets/attachments que apliquen
   - workflow actualizado para desplegar `send-support-reply`

5. Validar:

```bash
npm run build
```

6. Corregir GitHub Actions secrets:

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_PROJECT_REF=cdfdgxejnbznjxuokrrx
```

7. Abrir PR hacia `develop`, no hacia `main`, siguiendo AGENTS.md.

## Checklist De PR

- [ ] Rama basada en `develop`.
- [ ] Cambios minimos y agrupados.
- [ ] `npm run build` pasa.
- [ ] Edge Functions desplegables desde workflow.
- [ ] `send-support-reply` incluido en workflow.
- [ ] No exponer service role en frontend como solucion final.
- [ ] Probar respuesta desde Cloud Admin en `https://cloud-admin-gamma.vercel.app`.
- [ ] Verificar que `ticket_messages.attachments` tenga `resend_email_id`.
- [ ] Verificar en Resend logs que el envio tenga status exitoso.

## Nota De Seguridad

Las operaciones privilegiadas deben permanecer en Edge Functions o funciones backend. El frontend solo puede recibir la URL de Supabase y una clave pública (`anon` o `publishable`); la clave `SUPABASE_SERVICE_ROLE_KEY` es exclusivamente server-side.
