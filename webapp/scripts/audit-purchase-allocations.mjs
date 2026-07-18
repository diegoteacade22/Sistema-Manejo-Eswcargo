import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const purchaseItems = await prisma.purchaseItem.findMany({
    select: {
      id: true,
      purchaseId: true,
      quantity: true,
      allocated_quantity: true,
      allocations: { select: { quantity: true } },
    },
    orderBy: { id: 'asc' },
  });

  const mismatches = purchaseItems
    .map((item) => {
      const allocatedFromRows = item.allocations.reduce((total, allocation) => total + allocation.quantity, 0);
      return {
        purchaseItemId: item.id,
        purchaseId: item.purchaseId,
        quantity: item.quantity,
        allocatedCounter: item.allocated_quantity,
        allocatedFromRows,
        pendingQuantity: item.quantity - allocatedFromRows,
      };
    })
    .filter((item) => (
      item.allocatedCounter !== item.allocatedFromRows
      || item.allocatedCounter < 0
      || item.allocatedCounter > item.quantity
      || item.pendingQuantity < 0
    ));

  const report = {
    generatedAt: new Date().toISOString(),
    analyzedPurchaseItems: purchaseItems.length,
    allocatedQuantity: purchaseItems.reduce((total, item) => total + item.allocated_quantity, 0),
    mismatches,
  };

  console.log(JSON.stringify(report, null, 2));
  if (mismatches.length) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
