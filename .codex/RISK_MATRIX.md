# Matriz automática — ALFA-ADMIN

Fuente ejecutable: risk-matrix.json; `node .codex/workflow.mjs plan <base-ref>` calcula diff completo desde merge-base hasta HEAD. Siempre exige review, qa, integration y release. Las reglas se acumulan, nunca se reemplazan.

| Dominio | Patrón de archivos (sin distinguir mayúsculas) | Riesgo mínimo | Gates adicionales |
| --- | --- | --- | --- |
| tenant | `(tenant|auth|user|role|permission|licens|provision|activation|terminal|device|supabase/)` | HIGH | security, tenant-integrity, integration |
| apk | `(apk|release)` | HIGH | security, integration |
| api | `(api/|supabase/functions/)` | HIGH | security, tenant-integrity, integration |

Solo Markdown y perfiles TOML declarativos aislados bajo docs/.codex: LOW. Ejecutables y matrices bajo .codex y workflows CI: HIGH + SECURITY. UI fuera de dominios críticos: MEDIUM. Archivo funcional desconocido: HIGH y todos los validadores del producto. Secretos, borrado, reset, claves de firma y migraciones destructivas: CRITICAL. Estos últimos también necesitan security. En plan se debe subir el riesgo cuando la semántica lo justifique; el verificador acepta escalamiento, nunca reducción ni eliminación de gates. Un patrón no demuestra ausencia de impacto: analyst y orchestrator deben revisar dependencias.

No hay LOW automático para ventas, cobros, inventario, precios, impuestos, tickets, sync, offline, database, auth, permissions, tenants o licensing. Evaluación cruzada integration obligatoria; PASS sin contrato afectado exige evidencia del análisis.

Escalamiento del riesgo efectivo a HIGH/CRITICAL añade validadores especializados del producto; CRITICAL siempre añade SECURITY, aunque extraGates esté vacío.
