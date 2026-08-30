import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  createPaymentLedgerEntry,
  upsertOrderLedgerCharge,
  upsertShipmentLedgerCharge,
} from '../lib/client-ledger';

const prisma = new PrismaClient();
const QA_PREFIX = `QA-CC-IDEMP-${Date.now()}-`;
const expectedOldIds = [269, 162, 70];

async function testPaymentRetry(clientId: number) {
  const idempotencyKey = `${QA_PREFIX}${clientId}-${crypto.randomUUID()}`;
  const date = new Date();
  const input = {
    clientId,
    amount: 0.01,
    date,
    paymentMethod: 'QA',
    description: 'QA idempotencia CC',
    reference: `${QA_PREFIX}${clientId}`,
    idempotencyKey,
  };

  const [first, retry] = await Promise.all([
    createPaymentLedgerEntry(prisma, input),
    createPaymentLedgerEntry(prisma, input),
  ]);

  assert.equal(first.id, retry.id, `cliente ${clientId}: el reintento creó otra transacción`);

  const changedPayloadRetry = await createPaymentLedgerEntry(prisma, {
    ...input,
    amount: 999.99,
    description: 'QA reintento con payload distinto',
  });
  assert.equal(
    changedPayloadRetry.id,
    first.id,
    `cliente ${clientId}: la misma clave permitió otro pago con payload distinto`,
  );

  const rows = await prisma.transaction.findMany({
    where: { clientId, reference: input.reference },
    select: { id: true },
  });
  assert.equal(rows.length, 1, `cliente ${clientId}: quedaron ${rows.length} pagos QA`);

  const guards = await prisma.clientPaymentGuard.findMany({
    where: { clientId, referenceKey: idempotencyKey },
    select: { transactionId: true },
  });
  assert.equal(guards.length, 1, `cliente ${clientId}: faltó la guarda única`);
  assert.equal(guards[0].transactionId, first.id);

  return first.id;
}

async function testExistingOperationUpdate(clientId: number) {
  const order = await prisma.order.findFirst({
    where: { clientId, total_amount: { gt: 0 } },
    orderBy: { id: 'desc' },
    select: { id: true, order_number: true, clientId: true, total_amount: true, date: true },
  });

  if (order) {
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        const before = await tx.transaction.findMany({
          where: {
            type: 'CARGO',
            OR: [
              { reference: `ORDER:${order.id}` },
              ...(order.order_number ? [{ reference: `Order #${order.order_number}` }] : []),
            ],
          },
        });
        assert.equal(before.length, 1, `pedido ${order.order_number || order.id}: no tiene un único cargo antes de editar`);
        const updated = await upsertOrderLedgerCharge(tx, order);
        assert.equal(updated.id, before[0].id);
        throw new Error('QA_ROLLBACK');
      }),
      /QA_ROLLBACK/,
    );
  }

  const charge = await prisma.transaction.findFirst({
    where: { clientId, type: 'CARGO', reference: { startsWith: 'SHIP-' } },
    orderBy: { id: 'desc' },
    select: { amount: true, reference: true },
  });
  const shipmentNumber = charge?.reference?.match(/^SHIP-(\d+)/)?.[1];
  const shipment = shipmentNumber
    ? await prisma.shipment.findUnique({ where: { shipment_number: Number(shipmentNumber) }, select: { id: true, shipment_number: true, clientId: true } })
    : null;

  if (shipment?.clientId && charge) {
    const before = await prisma.transaction.findFirst({
      where: { clientId, type: 'CARGO', reference: charge.reference },
      select: { id: true },
    });
    assert.ok(before, `envío ${shipment.shipment_number}: falta el cargo antes de editar`);
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        const updated = await upsertShipmentLedgerCharge(tx, {
          id: shipment.id,
          shipment_number: shipment.shipment_number,
          clientId: shipment.clientId!,
          amount: Math.abs(charge.amount),
        });
        assert.equal(updated.id, before.id);
        throw new Error('QA_ROLLBACK');
      }),
      /QA_ROLLBACK/,
    );
  }
}

async function main() {
  const clients = await prisma.client.findMany({
    where: { old_id: { in: expectedOldIds } },
    select: { id: true, old_id: true, name: true },
    orderBy: { old_id: 'asc' },
  });
  assert.equal(clients.length, expectedOldIds.length, 'No se encontraron los 3 clientes CC de prueba.');

  const qaTransactionIds: number[] = [];
  try {
    for (const client of clients) {
      qaTransactionIds.push(await testPaymentRetry(client.id));
      await testExistingOperationUpdate(client.id);
      console.log(`OK ${client.name} (#${client.old_id}): pago repetido deduplicado y modificación canónica verificada.`);
    }
  } finally {
    if (qaTransactionIds.length) {
      const deleted = await prisma.transaction.deleteMany({ where: { id: { in: qaTransactionIds } } });
      assert.equal(deleted.count, qaTransactionIds.length, 'No se pudo limpiar todo el lote QA.');
    }
  }

  const leftovers = await prisma.transaction.count({ where: { reference: { startsWith: QA_PREFIX } } });
  assert.equal(leftovers, 0, 'Quedaron movimientos QA en la base.');
  console.log(`OK: ${clients.length} clientes CC verificados sin dejar datos de prueba.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
