# Prueba de autonomía continua

## Identidad de la prueba

```yaml
goalKey: company-os-continuous-autonomy-proof
goalSpec: company-os-continuous-autonomy-proof@1
source: company-os/AUTONOMOUS_ENGINEERING_V2.md
evidenceHash: 43129aca084edc48c4ed050a3722c62866a418f4c27c767e5d1ddd3cf5d5acc4
```

Esta prueba documenta un ciclo autónomo acotado: el reconciliador comparó estado
deseado durable con estado observado y detectó una brecha sin recibir un prompt
humano. El disparador pertenece al plano de control y no a un modelo ni a un
cron de negocio.

## Contrato de activación y autoridad

```yaml
trigger: desired-state-diff
businessCron: none
llmHeartbeatWake: false
leaseRenewal: safety-only
decisionAuthority: deterministic-orchestrator
llmAuthority: proposal-only
externalEffects: draft-pr-only
```

El orquestador determinístico es la única autoridad de decisión: observa la
brecha, valida misión, hash, política, versión esperada, presupuesto y lease con
fencing vigente. La renovación del lease existe únicamente para seguridad y no
crea trabajo, autoridad ni una señal periódica de negocio. El LLM sólo puede
proponer un cambio dentro de la misión; su salida se trata como datos no
confiables y no confirma resultados.

## Secuencia de evidencia

1. **Autoridad determinística.** El reconciliador leyó el estado deseado durable,
   hizo la comparación con el estado observado y abrió trabajo sólo por la
   diferencia detectada. La ausencia de prompt humano, cron de negocio y wake por
   heartbeat del LLM demuestra que la detección no dependió de una conversación.
2. **Propuesta del LLM.** Un worker recibió una misión y un lease acotados y
   produjo únicamente una propuesta. Las comprobaciones determinísticas aceptan
   o rechazan esa propuesta; el modelo no modifica política, estado canónico ni
   autoridad.
3. **Efecto externo reversible.** Tras superar las comprobaciones y sólo bajo
   autoridad A2 explícita, el único efecto externo admisible es crear o actualizar
   un Draft PR allowlisted. No se autoriza merge, deploy, producción, secretos,
   pagos, datos de negocio ni comunicaciones externas.
4. **Readback.** El efecto no se considera confirmado por la respuesta del worker.
   El reconciliador vuelve a leer el destino, comprueba identidad e idempotencia
   del Draft PR y recién entonces registra confirmación. Un resultado incierto
   queda en reconciliación y bloquea la finalización y los reintentos ciegos.

## Preservación de infraestructura

```yaml
Hostinger: active
AWS: archived
Ollama/Qwen: local
```

La detección y la propuesta no cambian esta asignación: Hostinger sigue activo,
AWS permanece archivado y Ollama/Qwen continúa siendo local. Ninguna de esas
plataformas obtiene autoridad de decisión por participar como infraestructura o
worker.

## Criterio de cierre

La cadena probatoria queda separada y auditable como: diferencia durable
detectada por reconciliación, propuesta no autoritativa, efecto reversible
acotado y confirmación independiente mediante readback. Si falta una observación
fresca, un lease válido o el readback del destino, el ciclo falla cerrado y no
declara éxito.
