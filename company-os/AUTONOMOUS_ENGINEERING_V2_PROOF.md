# Autonomous Engineering V2 — Production Proof Record

**Date:** 2026-08-27

**Activation commit:** `4f44f56d3c1f8187ac81d9d86058149d67484623`

**Result:** `PASS_CONTRACT` + `PASS_A1_LOCAL` + `PASS_A2_DRAFT_PR` + `PASS_DURABLE_V2`

**Continuous operation:** active on DiegoServer through `com.esw.company-os-engineering-v2`

## Verified evidence

- Company OS tests: `108/108 PASS`; dedicated engineering worker tests: `20/20 PASS`.
- TypeScript, targeted ESLint and Next.js production build: `PASS`.
- Production deployment `dpl_4XeM2jPxmLkbTnabTtM2g6tN5YWq`: `READY`, with canonical alias `https://webapp-weld-psi.vercel.app`.
- Supabase uses the dedicated engineering role and grants only the five Company OS engineering tables plus the two pure transition predicates required by their triggers.
- DiegoServer worker readback: LaunchAgent loaded, health `ok=true`, state `IDLE`, autonomy ceiling `A2` and source commit `4f44f56`.
- Operations console: `https://webapp-weld-psi.vercel.app/company-os/operations`.

## Live production exercises

| Gate | Production evidence | Result |
|---|---|---|
| A1 local | Mission `33ae2a65…` completed with a released lease and no remote branch or PR | `PASS_A1_LOCAL` |
| A2 reversible effect | Mission `fa7a303d…` pushed an allowlisted branch and created Draft PR `#60`; no merge or deploy authority | `PASS_A2_DRAFT_PR` |
| Lease recovery | Expired lease produced `LEASE_EXPIRED_RECOVERY`, incremented fencing and completed under a new lease | `PASS` |
| Stale worker fencing | Heartbeat signed with the previous fencing token returned HTTP `409` and persisted `STALE_FENCE_REJECTED` | `PASS` |
| Host crash | Worker process was terminated and LaunchAgent restored it in less than two seconds | `PASS` |
| Emergency stop | A running process was aborted, its lease was revoked and the worker reported `PROCESS_ABORTED_BY_LEASE_CONTROL`; controls were then explicitly restored | `PASS` |
| Revoked/orphan recovery | Mission `da0f7159…` was recovered once, re-leased and completed instead of remaining `RUNNING` without a lease | `PASS` |
| Unknown external outcome | Worker was terminated during `git push`; the branch existed at the expected SHA, reconciliation confirmed the existing effect without blind redispatch, then fencing token `3` completed the mission and confirmed Draft PR `#62` | `PASS` |
| Rollback | Runtime restored the pre-install snapshot, returned healthy, then was reinstalled from activation commit `4f44f56` and returned healthy again | `PASS` |

## Authority boundary

The autonomous worker can edit only mission-allowlisted paths, produce a local commit, push an allowlisted `codex/engineering-v2-*` branch and create a Draft PR in the configured repository. It cannot approve or merge a PR, deploy, access production business data, mutate credentials, send messages, make payments or change its own policy.

GitHub `main` remains protected with required checks, conversation resolution, stale-review dismissal, last-push approval and one human approval. Force pushes and branch deletion are disabled.

The global emergency stop, execution pause, intake pause, repository quarantine and actor disable remain human controls. Missing or stale telemetry renders `UNOBSERVED`/`UNKNOWN`, never green.
