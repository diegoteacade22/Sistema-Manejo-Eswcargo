ALTER TABLE "PurchaseItem"
ADD COLUMN "allocated_quantity" INTEGER NOT NULL DEFAULT 0;

UPDATE "PurchaseItem" AS item
SET "allocated_quantity" = COALESCE(allocations.total, 0)
FROM (
    SELECT "purchaseItemId", SUM(quantity)::INTEGER AS total
    FROM "PurchaseAllocation"
    GROUP BY "purchaseItemId"
) AS allocations
WHERE allocations."purchaseItemId" = item.id;

ALTER TABLE "PurchaseItem"
ADD CONSTRAINT "PurchaseItem_allocated_quantity_check"
CHECK ("allocated_quantity" >= 0 AND "allocated_quantity" <= quantity);

CREATE TABLE "OrderSubmissionGuard" (
    "id" SERIAL NOT NULL,
    "submissionKey" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderSubmissionGuard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderSubmissionGuard_submissionKey_key"
ON "OrderSubmissionGuard"("submissionKey");

CREATE UNIQUE INDEX "OrderSubmissionGuard_orderId_key"
ON "OrderSubmissionGuard"("orderId");

ALTER TABLE "OrderSubmissionGuard"
ADD CONSTRAINT "OrderSubmissionGuard_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
