# Gerente de Datos AI v1

El `data-manager-ai-v1` es un handler advisory-only del Runtime 24/7. Lee el
snapshot empresarial materializado por Company OS, identifica problemas de
calidad, frescura, consistencia y cobertura, y devuelve un resultado estricto
al Gerente General.

La topología durable es `general-manager-ai-v3 -> data-manager-ai-v1 ->
general-manager-ai-v3`, en el mismo bus `CompanyOsMessage` y la misma cola con
leases. El Gerente General conserva como máximo una delegación por turno y
puede elegir Systems o Data.

Por protección de datos, el worker de DiegoServer enruta Data exclusivamente a
Ollama en `127.0.0.1` con `qwen3:4b-q4_K_M`, también para el retorno a General y cualquier trabajo
posterior en un caso que haya involucrado a Data. El servidor determina este
linaje desde el historial completo. El cliente OpenAI rechaza esos claims antes
de cualquier salida de datos. El agente no puede escribir tablas empresariales, enviar mensajes
externos, importar, borrar ni corregir datos.

El modelo de este linaje queda fijado por `COMPANY_OS_RUNTIME_LOCAL_LINEAGE_MODEL`
y sólo admite `qwen3:4b-q4_K_M`. La instalación verifica que esté disponible aun
cuando el fallback esté deshabilitado. El fallback histórico de los casos sin
linaje Data conserva `qwen3:14b-q4_K_M`. El schema de generación se clona y
acota explicaciones a 240 caracteres, títulos a 120 y misiones a diez; conserva
los diez hallazgos admitidos por el contrato y todas las fuentes recibidas.
No se trunca una respuesta ya generada. El validador firmado, la confianza,
el presupuesto y el timeout de 120 segundos se mantienen.

La agenda diaria `daily-quality-baseline` se instala mediante una migración
append-only y queda sujeta a los mismos límites de presupuesto, heartbeat,
lease, reintento y revisión humana que los otros handlers.

Data corre diariamente a las 08:15 y General a las 08:30, hora de Nueva York.
La instalación deja una primera ejecución pendiente para cada agente; después
se mantiene la agenda diaria. Sistemas conserva su agenda existente de las 08:00.
Cada tick natural queda registrado con identificador, duración y cantidades
observadas. Un análisis puede finalizar con recomendaciones PLANNED sin exigir
aprobación rutinaria; no ejecuta esas recomendaciones. Las decisiones explícitas,
la baja confianza y los turnos agotados con trabajo sin integrar siguen en revisión.
