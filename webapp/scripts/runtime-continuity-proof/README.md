# Runtime receipts and mandatory review: local PostgreSQL proof

Run from `webapp`:

```sh
bash scripts/runtime-continuity-proof/run-local-postgres-proof.sh
```

The runner creates an ephemeral PostgreSQL 17 Docker container bound to loopback,
without a volume. The exit trap removes that exact container. All database URLs
are replaced with its local fixture URL. No collector, live worker, model,
production database or authenticated HTTP endpoint is invoked.

The fixture imports the real claim, heartbeat, receive/complete, result status
and reconcile implementations. Prisma supplies the base schema. Repository SQL
supplies runtime transition guards, active-lease uniqueness, continuous-objective
constraints and receipt indexes; an audit append-only trigger uses the repository
rejection function. Negative assertions verify case-transition and audit-mutation
rejections. This is a test superuser, so it does not prove production RLS or ACLs.

Assertions:

- Repeated completion with a `COMPLETED` case leaves one result, usage and attempt.
- A `NEEDS_REVIEW` case also retains an idempotent completed work receipt.
- A receipt committed before lease expiration prevents another claim, recovers
  through the real reconciler, and tolerates another identical completion.
- A continuous case that omits mandatory delegation schedules exactly one
  specialist; its result causes exactly one General integration. All three
  receipts replay without more work or messages.
- Each completed chain releases active leases, locks and slots.
- Both receipt indexes exist and are valid/ready.

## Observed result, 2026-09-06 UTC

All assertions passed on local PostgreSQL 17. Simple cases each retained one
result, one usage row and one attempt. The mandatory-review chain retained three
works/attempts/usages, one delegation, one specialist result and two General
results. Every scenario ended with zero active leases, locks and occupied slots.

This proves fixture behavior against SQL constraints. It does not certify
production deployment, real model quality, external source access or 24/7 uptime.
