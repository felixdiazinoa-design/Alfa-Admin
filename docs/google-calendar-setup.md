# Activación de Google Calendar

La función `calendar-api` crea eventos con los asistentes seleccionados, envía las invitaciones y configura recordatorios por correo (24 horas) y ventana emergente (30 minutos).

## Google Cloud y Workspace

1. Habilitar Google Calendar API en el proyecto de Google Cloud.
2. Crear una cuenta de servicio y habilitar la delegación en todo el dominio.
3. En Google Workspace Admin, autorizar el Client ID numérico de la cuenta de servicio con el alcance mínimo:
   `https://www.googleapis.com/auth/calendar.events`
4. Elegir una cuenta organizadora de Mercasend para la suplantación y un calendario destino al que tenga acceso.

## Secretos de Supabase Edge Functions

Configurar los siguientes nombres desde el panel de Supabase o mediante su gestor seguro de secretos. No guardar sus valores en Git:

- `GOOGLE_CALENDAR_CLIENT_EMAIL`
- `GOOGLE_CALENDAR_PRIVATE_KEY`
- `GOOGLE_CALENDAR_IMPERSONATED_USER`
- `GOOGLE_CALENDAR_ID` (opcional; usa `primary` si se omite)

El resumen con IA reutiliza primero la configuración cifrada de OpenAI disponible en **Configuración > Integraciones**. Como alternativa admite `OPENAI_API_KEY` y `OPENAI_MODEL` como secretos de la Edge Function.

## Verificación

1. Crear una reunión de prueba con una cuenta interna y una externa.
2. Confirmar que ambas reciben la invitación.
3. Abrir el enlace del evento desde ALFA-Admin.
4. Verificar que el evento incluye el resumen, el contexto y ambos recordatorios.
5. Si falla, revisar el mensaje conservado en la tarjeta y usar **Reintentar** después de corregir las credenciales.
