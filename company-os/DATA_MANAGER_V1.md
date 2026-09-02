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
Ollama en `127.0.0.1`; el cliente OpenAI rechaza el claim antes de cualquier
egress. El agente no puede escribir tablas empresariales, enviar mensajes
externos, importar, borrar ni corregir datos.

La agenda diaria `daily-quality-baseline` se instala mediante una migración
append-only y queda sujeta a los mismos límites de presupuesto, heartbeat,
lease, reintento y revisión humana que los otros handlers.
