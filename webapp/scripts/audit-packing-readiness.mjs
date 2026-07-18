import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();

function loadKnownEmptyPackingExceptions(prismaDir) {
  const exceptionPath = path.join(prismaDir, 'packing-readiness-exceptions.json');
  if (!fs.existsSync(exceptionPath)) return new Map();

  const entries = JSON.parse(fs.readFileSync(exceptionPath, 'utf8'));
  return new Map(
    (entries.knownEmptyOperationalShipments || [])
      .filter((entry) => Number.isInteger(entry?.shipment_number))
      .map((entry) => [entry.shipment_number, entry.reason || 'Sin detalle'])
  );
}

async function main() {
  const auditAll = process.env.PACKING_AUDIT_SCOPE === 'all';
  const sourceShipmentNumbers = new Set();
  const prismaDir = path.join(process.cwd(), 'prisma');
  const knownEmptyPackingExceptions = loadKnownEmptyPackingExceptions(prismaDir);

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
      items: { select: { id: true, order: { select: { clientId: true } } } },
      orders: { select: { clientId: true, items: { select: { id: true, shipmentId: true } } } },
    },
  });

  const getEffectivePackingItems = (shipment) => {
    const itemsById = new Map(shipment.items.map((item) => [item.id, { id: item.id, clientId: item.order?.clientId || null }]));
    for (const order of shipment.orders) {
      const hasExplicitShipmentItems = order.items.some((item) => item.shipmentId);
      for (const item of order.items) {
        if (item.shipmentId === shipment.id || (!hasExplicitShipmentItems && !item.shipmentId)) {
          if (!itemsById.has(item.id)) {
            itemsById.set(item.id, { id: item.id, clientId: order.clientId || null });
          }
        }
      }
    }
    return [...itemsById.values()];
  };

  const shipmentItemCount = (shipment) => getEffectivePackingItems(shipment).length;

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
  const unresolvedClientItems = operationalShipments
    .map((shipment) => ({
      shipment,
      unresolvedCount: getEffectivePackingItems(shipment).filter((item) => !item.clientId).length,
    }))
    .filter((entry) => entry.unresolvedCount > 0);

  if (cargoFallbacks.length) {
    const sample = cargoFallbacks.slice(0, 10).map((shipment) => `#${shipment.shipment_number ?? shipment.id}`).join(', ');
    console.log(`Packing con descripción operativa: ${cargoFallbacks.length}${sample ? ` (${sample}${cargoFallbacks.length > 10 ? ', ...' : ''})` : ''}.`);
  }

  const knownMissingContent = missingContent.filter((shipment) =>
    knownEmptyPackingExceptions.has(shipment.shipment_number)
  );
  const blockingMissingContent = missingContent.filter((shipment) =>
    !knownEmptyPackingExceptions.has(shipment.shipment_number)
  );

  if (knownMissingContent.length) {
    const detail = knownMissingContent
      .map((shipment) => `#${shipment.shipment_number}: ${knownEmptyPackingExceptions.get(shipment.shipment_number)}`)
      .join('; ');
    console.warn(`Packing sin contenido conocido y bloqueado para emisión: ${detail}.`);
  }

  if (blockingMissingContent.length) {
    console.error(`Packing sin contenido imprimible: ${blockingMissingContent.map((shipment) => `#${shipment.shipment_number ?? shipment.id}`).join(', ')}.`);
    process.exitCode = 1;
    return;
  }

  if (unresolvedClientItems.length) {
    const detail = unresolvedClientItems
      .map(({ shipment, unresolvedCount }) => `#${shipment.shipment_number ?? shipment.id} (${unresolvedCount} artículo(s))`)
      .join(', ');
    console.error(`Packing con artículos sin cliente verificable: ${detail}.`);
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
