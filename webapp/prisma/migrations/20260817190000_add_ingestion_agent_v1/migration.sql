CREATE TABLE "IngestionRun" (
  "id" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL DEFAULT 'text',
  "rawText" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROCESSING',
  "supplierId" INTEGER,
  "supplierName" TEXT,
  "model" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IngestionItem" (
  "id" TEXT NOT NULL,
  "ingestionRunId" TEXT NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "rawLine" TEXT NOT NULL,
  "productName" TEXT,
  "exactModel" TEXT,
  "capacity" TEXT,
  "color" TEXT,
  "condition" TEXT,
  "region" TEXT,
  "costUsd" DOUBLE PRECISION,
  "availability" TEXT,
  "quantity" INTEGER,
  "observations" TEXT,
  "normalizedProductId" INTEGER,
  "matchConfidence" DOUBLE PRECISION,
  "reviewRequired" BOOLEAN NOT NULL DEFAULT true,
  "reviewReason" TEXT,
  "extractedData" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IngestionItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierOffer" (
  "id" TEXT NOT NULL,
  "ingestionItemId" TEXT NOT NULL,
  "supplierId" INTEGER NOT NULL,
  "productId" INTEGER NOT NULL,
  "costUsd" DOUBLE PRECISION NOT NULL,
  "quantity" INTEGER,
  "availability" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierOffer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IngestionRun_contentHash_createdAt_idx" ON "IngestionRun"("contentHash", "createdAt");
CREATE UNIQUE INDEX "IngestionRun_idempotencyKey_key" ON "IngestionRun"("idempotencyKey");
CREATE INDEX "IngestionRun_receivedAt_idx" ON "IngestionRun"("receivedAt");
CREATE INDEX "IngestionRun_status_idx" ON "IngestionRun"("status");
CREATE UNIQUE INDEX "IngestionItem_ingestionRunId_lineNumber_key" ON "IngestionItem"("ingestionRunId", "lineNumber");
CREATE INDEX "IngestionItem_normalizedProductId_idx" ON "IngestionItem"("normalizedProductId");
CREATE INDEX "IngestionItem_reviewRequired_idx" ON "IngestionItem"("reviewRequired");
CREATE UNIQUE INDEX "SupplierOffer_ingestionItemId_key" ON "SupplierOffer"("ingestionItemId");
CREATE INDEX "SupplierOffer_supplierId_productId_observedAt_idx" ON "SupplierOffer"("supplierId", "productId", "observedAt");

ALTER TABLE "IngestionRun" ADD CONSTRAINT "IngestionRun_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IngestionItem" ADD CONSTRAINT "IngestionItem_ingestionRunId_fkey"
  FOREIGN KEY ("ingestionRunId") REFERENCES "IngestionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IngestionItem" ADD CONSTRAINT "IngestionItem_normalizedProductId_fkey"
  FOREIGN KEY ("normalizedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_ingestionItemId_fkey"
  FOREIGN KEY ("ingestionItemId") REFERENCES "IngestionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IngestionItem" ADD CONSTRAINT "IngestionItem_costUsd_check" CHECK ("costUsd" IS NULL OR "costUsd" > 0);
ALTER TABLE "IngestionItem" ADD CONSTRAINT "IngestionItem_quantity_check" CHECK ("quantity" IS NULL OR "quantity" >= 0);
ALTER TABLE "IngestionItem" ADD CONSTRAINT "IngestionItem_matchConfidence_check" CHECK ("matchConfidence" IS NULL OR ("matchConfidence" >= 0 AND "matchConfidence" <= 1));
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_costUsd_check" CHECK ("costUsd" > 0);
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_quantity_check" CHECK ("quantity" IS NULL OR "quantity" >= 0);
ALTER TABLE "IngestionRun" ADD CONSTRAINT "IngestionRun_status_check" CHECK ("status" IN ('PROCESSING', 'COMPLETED', 'NEEDS_REVIEW', 'FAILED'));

ALTER TABLE "IngestionRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IngestionItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierOffer" ENABLE ROW LEVEL SECURITY;
