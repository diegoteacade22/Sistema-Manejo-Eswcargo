ALTER TABLE "CompanyAgentMission" ALTER COLUMN "status" SET DEFAULT 'PLANNED';

CREATE TABLE "CompanyAgentRequest" (
    "id" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "actorRef" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "leaseToken" TEXT NOT NULL,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyAgentRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyAgentRequest_leaseToken_key" ON "CompanyAgentRequest"("leaseToken");
CREATE INDEX "CompanyAgentRequest_requestKey_createdAt_idx" ON "CompanyAgentRequest"("requestKey", "createdAt");
CREATE INDEX "CompanyAgentRequest_actorRef_createdAt_idx" ON "CompanyAgentRequest"("actorRef", "createdAt");

ALTER TABLE "CompanyAgentRequest" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CompanyAgentRequest" FROM PUBLIC, anon, authenticated;
