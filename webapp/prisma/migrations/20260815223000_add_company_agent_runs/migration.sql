CREATE TABLE "CompanyAgentRun" (
    "id" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "objectiveHash" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "responseId" TEXT,
    "status" TEXT NOT NULL,
    "authMode" TEXT NOT NULL,
    "actorRef" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "brief" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyAgentRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyAgentRun_requestKey_key" ON "CompanyAgentRun"("requestKey");
CREATE INDEX "CompanyAgentRun_createdAt_idx" ON "CompanyAgentRun"("createdAt");
CREATE INDEX "CompanyAgentRun_businessDate_idx" ON "CompanyAgentRun"("businessDate");
CREATE INDEX "CompanyAgentRun_snapshotId_idx" ON "CompanyAgentRun"("snapshotId");
CREATE INDEX "CompanyAgentRun_actorRef_createdAt_idx" ON "CompanyAgentRun"("actorRef", "createdAt");

CREATE TABLE "CompanyAgentMission" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "mission" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "expectedOutput" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyAgentMission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyAgentMission_runId_idx" ON "CompanyAgentMission"("runId");
CREATE INDEX "CompanyAgentMission_status_createdAt_idx" ON "CompanyAgentMission"("status", "createdAt");
ALTER TABLE "CompanyAgentMission" ADD CONSTRAINT "CompanyAgentMission_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CompanyAgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- These audit tables are server-only. They must never be reachable through the
-- Supabase Data API roles even if the public schema is exposed.
ALTER TABLE "CompanyAgentRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyAgentMission" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CompanyAgentRun" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE "CompanyAgentMission" FROM PUBLIC, anon, authenticated;

CREATE FUNCTION prevent_company_agent_audit_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Company OS audit rows are append-only';
END;
$$;

REVOKE ALL ON FUNCTION prevent_company_agent_audit_mutation() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER "CompanyAgentRun_append_only"
BEFORE UPDATE OR DELETE ON "CompanyAgentRun"
FOR EACH ROW EXECUTE FUNCTION prevent_company_agent_audit_mutation();

CREATE TRIGGER "CompanyAgentMission_append_only"
BEFORE UPDATE OR DELETE ON "CompanyAgentMission"
FOR EACH ROW EXECUTE FUNCTION prevent_company_agent_audit_mutation();
