import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();
const printableStatuses = ['SALIENDO', 'LLEGANDO'];

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
      status: { in: printableStatuses },
      ...(auditAll ? {} : { shipment_number: { in: Array.from(sourceShipmentNumbers) } }),
    },
    select: {
      id: true,
      shipment_number: true,
      item_count: true,
      cargo_description: true,
      _count: { select: { items: true } },
    },
  });

  const missingContent = shipments.filter((shipment) =>
    (shipment.item_count || 0) > 0 &&
    shipment._count.items === 0 &&
    !shipment.cargo_description?.trim()
  );

  const cargoFallbacks = shipments.filter((shipment) =>
    shipment._count.items === 0 && shipment.cargo_description?.trim()
  );

  if (cargoFallbacks.length) {
    console.log(`Packing con descripción operativa: ${cargoFallbacks.map((shipment) => `#${shipment.shipment_number ?? shipment.id}`).join(', ')}.`);
  }

  if (missingContent.length) {
    console.error(`Packing sin contenido imprimible: ${missingContent.map((shipment) => `#${shipment.shipment_number ?? shipment.id}`).join(', ')}.`);
    process.exitCode = 1;
    return;
  }

  console.log(`✅ Auditoría de packing OK: ${shipments.length} envíos imprimibles revisados${auditAll ? '' : ' en esta actualización'}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
