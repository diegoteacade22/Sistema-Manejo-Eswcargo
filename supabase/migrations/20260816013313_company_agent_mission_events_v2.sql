-- Human-only Company OS control-plane events. Business tables remain read-only.
CREATE TABLE "CompanyAgentMissionEvent" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "actorRef" TEXT NOT NULL,
    "authMode" TEXT NOT NULL,
    "reason" TEXT,
    "deferUntil" TIMESTAMP(3),
    "revisionPayload" JSONB,
    "incorrectData" JSONB,
    "expectedHead" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "previousHash" TEXT,
    "eventHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyAgentMissionEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CompanyAgentMissionEvent_missionId_fkey"
      FOREIGN KEY ("missionId") REFERENCES "CompanyAgentMission"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CompanyAgentMissionEvent_sequence_check"
      CHECK ("sequence" >= 1 AND "expectedHead" >= 0 AND "sequence" = "expectedHead" + 1),
    CONSTRAINT "CompanyAgentMissionEvent_action_check"
      CHECK ("action" IN ('APPROVE', 'REJECT', 'EDIT', 'POSTPONE', 'MARK_INCORRECT')),
    CONSTRAINT "CompanyAgentMissionEvent_from_status_check"
      CHECK ("fromStatus" IN ('PLANNED', 'APPROVED', 'REJECTED', 'RUNNING', 'BLOCKED', 'REVIEW', 'DONE')),
    CONSTRAINT "CompanyAgentMissionEvent_to_status_check"
      CHECK ("toStatus" IN ('PLANNED', 'APPROVED', 'REJECTED', 'RUNNING', 'BLOCKED', 'REVIEW', 'DONE')),
    CONSTRAINT "CompanyAgentMissionEvent_human_auth_check"
      CHECK ("authMode" = 'admin-session' AND length("actorRef") BETWEEN 16 AND 128),
    CONSTRAINT "CompanyAgentMissionEvent_idempotency_key_check"
      CHECK (length("idempotencyKey") BETWEEN 8 AND 128),
    CONSTRAINT "CompanyAgentMissionEvent_hash_format_check"
      CHECK (
        "requestHash" ~ '^[0-9a-f]{64}$'
        AND "eventHash" ~ '^[0-9a-f]{64}$'
        AND ("previousHash" IS NULL OR "previousHash" ~ '^[0-9a-f]{64}$')
      ),
    CONSTRAINT "CompanyAgentMissionEvent_chain_head_check"
      CHECK (("sequence" = 1 AND "previousHash" IS NULL) OR ("sequence" > 1 AND "previousHash" IS NOT NULL)),
    CONSTRAINT "CompanyAgentMissionEvent_transition_check"
      CHECK (
        ("action" = 'APPROVE' AND "fromStatus" IN ('PLANNED', 'REVIEW') AND "toStatus" = 'APPROVED')
        OR ("action" = 'REJECT' AND "fromStatus" IN ('PLANNED', 'APPROVED', 'BLOCKED', 'REVIEW') AND "toStatus" = 'REJECTED')
        OR ("action" = 'EDIT' AND "fromStatus" IN ('PLANNED', 'APPROVED', 'BLOCKED', 'REVIEW') AND "toStatus" = 'REVIEW')
        OR ("action" = 'POSTPONE' AND "fromStatus" IN ('PLANNED', 'APPROVED', 'BLOCKED', 'REVIEW') AND "toStatus" = 'PLANNED')
        OR ("action" = 'MARK_INCORRECT' AND "fromStatus" IN ('PLANNED', 'APPROVED', 'REVIEW') AND "toStatus" = 'BLOCKED')
      ),
    CONSTRAINT "CompanyAgentMissionEvent_payload_check"
      CHECK (
        ("action" = 'REJECT' AND length(btrim("reason")) > 0 AND "revisionPayload" IS NULL AND "incorrectData" IS NULL AND "deferUntil" IS NULL)
        OR ("action" = 'EDIT' AND "revisionPayload" IS NOT NULL AND "incorrectData" IS NULL AND "deferUntil" IS NULL)
        OR ("action" = 'POSTPONE' AND "deferUntil" IS NOT NULL AND "deferUntil" > "createdAt" AND "revisionPayload" IS NULL AND "incorrectData" IS NULL)
        OR ("action" = 'MARK_INCORRECT' AND length(btrim("reason")) > 0 AND "incorrectData" IS NOT NULL AND "revisionPayload" IS NULL AND "deferUntil" IS NULL)
        OR ("action" = 'APPROVE' AND "revisionPayload" IS NULL AND "incorrectData" IS NULL AND "deferUntil" IS NULL)
      )
);

ALTER TABLE "CompanyAgentMission"
  ADD CONSTRAINT "CompanyAgentMission_status_check"
  CHECK ("status" IN ('PLANNED', 'APPROVED', 'REJECTED', 'RUNNING', 'BLOCKED', 'REVIEW', 'DONE'));

CREATE UNIQUE INDEX "CompanyAgentMissionEvent_missionId_sequence_key"
  ON "CompanyAgentMissionEvent"("missionId", "sequence");
CREATE UNIQUE INDEX "CompanyAgentMissionEvent_missionId_idempotencyKey_key"
  ON "CompanyAgentMissionEvent"("missionId", "idempotencyKey");
CREATE UNIQUE INDEX "CompanyAgentMissionEvent_eventHash_key"
  ON "CompanyAgentMissionEvent"("eventHash");
CREATE INDEX "CompanyAgentMissionEvent_missionId_createdAt_idx"
  ON "CompanyAgentMissionEvent"("missionId", "createdAt");
CREATE INDEX "CompanyAgentMissionEvent_toStatus_createdAt_idx"
  ON "CompanyAgentMissionEvent"("toStatus", "createdAt");

ALTER TABLE "CompanyAgentMissionEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CompanyAgentMissionEvent" FROM PUBLIC, anon, authenticated;

-- Reuse the dedicated Company OS connection. It retains SELECT-only access to
-- business tables and receives only the minimum control-plane INSERT below.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'company_os_reader') THEN
    GRANT SELECT ON "CompanyAgentRun", "CompanyAgentMission", "CompanyAgentMissionEvent"
      TO company_os_reader;
    GRANT INSERT ON "CompanyAgentMissionEvent" TO company_os_reader;

    EXECUTE 'CREATE POLICY "CompanyAgentRun_company_os_reader_select" ON "CompanyAgentRun" FOR SELECT TO company_os_reader USING (true)';
    EXECUTE 'CREATE POLICY "CompanyAgentMission_company_os_reader_select" ON "CompanyAgentMission" FOR SELECT TO company_os_reader USING (true)';
    EXECUTE 'CREATE POLICY "CompanyAgentMissionEvent_company_os_reader_select" ON "CompanyAgentMissionEvent" FOR SELECT TO company_os_reader USING (true)';
    EXECUTE 'CREATE POLICY "CompanyAgentMissionEvent_company_os_reader_insert" ON "CompanyAgentMissionEvent" FOR INSERT TO company_os_reader WITH CHECK ("authMode" = ''admin-session'')';
  END IF;
END
$$;

CREATE TRIGGER "CompanyAgentMissionEvent_append_only"
BEFORE UPDATE OR DELETE ON "CompanyAgentMissionEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_company_agent_audit_mutation();

COMMENT ON TABLE "CompanyAgentMissionEvent" IS
  'Append-only human decisions for Company OS. Never executes or mutates business operations.';
