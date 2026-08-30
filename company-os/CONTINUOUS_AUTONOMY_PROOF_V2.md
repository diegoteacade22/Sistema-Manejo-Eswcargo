# Continuous Autonomy Proof V2

This versioned proof records a bounded continuous-autonomy scenario derived from
`company-os/AUTONOMOUS_ENGINEERING_V2.md`. It is evidence of the control
contract, not a grant of authority to a worker or model.

```yaml
goalKey: company-os-continuous-autonomy-proof
goalVersion: 2
acceptanceRun: autonomous-reconcile-v2
source: company-os/AUTONOMOUS_ENGINEERING_V2.md
evidenceHash: 63f5d0bf27a46020d9fd1d0f4cb9cfc7290ff9ccf71ddb8fba0fb33c1500b6eb

trigger: desired-state-diff
businessCron: none
llmHeartbeatWake: false
leaseRenewal: safety-only

decisionAuthority: deterministic-orchestrator
llmAuthority: proposal-only
externalEffects: draft-pr-only

infrastructure:
  Hostinger: active
  AWS: archived
  Ollama/Qwen: local
```

## Autonomous reconciliation trace

1. The deterministic reconciler compares canonical desired state with a fresh
   observation. It discovers a durable `desired-state-diff`; no human prompt,
   business cron, or LLM heartbeat initiates the run.
2. The orchestrator derives a stable goal identity from `goalKey`,
   `goalVersion`, the versioned evidence hash, and the observed gap. Repeated
   observations resolve to the same idempotency key and mission, so they cannot
   create a second logical effect.
3. The deterministic orchestrator validates policy, expected state version,
   budget, capability lease, expiry, and monotonic fencing token. It alone
   decides whether the mission may advance. Lease renewal exists only to
   preserve safety and cannot invent work or expand authority.
4. The LLM may propose a bounded patch for the allowlisted mission. Its output
   is untrusted data: it cannot approve its proposal, alter policy, renew its
   own authority, confirm an effect, merge, or deploy.
5. Independent deterministic checks accept or reject the proposal. Only an
   accepted, still-current proposal can reach the effect state machine, whose
   maximum external effect is an allowlisted Draft PR.
6. Draft-PR dispatch uses the stable idempotency key and destination readback.
   Replay returns the existing logical effect rather than creating another PR.
   An uncertain result becomes `UNKNOWN_OUTCOME` and is reconciled before any
   retry.
7. The Draft PR is reversible by closing it (and, where authorized, deleting
   its isolated branch). Merge and deployment remain outside autonomous
   authority, so the effect does not modify production.

## Proof assertions

- **No-prompt discovery:** the durable desired-state gap is sufficient input to
  the deterministic reconciliation loop.
- **Deduplication:** one versioned gap maps to one mission and one idempotent
  logical effect across retries, crashes, and replays.
- **Deterministic authority:** state transitions, leases, fencing, policy,
  acceptance, and effect eligibility are decided outside the LLM.
- **Limited model role:** the LLM supplies a proposal only within leased paths
  and verbs; it neither authorizes nor confirms the proposal or effect.
- **Reversible boundary:** the only external effect is a Draft PR, confirmed by
  readback and reversible without merge or deployment.
- **Preserved topology:** Hostinger remains active, AWS remains archived, and
  Ollama/Qwen remains local; reconciliation does not migrate or reactivate
  infrastructure.

This proof claims the bounded contract above only. It does not claim that a
document, worker heartbeat, log, or model statement alone establishes runtime
health or completion.
