# Manual operativo de Clic-Suite para Helpdesk Copilot

**Versión:** 1.0  
**Fecha de verificación:** 2026-08-10  
**Productos:** ALFA-RMS POS, ALFA-RMS y ALFA-Admin
**Uso:** base de conocimiento recuperable para clasificación, borradores y respuestas autónomas gobernadas.

## 1. Propósito y forma de uso

Este manual no sustituye el código ni entrena de forma irreversible al modelo. Sus secciones se cargan como fragmentos en `landlord.support_knowledge_base`; Copilot recupera los fragmentos relacionados con cada ticket antes de clasificar o responder.

Reglas obligatorias para Copilot:

1. Responder únicamente con procedimientos respaldados por un fragmento relacionado con el caso.
2. Identificar primero producto, empresa, sucursal, terminal, versión, fecha y hora aproximada.
3. Distinguir una acción segura del cliente de una acción administrativa o destructiva.
4. No pedir contraseñas, tokens, llaves privadas, datos completos de tarjeta ni credenciales fiscales por correo.
5. No indicar reinstalación, limpieza de almacenamiento, borrado de SQLite, liberación de caja o cambio de `device_id` mientras existan ventas, cierres o documentos pendientes.
6. No afirmar que un e-CF fue aceptado por DGII sin evidencia del proveedor fiscal.
7. Cuando falte evidencia, solicitar los datos mínimos y escalar; nunca completar pasos por intuición.

## 2. Datos mínimos para cualquier incidencia

Solicitar solamente lo que falte:

- Producto afectado: ALFA-RMS POS, ALFA-RMS o ALFA-Admin.
- Empresa/tenant y sucursal.
- Nombre o identificador visible de la terminal, si aplica.
- Versión de la aplicación y `versionCode`, si están disponibles.
- Fecha y hora aproximada, zona horaria y folio/documento afectado.
- Texto exacto del error y captura sin secretos.
- Alcance: un usuario, una caja, una sucursal o todas.
- Estado de conectividad y si el problema continúa después de reintentar una vez.

Si hay riesgo de pérdida de ventas o datos fiscales, Copilot debe acusar recibo y escalar a una persona; no debe experimentar con el entorno del cliente.

Fuentes verificadas:

- `Cloud-Admin/supabase/functions/_shared/helpdesk-autonomy.ts`
- `Cloud-Admin/supabase/functions/generate-support-draft/index.ts`

## 3. ALFA-RMS POS

### 3.1 Arquitectura offline-first y protección de la cola local

ALFA-RMS POS opera localmente y sincroniza con ALFA-RMS en segundo plano. En Android usa SQLite nativo; en web usa IndexedDB. Una caída de Internet no implica que las ventas locales deban borrarse.

Procedimiento de soporte:

1. Confirmar si la venta terminó localmente y si existe folio o ticket.
2. Confirmar si el indicador muestra sin conexión, sincronizando o sincronizado.
3. Pedir terminal, folios, hora del último cierre Z y cantidad aproximada de pendientes.
4. Restablecer la red y usar una sola vez la acción **Forzar Sincronización Completa** cuando la interfaz esté disponible.
5. Si continúan pendientes, copiar el diagnóstico y escalar sin borrar datos.

Nunca indicar desinstalar, borrar almacenamiento, reiniciar la base o forzar enlaces internos para resolver una cola pendiente.

Fuentes verificadas:

- `CLIC-POS/docs/ANDROID_APK_SQLITE.md`
- `CLIC-POS/components/SyncStatusHub.tsx`
- `CLIC-POS/services/sync/SyncQueue.ts`

### 3.2 Activación inicial del POS

La pantalla **Activación** usa el email registrado y la contraseña temporal. En el primer acceso puede exigir una nueva contraseña de al menos seis caracteres. Después continúa a la selección del tipo de POS/terminal.

Si falla:

1. Confirmar que el email corresponde al tenant esperado.
2. Copiar el mensaje exacto y comprobar conectividad hacia ALFA-Admin/Supabase.
3. Si el mensaje dice que no se pudo resolver la licencia, escalar para reprovisionar el tenant en ALFA-Admin.
4. Si el APK indica que no incluye credenciales Supabase, volver a **Elegir tipo de POS**; no editar archivos internos del dispositivo.

No solicitar la contraseña temporal en el ticket.

Fuente verificada: `CLIC-POS/components/ActivationScreen.tsx`.

### 3.3 Activar una caja maestra o adicional

La pantalla **Activar Terminal** permite elegir **Caja Maestra / Independiente**, **Caja Esclava / Adicional** o **Toma de pedidos**. Una caja adicional debe encontrar una Caja Master operativa; puede usar descubrimiento automático o la IP manual de la Master y luego **Conectar y Sincronizar**.

Si no conecta:

