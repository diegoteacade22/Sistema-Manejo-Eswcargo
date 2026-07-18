ALTER TABLE "AccountEvidence"
ADD COLUMN "transactionReference" TEXT,
ADD COLUMN "transactionDate" DATE,
ADD COLUMN "transactionType" TEXT,
ADD COLUMN "transactionAmount" DOUBLE PRECISION;

ALTER TABLE "AccountEvidence"
DROP CONSTRAINT "AccountEvidence_transactionId_fkey";

ALTER TABLE "AccountEvidence"
ADD CONSTRAINT "AccountEvidence_transactionId_fkey"
FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION validate_account_evidence_transaction_client()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."transactionId" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "Transaction"
        WHERE id = NEW."transactionId" AND "clientId" = NEW."clientId"
    ) THEN
        RAISE EXCEPTION 'AccountEvidence transaction must belong to its client';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AccountEvidence_transaction_client_guard"
BEFORE INSERT OR UPDATE OF "clientId", "transactionId" ON "AccountEvidence"
FOR EACH ROW EXECUTE FUNCTION validate_account_evidence_transaction_client();
