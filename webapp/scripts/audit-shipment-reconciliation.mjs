import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function itemKey(orderNumber, shipmentNumber, sku, productName, quantity) {
  return [orderNumber, shipmentNumber, sku || productName || '', quantity].join('|');
}

async function main() {
  const seedPath = path.join(process.cwd(), 'prisma', 'shipment_reconciliation_seed.json');
  if (!fs.existsSync(seedPath)) {
    throw new Error('Falta el snapshot de asignaciones de envíos.');
  }

  const sourceOrders = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const sourceOrderNumbers = new Set(sourceOrders.map(order => order.order_number));
  const expected = new Map();
  for (const order of sourceOrders) {
    for (const item of order.items || []) {
      if (!item.shipment_number) continue;
      expected.set(itemKey(order.order_number, item.shipment_number, item.sku, item.product_name, item.quantity), true);
    }
  }

  const actualItems = await prisma.orderItem.findMany({
    where: { shipmentId: { not: null } },
    include: { order: true, shipment: true, product: true }
  });
  const actual = new Map();
  for (const item of actualItems) {
    if (!item.order?.order_number || !item.shipment?.shipment_number) continue;
    if (!sourceOrderNumbers.has(item.order.order_number)) continue;
    actual.set(itemKey(item.order.order_number, item.shipment.shipment_number, item.product?.sku, item.productName, item.quantity), true);
  }

  const missing = [...expected.keys()].filter(key => !actual.has(key));
  const stale = [...actual.keys()].filter(key => !expected.has(key));
  if (missing.length || stale.length) {
    console.error(`Asignaciones inconsistentes: faltan ${missing.length}, sobran ${stale.length}.`);
    if (missing.length) console.error(`Faltan: ${missing.slice(0, 10).join(', ')}`);
    if (stale.length) console.error(`Sobran: ${stale.slice(0, 10).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  console.log(`✅ Auditoría de asignaciones OK: ${expected.size} líneas de envío coinciden con la planilla.`);
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
