CREATE TABLE "PurchasePaymentGuard" (
    "id" SERIAL NOT NULL,
    "purchaseId" INTEGER NOT NULL,
    "paymentDate" DATE NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "referenceKey" TEXT NOT NULL,
    "purchasePaymentId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchasePaymentGuard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchasePaymentGuard_purchasePaymentId_key"
ON "PurchasePaymentGuard"("purchasePaymentId");

CREATE UNIQUE INDEX "PurchasePaymentGuard_purchaseId_paymentDate_amount_referenceKey_key"
ON "PurchasePaymentGuard"("purchaseId", "paymentDate", "amount", "referenceKey");

ALTER TABLE "PurchasePaymentGuard"
ADD CONSTRAINT "PurchasePaymentGuard_purchasePaymentId_fkey"
FOREIGN KEY ("purchasePaymentId") REFERENCES "PurchasePayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Transaction_shipment_charge_reference_unique"
ON "Transaction"("clientId", "reference")
WHERE "type" = 'CARGO' AND "reference" LIKE 'SHIP-%';
