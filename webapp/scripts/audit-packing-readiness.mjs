import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();
async function main() {
  const auditAll = process.env.PACKING_AUDIT_SCOPE === 'all';
  const sourceShipmentNumbers = new Set();
  const prismaDir = path.join(process.cwd(), 'prisma');

  for (const fileName of ['shipments_seed.json', 'shipment_reconciliation_seed.json']) {
    const seedPath = path.join(prismaDir, fileName);
    if (!fs.existsSync(seedPath)) continue;
    const records = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    for (const record of records) {
      if (record.shipment_number) sourceShipmentNumbers.add(record.shipment_number);
      for (const item of record.items || []) {
        if (item.shipment_number) sourceShipmentNumbers.add(item.shipment_number);
      }
    }
  }

  if (!auditAll && sourceShipmentNumbers.size === 0) {
    console.log('✅ Auditoría de packing omitida: la actualización no contiene envíos afectados.');
    return;
  }

  const shipments = await prisma.shipment.findMany({
    where: {
      ...(auditAll ? {} : { shipment_number: { in: Array.from(sourceShipmentNumbers) } }),
    },
    select: {
      id: true,
      shipment_number: true,
      status: true,
      item_count: true,
      cargo_description: true,
      items: { select: { id: true } },
      orders: { select: { items: { select: { id: true, shipmentId: true } } } },
    },
  });

  const shipmentItemCount = (shipment) => {
    const itemIds = new Set(shipment.items.map((item) => item.id));
    for (const order of shipment.orders) {
      const hasExplicitShipmentItems = order.items.some((item) => item.shipmentId);
      for (const item of order.items) {
        if (item.shipmentId === shipment.id || (!hasExplicitShipmentItems && !item.shipmentId)) {
          itemIds.add(item.id);
        }
      }
    }
    return itemIds.size;
  };

  const isOperationalPacking = (shipment) => {
    const status = String(shipment.status || '').trim().toUpperCase();
    return !['', 'COMPRAR', '100', '200', '#REF!'].includes(status);
  };
  const operationalShipments = shipments.filter(isOperationalPacking);

  const missingContent = operationalShipments.filter((shipment) =>
    (shipment.item_count || 0) > 0 &&
    shipmentItemCount(shipment) === 0 &&
    !shipment.cargo_description?.trim()
  );

  const cargoFallbacks = operationalShipments.filter((shipment) =>
    shipmentItemCount(shipment) === 0 && shipment.cargo_description?.trim()
  );

  if (cargoFallbacks.length) {
    const sample = cargoFallbacks.slice(0, 10).map((shipment) => `#${shipment.shipment_number ?? shipment.id}`).join(', ');
    console.log(`Packing con descripción operativa: ${cargoFallbacks.length}${sample ? ` (${sample}${cargoFallbacks.length > 10 ? ', ...' : ''})` : ''}.`);
  }

  if (missingContent.length) {
    console.error(`Packing sin contenido imprimible: ${missingContent.map((shipment) => `#${shipment.shipment_number ?? shipment.id}`).join(', ')}.`);
    process.exitCode = 1;
    return;
  }

  console.log(`✅ Auditoría de packing OK: ${operationalShipments.length} envíos operativos revisados${auditAll ? '' : ' en esta actualización'}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
