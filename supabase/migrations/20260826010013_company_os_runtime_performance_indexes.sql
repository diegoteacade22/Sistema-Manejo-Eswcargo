-- Cover runtime foreign-key paths used by cancellation, lease recovery, and observability.
CREATE INDEX IF NOT EXISTS "CompanyOsWorkItem_causalMessageId_idx"
  ON public."CompanyOsWorkItem" ("causalMessageId");

CREATE INDEX IF NOT EXISTS "CompanyOsDependencyObservation_caseId_idx"
  ON public."CompanyOsDependencyObservation" ("caseId");

CREATE INDEX IF NOT EXISTS "CompanyOsExecutionAttempt_lease_fk_idx"
  ON public."CompanyOsExecutionAttempt" ("requestId", "leaseToken", "caseId");

CREATE INDEX IF NOT EXISTS "CompanyOsHeartbeat_caseId_idx"
  ON public."CompanyOsHeartbeat" ("caseId");

CREATE INDEX IF NOT EXISTS "CompanyOsHeartbeat_lease_fk_idx"
  ON public."CompanyOsHeartbeat" ("requestId", "leaseToken", "caseId");
