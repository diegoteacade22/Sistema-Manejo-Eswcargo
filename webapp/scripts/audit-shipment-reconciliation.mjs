import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function itemKey(orderNumber, shipmentNumber, productName, quantity) {
  return [orderNumber, shipmentNumber, String(productName || '').trim().toUpperCase(), quantity].join('|');
}

function addItem(items, key) {
  items.set(key, (items.get(key) || 0) + 1);
}

async function main() {
  const seedPath = path.join(process.cwd(), 'prisma', 'shipment_reconciliation_seed.json');
  if (!fs.existsSync(seedPath)) {
    throw new Error('Falta el snapshot de asignaciones de envíos.');
  }

  const sourceOrders = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const sourceOrderNumbers = new Set(sourceOrders.map(order => order.order_number));
  const shipmentReferences = new Map();
  for (const order of sourceOrders) {
    for (const item of order.items || []) {
      if (!item.shipment_number) continue;
      const orders = shipmentReferences.get(item.shipment_number) || new Set();
      orders.add(order.order_number);
      shipmentReferences.set(item.shipment_number, orders);
    }
  }
  const referencedShipmentNumbers = [...shipmentReferences.keys()];
  const existingShipments = referencedShipmentNumbers.length
    ? await prisma.shipment.findMany({
        where: { shipment_number: { in: referencedShipmentNumbers } },
        select: { shipment_number: true }
      })
    : [];
  const existingShipmentNumbers = new Set(existingShipments.map(shipment => shipment.shipment_number));
  const missingHeaderShipments = referencedShipmentNumbers.filter(number => !existingShipmentNumbers.has(number));
  if (missingHeaderShipments.length) {
    const detail = missingHeaderShipments
      .map(number => `#${number} (pedidos ${[...(shipmentReferences.get(number) || [])].join(', ')})`)
      .join('; ');
    console.warn(`⚠️ Sin cabecera de envío en planilla/base: ${detail}. Se omitieron de la comparación para no inventar datos.`);
  }

  const expected = new Map();
  for (const order of sourceOrders) {
    for (const item of order.items || []) {
      if (!item.shipment_number) continue;
      if (!existingShipmentNumbers.has(item.shipment_number)) continue;
      addItem(expected, itemKey(
        order.order_number,
        item.shipment_number,
        item.product_name || item.sku || 'Producto sin Nombre',
        item.quantity
      ));
    }
  }

  const actualItems = await prisma.orderItem.findMany({
    where: {
      shipmentId: { not: null },
      order: { order_number: { in: [...sourceOrderNumbers] } },
    },
    include: { order: true, shipment: true, product: true }
  });
  const actual = new Map();
  for (const item of actualItems) {
    if (!item.order?.order_number || !item.shipment?.shipment_number) continue;
    addItem(actual, itemKey(item.order.order_number, item.shipment.shipment_number, item.productName, item.quantity));
  }

  const missing = [...expected.entries()].flatMap(([key, count]) =>
    Array.from({ length: Math.max(0, count - (actual.get(key) || 0)) }, () => key)
  );
  const stale = [...actual.entries()].flatMap(([key, count]) =>
    Array.from({ length: Math.max(0, count - (expected.get(key) || 0)) }, () => key)
  );
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
