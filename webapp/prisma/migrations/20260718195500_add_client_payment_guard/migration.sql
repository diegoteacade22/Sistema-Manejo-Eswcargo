CREATE TABLE "ClientPaymentGuard" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "paymentDate" DATE NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "referenceKey" TEXT NOT NULL,
    "transactionId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientPaymentGuard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientPaymentGuard_transactionId_key" ON "ClientPaymentGuard"("transactionId");
CREATE UNIQUE INDEX "ClientPaymentGuard_clientId_paymentDate_amount_referenceKey_key" ON "ClientPaymentGuard"("clientId", "paymentDate", "amount", "referenceKey");

ALTER TABLE "ClientPaymentGuard"
ADD CONSTRAINT "ClientPaymentGuard_transactionId_fkey"
FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
