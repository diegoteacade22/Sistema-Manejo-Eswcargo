-- AlterTable
ALTER TABLE "Order" ADD COLUMN "email_sent_at" DATETIME;
ALTER TABLE "Order" ADD COLUMN "paymentMethod" TEXT;
ALTER TABLE "Order" ADD COLUMN "type" TEXT;

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN "email_sent_at" DATETIME;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN "city" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "country" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "state" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "zipCode" TEXT;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "username" TEXT,
    "email" TEXT,
    "password" TEXT,
    "role" TEXT NOT NULL DEFAULT 'CLIENT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Client" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "old_id" INTEGER,
    "name" TEXT NOT NULL,
    "document_id" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "instagram" TEXT,
    "webpage" TEXT,
    "address" TEXT,
    "type" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "city" TEXT,
    "country" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "userId" TEXT,
    CONSTRAINT "Client_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Client" ("address", "createdAt", "document_id", "email", "id", "name", "notes", "old_id", "phone", "type", "updatedAt") SELECT "address", "createdAt", "document_id", "email", "id", "name", "notes", "old_id", "phone", "type", "updatedAt" FROM "Client";
DROP TABLE "Client";
ALTER TABLE "new_Client" RENAME TO "Client";
CREATE UNIQUE INDEX "Client_old_id_key" ON "Client"("old_id");
CREATE UNIQUE INDEX "Client_userId_key" ON "Client"("userId");
CREATE TABLE "new_OrderItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "productId" INTEGER,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" REAL NOT NULL,
    "unit_cost" REAL NOT NULL,
    "shipping_cost" REAL,
    "subtotal" REAL NOT NULL,
    "profit" REAL NOT NULL DEFAULT 0,
    "supplierId" INTEGER,
    "purchase_invoice" TEXT,
    "shipmentId" INTEGER,
    "status" TEXT,
    CONSTRAINT "OrderItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_OrderItem" ("id", "orderId", "productId", "productName", "purchase_invoice", "quantity", "shipping_cost", "subtotal", "supplierId", "unit_cost", "unit_price") SELECT "id", "orderId", "productId", "productName", "purchase_invoice", "quantity", "shipping_cost", "subtotal", "supplierId", "unit_cost", "unit_price" FROM "OrderItem";
DROP TABLE "OrderItem";
ALTER TABLE "new_OrderItem" RENAME TO "OrderItem";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
