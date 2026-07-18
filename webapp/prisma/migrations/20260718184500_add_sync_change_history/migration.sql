-- Bitacora exclusiva de los cambios aplicados por una sincronizacion ESWCARGO.
CREATE TABLE "SyncChange" (
    "id" SERIAL NOT NULL,
    "syncRunId" INTEGER NOT NULL,
    "entity" TEXT NOT NULL,
    "entityKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SyncChange_syncRunId_idx" ON "SyncChange"("syncRunId");
CREATE INDEX "SyncChange_entity_entityKey_idx" ON "SyncChange"("entity", "entityKey");
CREATE INDEX "SyncChange_action_idx" ON "SyncChange"("action");

ALTER TABLE "SyncChange"
ADD CONSTRAINT "SyncChange_syncRunId_fkey"
FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
