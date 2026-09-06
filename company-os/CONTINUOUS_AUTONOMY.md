# Company OS — Continuous Autonomy V1

## Canonical topology

- Hostinger remains the active remote host.
- AWS remains archived and is not a runtime target.
- DiegoServer runs the deterministic supervisors and local Ollama/Qwen.
- Supabase is the durable control plane for goals, observations, missions,
  events, leases, effects and readback.

## Operating contract

Continuous autonomy is a desired-state controller, not an unbounded chat loop.
A human-authored, versioned `GoalSpec` defines the objective, source document,
allowed repository and paths, acceptance criteria, budget, time limit and
maximum autonomy. The signed worker can observe the repository and append a
signal, but it cannot create or expand its own GoalSpec.

The deterministic reconciler performs:

1. Load active GoalSpecs from the durable control plane.
2. Verify the source-document hash at the observed base commit.
3. Compare the structured desired state with repository readback.
4. If already satisfied, append a quiescent observation and spend no model
   tokens.
5. If unmet, materialize one idempotent Engineering V2 mission.
6. Let the bounded worker propose and verify changes inside its capability
   lease.
7. At A2, permit only a pushed branch and a Draft PR with destination readback.

The LLM never owns transitions, authorization, budgets, idempotency, leases,
termination or success. It proposes a bounded implementation inside the
contract selected by the controller.

## Continuous-objective reconciliation contract

The existing continuous-objective planner is a desired-state reconciler over
the shared V3 queue. Each run writes a durable readback on the objective:
`QUIESCENT`, `PENDING`, `STALE`, `AWAITING_HUMAN`, `BLOCKED_FINAL`, `EXPIRED`,
or `INVALID`; the generated-unit count; and, when that count is zero, the
explicit reason. `OBJECTIVE_RECONCILED` records the run id, observed and
excluded counts, and `modelCalls: 0`.

Only allowlisted project metadata with an observed `IDLE` source status can
produce a planned unit. `NOT_LOADED`, `UNKNOWN`, active, closed, personal,
blocked, or human-decision sources are excluded. The planner deduplicates by
coherent root conversation and the database enforces one unit per
objective/version/root. External sources remain read-only; unavailable
connectors produce an auditable blocked unit without materializing a case.

The planner and runner continue to use the existing V3 cases, queue, leases,
locks, budgets and fencing. Continuous-objective cases are analysis-only and
cannot authorize source edits, deploys, merges, purchases, messages or other
irreversible effects. The engineering GoalSpec plane remains the authority
for A1/A2 transitions and its existing readback gates.

## Contrato de continuidad y cierre verificable

El proceso permanece disponible y busca trabajo autorizado mientras el equipo
está encendido y tiene conexión. Continúa dentro de la vigencia, los permisos,
los turnos y el presupuesto del objetivo. Estar `IDLE` o responder al chequeo
de salud demuestra disponibilidad; no demuestra que un objetivo esté cumplido.

Hay tres recorridos distintos en el mismo control plane:

- **Objetivos continuos V3:** observan fuentes autorizadas y generan análisis
  en la cola existente. No resuelven ni modifican esas fuentes.
- **Tareas Codex A1:** ejecutan pasos autorizados y pueden pedir `CONTINUE`.
  La continuación conserva identidad, huella y autorización. Una fuente
  modificada, un bloqueo humano, un archivo o un cambio de política suspenden
  esa elegibilidad.
- **Engineering GoalSpec:** aplica los criterios y límites versionados de
  ingeniería. Los permisos de este recorrido no se transfieren a los otros.

### Revisión y evidencia del análisis

Si el contexto persistido exige un especialista, el cierre requiere una
delegación al agente exacto, un intento exitoso y un resultado entregado con
confianza suficiente y referencias. Después, General debe integrar ese
resultado mediante su identificador causal y citar sus referencias. El servidor
encola la revisión omitida o la integración faltante, dentro de los turnos
disponibles. Reutiliza una respuesta entregada y no repite el especialista.

`VERIFIED` sólo certifica el análisis interno de una línea base de sistemas o
datos que pasa la comprobación de contenido. Exige referencias citadas,
contexto coincidente con objetivo, versión, unidad y huella, un mismo snapshot
y fecha de lectura, y contenido leído como máximo 30 minutos antes del
resultado. El servidor guarda el criterio de verificación y la huella del
contenido. Las observaciones de metadata externa permanecen `ANALYZED`.
Siempre se conserva `verificationScope=ANALYSIS_ONLY` y
`sourceResolved=false`: los criterios empresariales de la fuente no se
certifican mediante esta comprobación.

### Entrega, continuación y presupuesto

`deliveryVerified` significa que la respuesta quedó entregada.
`continuationVerified` significa que el paso siguiente quedó persistido y
puede volver a reclamarse. Ninguno significa que el objetivo esté cumplido.
Un marcador del modelo o un resumen no producen `DONE` automáticamente;
`verifiedCompletion` requiere una verificación de aceptación independiente.

Cuando falta presupuesto, el servidor registra el aplazamiento y mantiene la
reserva en `QUEUED`, con `availableAt` en el próximo reinicio aplicable. No
consume otra llamada al modelo durante la espera. Si una reserva supera por
sí sola el límite, queda `BLOCKED`. Los límites no se amplían para conseguir
un cierre. La vigencia del objetivo tampoco se renueva por decisión del modelo.

El contrato General 3.1.5 usa un límite diario de 192.000 tokens y conserva el
límite mensual de 1.000.000. Este cambio fue autorizado por Diego después de
confirmar capacidad disponible. No cambia el tamaño de cada intento, la
concurrencia ni los permisos; el uso local y remoto se sigue contabilizando.

### Prueba de funcionamiento continuo

La validación operativa requiere un caso real generado, reclamado, ejecutado y
con resultado persistido y releído. Después deben observarse dos ciclos
naturales del supervisor, sin duplicar ese trabajo y sin leases retenidos.
Una prueba local o un reinicio saludable no sustituyen esa comprobación.

## Activation semantics

No periodic prompt or business cron wakes the model. The worker reconciles on
startup, after a mission reaches a terminal state, and while its durable intake
loop is quiescent. Adaptive backoff avoids repeated model calls and resets when
work is materialized. Internal lease renewal remains mandatory during long
actions because it fences stale workers and enables crash recovery; it is not a
prompt or a source of goals.

## Research basis

- Kubernetes controllers: current state is reconciled toward desired state.
- ReAct: planning must alternate with tool observations.
- Voyager: verified execution precedes retention of a capability.
- Reflexion and Generative Agents: episodic evidence and reflections are
  derivative memory, not canonical authority.
- Durable Task and Temporal: durable events, idempotency, leases and liveness
  are required for recovery even when no human prompt exists.
- ToolEmu: least privilege and adversarial testing are required before raising
  autonomy.

## V1 boundary

This version is autonomous up to A2. It cannot merge, deploy, rotate secrets,
send messages, write commercial data, buy, pay or delete. Those effects require
a separately versioned policy and explicit approval evidence.