1. Confirmar que ambos equipos estén en la misma red local.
2. Confirmar que la IP ingresada sea la de la Caja Master, no la de un KDS o terminal auxiliar.
3. Confirmar que la Master esté abierta y operativa.
4. Copiar el error exacto. Si se requiere autorización administrativa, escalar sin compartir el PIN.

Fuentes verificadas:

- `CLIC-POS/components/TerminalBindingScreen.tsx`
- `CLIC-POS/services/sync/NetworkScanner.ts`
- `CLIC-POS/services/routing/TerminalRouter.ts`

### 3.4 Diagnóstico de sincronización

El diagnóstico distingue, entre otros, `DEVICE_NOT_AUTHORIZED`, `FISCAL_CONFIG_MISSING`, `ERP_MASTER_PULL_FAILED` y `SYNC_COLLECTION_PULL_FAILED`. La acción correcta depende del código:

- `DEVICE_NOT_AUTHORIZED`: escalar para autorizar el dispositivo correcto en ALFA-Admin; no reutilizar el identificador de otra caja.
- `FISCAL_CONFIG_MISSING`: validar serie, rango y configuración fiscal de la terminal antes de emitir fiscalmente.
- Fallo de colección maestra: registrar colección, endpoint, estado HTTP, terminal y hora; reintentar la colección una vez.
- Error de red: confirmar URL/host accesible y conectividad antes de modificar credenciales.

Usar **Copiar diagnóstico** y adjuntarlo al ticket, revisando que no contenga secretos completos.

Fuente verificada: `CLIC-POS/components/SyncErrorDiagnosticModal.tsx`.

### 3.5 Impresoras, tickets, etiquetas y cola offline

En aplicaciones empaquetadas, la impresión usa un bridge nativo para Bluetooth, USB o red. La prueba funcional se realiza en **Ajustes > Hardware**. Si la impresora está fuera de rango o desconectada, la aplicación puede encolar el trabajo y reintentarlo en orden FIFO cuando recupere conexión o foco.

Diagnóstico seguro:

1. Identificar función: ticket, etiqueta o comanda; nombre, conexión y rol de la impresora.
2. Comprobar que aparece en descubrimiento y que está vinculada al rol correcto.
3. Ejecutar una prueba desde **Ajustes > Hardware**.
4. Confirmar si el problema afecta todos los documentos o solo una categoría/área.
5. Reiniciar únicamente la impresora y reintentar; no borrar la cola local.

Fuentes verificadas:

- `CLIC-POS/docs/NATIVE_PRINT_BRIDGE_CONTRACT.md`
- `CLIC-POS/services/printer/OfflinePrintQueueService.ts`
- `CLIC-POS/components/HardwareSettings.tsx`

### 3.6 Cierre de caja Z

La pantalla **Cierre de Caja (Z)** puede exigir conteo físico de denominaciones y que el efectivo cubra el fondo fijo. El flujo genera el Z, intenta imprimir, envía notificaciones configuradas y finaliza el cierre. Un fallo o timeout de impresión no debe interpretarse automáticamente como fallo del cierre.

Ante una incidencia:

1. Confirmar terminal, usuario, hora y si apareció **Cierre Finalizado**.
2. Confirmar si existe el Z en el historial antes de repetirlo.
3. Separar el problema de impresión del problema de persistencia/sincronización.
4. Si la pantalla indica que el proceso seguirá en segundo plano, esperar y revisar el historial antes de iniciar otro cierre.
5. Si no existe Z y la caja sigue abierta, escalar con conteo, balance teórico y mensaje exacto.

Fuente verificada: `CLIC-POS/components/ZReportDashboard.tsx`.

### 3.7 Error al finalizar una venta o pago

Antes de finalizar, el POS valida método de pago, permisos, conexión con la Terminal Master cuando corresponde, crédito del cliente, precios en cero y configuración fiscal. Para soporte:

1. Confirmar si el procesador aprobó o rechazó el pago antes de volver a cobrar.
2. Registrar método, monto, hora, folio y código/mensaje del procesador; ocultar PAN y credenciales.
3. Si indica secuencia fiscal o configuración de terminal, validar esa configuración antes de reintentar.
4. Si el cobro tarda, esperar el resultado y comprobar el historial antes de repetirlo.
5. Escalar cualquier caso con pago aprobado pero venta no confirmada para evitar doble cobro.

Fuente verificada: `CLIC-POS/components/PaymentModal.tsx`.

## 4. ALFA-RMS

### 4.1 Vinculación o reemplazo de una terminal

Las terminales nuevas del ERP pueden tener un `device_id` provisional `DRAFT-*`, que se reemplaza al vincular el POS real. La primera vinculación requiere rol admin o manager; reemplazar un equipo ya vinculado requiere admin. El reemplazo invalida la sesión de sincronización anterior y debe quedar auditado.

