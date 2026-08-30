-- The payment guard already exists in some production databases. Keep this
-- migration replay-safe so clean environments receive the same protection.
CREATE TABLE IF NOT EXISTS "ClientPaymentGuard" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "paymentDate" DATE NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "referenceKey" TEXT NOT NULL,
    "transactionId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientPaymentGuard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClientPaymentGuard_transactionId_key"
ON "ClientPaymentGuard"("transactionId");

CREATE UNIQUE INDEX IF NOT EXISTS "ClientPaymentGuard_clientId_paymentDate_amount_referenceKey_key"
ON "ClientPaymentGuard"("clientId", "paymentDate", "amount", "referenceKey");

ALTER TABLE "ClientPaymentGuard" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ClientPaymentGuard_idempotencyKey_key"
ON "ClientPaymentGuard"("idempotencyKey");

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Order_idempotencyKey_key"
ON "Order"("idempotencyKey");

ALTER TABLE "PurchaseAllocation" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseAllocation_idempotencyKey_key"
ON "PurchaseAllocation"("idempotencyKey");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ClientPaymentGuard_transactionId_fkey'
    ) THEN
        ALTER TABLE "ClientPaymentGuard"
        ADD CONSTRAINT "ClientPaymentGuard_transactionId_fkey"
        FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_order_ledger_reference_unique"
ON "Transaction"("reference")
WHERE "type" = 'CARGO' AND "reference" LIKE 'ORDER:%';

CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_shipment_ledger_reference_canonical_unique"
ON "Transaction"("reference")
WHERE "type" = 'CARGO' AND "reference" LIKE 'SHIPMENT:%';
