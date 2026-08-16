-- Permit append-only intent/result rows while keeping one delivered effect per contract key.
DROP INDEX IF EXISTS public."CompanyOsNotificationDelivery_contract_dedupe_key";
CREATE UNIQUE INDEX "CompanyOsNotificationDelivery_contract_dedupe_key"
  ON public."CompanyOsNotificationDelivery"
  ("agentId", channel, "eventType", "evidenceFingerprint", (COALESCE("assetId", '')))
  WHERE "evidenceFingerprint" IS NOT NULL AND status = 'DELIVERED';
