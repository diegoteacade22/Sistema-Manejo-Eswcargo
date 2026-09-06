-- Existing append-only audit store carries receipts; no new queue or table.
CREATE INDEX IF NOT EXISTS "CompanyOsAuditEvent_result_work_idx"
  ON public."CompanyOsAuditEvent" ((metadata->>'workItemId'))
  WHERE action = 'RUNTIME_RESULT_RECEIVED';
CREATE INDEX IF NOT EXISTS "CompanyOsAuditEvent_result_recovery_idx"
  ON public."CompanyOsAuditEvent" ((metadata->>'attemptId'), "createdAt")
  WHERE action = 'RUNTIME_RESULT_RECOVERY_ATTEMPT';
