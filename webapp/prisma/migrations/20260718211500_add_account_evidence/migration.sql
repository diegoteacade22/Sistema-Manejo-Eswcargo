CREATE TABLE "AccountEvidence" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "transactionId" INTEGER,
    "category" TEXT NOT NULL,
    "note" TEXT,
    "source" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "size" INTEGER,
    "sha256" TEXT,
    "data" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccountEvidence_clientId_createdAt_idx" ON "AccountEvidence"("clientId", "createdAt");
CREATE INDEX "AccountEvidence_transactionId_idx" ON "AccountEvidence"("transactionId");
CREATE INDEX "AccountEvidence_sha256_idx" ON "AccountEvidence"("sha256");

ALTER TABLE "AccountEvidence"
ADD CONSTRAINT "AccountEvidence_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AccountEvidence"
ADD CONSTRAINT "AccountEvidence_transactionId_fkey"
FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
