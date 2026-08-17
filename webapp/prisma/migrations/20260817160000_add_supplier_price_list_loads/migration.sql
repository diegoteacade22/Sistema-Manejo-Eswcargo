CREATE TABLE "SupplierPriceListLoad" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'IMPORTSYS',
  "supplierName" TEXT,
  "sourceName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'LOADED',
  "rowsAnalyzed" INTEGER NOT NULL,
  "uniqueProductsAnalyzed" INTEGER NOT NULL,
  "probableCount" INTEGER NOT NULL DEFAULT 0,
  "possibleCount" INTEGER NOT NULL DEFAULT 0,
  "manualReviewCount" INTEGER NOT NULL DEFAULT 0,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierPriceListLoad_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierPriceListLoad_receivedAt_idx" ON "SupplierPriceListLoad"("receivedAt");
CREATE INDEX "SupplierPriceListLoad_supplierName_receivedAt_idx" ON "SupplierPriceListLoad"("supplierName", "receivedAt");
ALTER TABLE "SupplierPriceListLoad" ADD CONSTRAINT "SupplierPriceListLoad_status_check" CHECK ("status" IN ('LOADED', 'FAILED'));
ALTER TABLE "SupplierPriceListLoad" ADD CONSTRAINT "SupplierPriceListLoad_rows_check" CHECK ("rowsAnalyzed" >= 0 AND "uniqueProductsAnalyzed" >= 0 AND "probableCount" >= 0 AND "possibleCount" >= 0 AND "manualReviewCount" >= 0);
