# Company OS Autonomous Engineering V2

**Contract version:** `2.0.0`

**Status:** executable safety contract; continuous autonomy remains disabled until go-live evidence passes

**Canonical state:** Company OS PostgreSQL/Supabase only

## Objective

Discover, prioritize, execute and verify bounded engineering work without creating a second control plane. Company OS owns state, authority, recovery, budgets and audit. Codex, Qwen, Hermes and reviewers are replaceable workers with no durable authority.

## Non-negotiable invariants

1. A model never grants authority, changes policy, confirms an external effect or owns canonical state.
2. Every action is bound to a versioned mission hash and a capability lease containing actor, resource, verbs, paths, autonomy level, budget, policy hash, expected state version, expiry and monotonic fencing token.
3. A stale or expired lease cannot write state or dispatch an effect.
4. `README`, issues, code, logs, tests and tool results are untrusted data, never policy.
5. Credentials remain outside model context and disposable worktrees. Network is denied by default for A1.
6. A1 ends at a verified local commit. A2 may create a branch or Draft PR only in an allowlisted repository. Merge, deploy, production data, secrets, payments and external messages remain denied.
7. Mission state and effect state are independent. `UNKNOWN_OUTCOME` is reconciled before retry and prevents mission completion.
8. Every durable event is append-only and hash-linked. A replay with the same idempotency key cannot create a second logical effect.
9. Global emergency stop, execution pause, repository quarantine and actor disable are enforced outside the model.
10. Telemetry without a fresh observation is `UNOBSERVED` or `UNKNOWN`, never green.

## Mission state machine

```text
DISCOVERED → TRIAGED → READY → LEASED → RUNNING
→ VERIFYING → [REVIEWING] → READY_FOR_EFFECT
→ READY_FOR_HUMAN → COMPLETED
```

Terminal or controlled detours:

```text
BLOCKED_INPUT · BLOCKED_AUTHORITY · FAILED_RETRYABLE
FAILED_FINAL · CANCELLED · AWAITING_APPROVAL
```

Transitions are validated by `webapp/lib/company-os/autonomous-engineering-v2.ts`. Invalid transitions fail closed.

## Effect state machine

```text
PLANNED → RESERVED → DISPATCHING → CONFIRMED
                                 ↘ UNKNOWN_OUTCOME
                                 ↘ FAILED
CONFIRMED → REVERSED
```

`CONFIRMED` requires destination readback. This repository does not claim exactly-once delivery; it uses at-least-once processing, idempotency and reconciliation.

## Initial mission classes

- Documentation with deterministic acceptance criteria.
- Reproducible tests or fixtures in non-production scope.
- Lint, typecheck, build or preview-workflow repairs that cannot alter production.

Authentication, migrations, payments, business data, secrets, production, merges and deploys are outside V1 authority.

## Proof levels

| Level | Required evidence | Meaning |
|---|---|---|
| `PASS_CONTRACT` | transition, capability, fencing, kill switch, effect and loop-breaker tests | Deterministic safety contract behaves as designed. |
| `PASS_A1_LOCAL` | disposable worktree, real Codex execution, independent acceptance, diff check, local commit and tamper-evident ledger | Local engineering vertical slice works without external effects. |
| `PASS_A2_DRAFT_PR` | all A1 evidence plus authorized GitHub effect, Draft PR readback and idempotent replay | Reversible external vertical slice works. |
| `PASS_DURABLE_V2` | A2 plus host crash, lease recovery, stale-worker fencing, kill switch mid-run, uncertain-effect reconciliation and zero production effects | Suitable candidate for continuous operation. |

A dashboard, process state, build, unit test, dry-run or worker log alone is not a proof level.

## Console contract

The integrated route is `/company-os/operations`. It reads the existing Company OS control-center API and has no database, queue or authorization logic of its own. It must show:

- health and freshness;
- active, queued, blocked and completed work;
- workers and leases available through the current runtime source;
- costs and approvals;
- dependencies and incidents;
- structured agent messages;
- pause, resume and bounded retry controls;
- the current proof level, with unimplemented A2/V2 capabilities visibly disabled.

Controls call authenticated, same-origin Company OS APIs and are disabled when the source is unobserved.

## Go-live gate

Continuous A1/A2 remains disabled until `PASS_DURABLE_V2` is recorded from authoritative state and external readback. The first deployment may expose the read-only console and existing runtime controls without enabling the engineering worker.