Procedimiento de soporte:

1. Confirmar tenant, compañía, sucursal, terminal ERP y dispositivo nuevo.
2. Distinguir primera vinculación de reemplazo.
3. Confirmar que el usuario tenga el rol requerido.
4. Si ya existe un dispositivo, explicar que el anterior dejará de sincronizar como esa terminal.
5. Escalar el reemplazo a un administrador y registrar motivo; no ejecutarlo como respuesta automática.

Fuente verificada: `CLIC-ERP/docs/setup-terminal-api.md`.

### 4.2 Configuración inicial fiscal y operativa de la terminal

La configuración inicial incluye terminal/tienda, almacén predeterminado, series NCF, rangos fiscales y tarifas. Si el POS reporta configuración fiscal incompleta, confirmar la terminal exacta y revisar esos datos en el ERP antes de reintentar una venta fiscal.

No copiar credenciales fiscales al ticket. Solicitar únicamente proveedor, ambiente, RNC parcialmente oculto, serie/rango y mensaje de validación.

Fuentes verificadas:

- `CLIC-ERP/docs/setup-terminal-api.md`
- `CLIC-ERP/server/services/operationalMasters.js`

### 4.3 Configuración del ERP que no llega al POS

El flujo vigente genera únicamente eventos `CONFIG_PUSH_V2`: el ERP prepara snapshots por dominio, encola una referencia idempotente, el POS la descarga y devuelve `ACK APPLIED` o `FAILED`.

Diagnóstico:

1. Confirmar terminal, dominio cambiado y hora de publicación.
2. Revisar si el evento fue encolado y si su ACK es `APPLIED` o `FAILED`.
3. Si falló, registrar código y dominio; no intentar crear eventos legacy `CONFIG_PUSH`.
4. Pedir al POS sincronizar una vez y comprobar la versión/configuración recibida.

Fuente verificada: `CLIC-ERP/docs/config-push-v2-only.md`.

### 4.4 Maestros o documentos que no sincronizan

El bootstrap separa maestros de documentos. El tenant debe alcanzar `READY_FOR_DOCUMENTS`; no deben entrar documentos operativos mientras existan mapeos requeridos pendientes o en conflicto. En modo `ERP_FIRST` también debe existir un perfil activo de terminal.

Solicitar estado del bootstrap, modo (`POS_FIRST` o `ERP_FIRST`), colección afectada y mapeos pendientes. No borrar ni recrear documentos para saltar el gating. Preparar el perfil/mapeo correcto y después reintentar.

Fuente verificada: `CLIC-ERP/docs/bootstrap-master-sync.md`.

### 4.5 Promoción que no aparece en el POS

Para que una promoción se envíe debe estar activa y tener al menos una terminal objetivo; `terminal_ids` vacío se considera configuración incompleta. Además deben cumplirse vigencia, días, horario, objetivo y exclusiones del artículo.

Comprobar en este orden:

1. Estado **Activa** y fechas/días/horario vigentes.
2. La terminal afectada aparece en **Terminales objetivo**.
3. Producto, categoría, grupo o temporada coinciden con el objetivo.
4. El producto no tiene **Excluir de Promociones**.
5. Publicar/sincronizar configuración y probar de nuevo en esa terminal.

Fuentes verificadas:

- `CLIC-ERP/src/pages/Promotions.tsx`
- `CLIC-ERP/server/services/posPromotionsSnapshot.js`
- `CLIC-ERP/src/components/inventory/ProductEditor.tsx`

### 4.6 Errores e-CF o DigiFact

No prometer aceptación de DGII basándose solo en que la venta finalizó. Recopilar folio interno, tipo de e-CF, e-NCF si existe, hora, RNC parcialmente oculto, ambiente y `code/message/infoDetails` devueltos por DigiFact.

Validar:

1. Credenciales y ambiente correctos sin exponer valores.
2. Token vigente; un token expirado puede responder `401`.
3. Tipo de documento, receptor, items y totales.
4. Para consumo electrónico tipo 32, RNC y nombre del comprador cuando el total sea igual o superior a DOP 250,000.
5. En nota de crédito, documento modificado, fecha y reglas posteriores a 30 días.

El e-NCF lo genera DigiFact; no indicar al usuario que lo fabrique o edite manualmente.

Fuente verificada: `CLIC-ERP/docs/digifact-ecf.md`.

### 4.7 Usuarios, roles y permisos

El ERP aplica permisos por módulo y acción; las rutas también pueden exigir roles concretos. Cuando un usuario no ve una pantalla:

1. Confirmar tenant y usuario.
2. Confirmar rol ERP y, si aplica, rol POS.
3. Identificar módulo y acción requeridos, por ejemplo `VIEW`.
4. Comparar con otro usuario solo para diagnosticar, sin copiar permisos de forma indiscriminada.
5. Escalar cambios de rol a un administrador y aplicar el mínimo privilegio necesario.

