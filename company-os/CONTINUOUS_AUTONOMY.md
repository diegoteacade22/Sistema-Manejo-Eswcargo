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