Fuentes verificadas:

- `CLIC-ERP/src/pages/UsersRolesConfiguration.tsx`
- `CLIC-ERP/src/hooks/usePermissions.ts`
- `CLIC-ERP/server/middlewares/rbac.js`

## 5. ALFA-Admin

### 5.1 Dispositivo no autorizado o cambio de equipo

En **Empresas > Terminales**, ALFA-Admin muestra el dispositivo reportado y el autorizado. Autorizar o reautorizar sustituye el equipo permitido para esa terminal; el anterior deja de sincronizar como esa caja.

Antes de la acción administrativa:

1. Confirmar tenant, terminal canónica y `device_id` reportado por el POS.
2. Revisar el intento rechazado y la versión reportada.
3. Confirmar físicamente qué equipo debe quedar autorizado.
4. Verificar que no se esté asignando el identificador de otra caja.
5. Registrar motivo y requerir confirmación explícita. Copilot puede recomendar/escalar, pero no autorizar autónomamente.

Fuente verificada: `Cloud-Admin/src/pages/Tenants.tsx`.

### 5.2 Perfil ERP incompleto y documentos pendientes

Cuando un documento falla con `ERP_CONTEXT_MISSING`, ALFA-Admin permite **Preparar perfil ALFA-RMS** y luego reintentar el documento. El reintento masivo está bloqueado mientras el perfil siga incompleto.

Orden seguro:

1. Confirmar que terminal canónica y dispositivo autorizado estén definidos.
2. Preparar el perfil ERP.
3. Revisar readiness y corregir almacén/serie/rango/contexto faltante.
4. Reintentar primero un documento reparable.
5. Solo después usar el reintento de pendientes de esa terminal.

Fuente verificada: `Cloud-Admin/src/pages/Tenants.tsx`.

### 5.3 Liberar cupo, reparar enlace o rotar credenciales

Estas son acciones administrativas con impacto operativo:

- **Liberar cupo** libera la caja/equipos asociados y puede impedir que el dispositivo actual continúe operando.
- **Reparar enlace ERP** requiere terminal canónica y dispositivo autorizado actual.
- **Rotar credenciales** invalida credenciales anteriores.

Copilot nunca debe ejecutarlas automáticamente. Debe explicar el impacto, comprobar pendientes, pedir confirmación de un administrador y conservar el motivo/auditoría.

Fuente verificada: `Cloud-Admin/src/pages/Tenants.tsx`.

### 5.4 Registrar, probar y publicar un APK

Los APK nuevos se registran en **Prueba interna**. Borrador, Prueba interna y Beta se descargan únicamente mediante su enlace técnico directo. Solo el estado **Disponible** participa en `/api/pos-apk/latest` y en las comparaciones de versión de terminales; entre los disponibles se elige el mayor `version_code`.

Antes de publicar:

1. Confirmar `versionName` y `versionCode` creciente.
2. Registrar checksum SHA-256, resumen, correcciones, validación y notas de instalación.
3. Validar mediante el enlace técnico y avanzar por Prueba interna o Beta según corresponda.
4. Cambiar a **Disponible** únicamente después de aprobar QA; el sistema actualizará automáticamente la versión vigente.
5. Verificar que el enlace estable `/api/pos-apk/latest` devuelva la versión esperada.

Fuentes verificadas:

- `Cloud-Admin/src/lib/posApkReleases.ts`
- `Cloud-Admin/src/pages/PosApkReleases.tsx`
- `CLIC-POS/docs/RELEASE_SOURCE_OF_TRUTH.md`

## 6. Política de respuesta autónoma

Copilot puede responder sin revisión humana solo cuando:

- el caso coincide con conocimiento activo y verificable;
- la respuesta se limita a diagnóstico o acciones reversibles;
- no involucra pagos aprobados ambiguos, credenciales, fiscalidad incierta, pérdida potencial de datos o cambio de dispositivo;
- la confianza y las políticas del tenant permiten respuesta automática.

Debe crear borrador o escalar cuando haya pagos, documentos fiscales rechazados, datos pendientes, autorización de terminal, rotación de credenciales, liberación de caja, falta de fuente o contradicción entre el ticket y el manual.

## 7. Mantenimiento del manual

- Toda sección nueva debe incluir al menos una ruta fuente verificable.
- Si cambia una pantalla o contrato, actualizar el manual y su migración de conocimiento en el mismo PR.
- Mantener fragmentos pequeños: un síntoma/procedimiento por entrada.
- Ejecutar el smoke test `npm run test:helpdesk-clic-suite-manual`.
- Evaluar periódicamente tickets reales: recuperación correcta, respuesta segura, escalamiento correcto y ausencia de pasos inventados.
