import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.env.APPLY === '1';
const oldId = 291;
const expectedShipments = [
  { shipmentNumber: 1189, amount: 43840, date: '2026-06-30' },
  { shipmentNumber: 1193, amount: 44080, date: '2026-07-01' },
  { shipmentNumber: 1197, amount: 44520, date: '2026-07-02' },
  { shipmentNumber: 1199, amount: 33560, date: '2026-07-02' },
  { shipmentNumber: 1200, amount: 24152, date: '2026-07-03' },
  { shipmentNumber: 1208, amount: 40992, date: '2026-07-06' },
];
const backupPath = join(process.cwd(), 'backups', 'jose-jr-shipment-charges-2026-07-18.json');
const EPSILON = 0.005;

function total(rows) {
  return Math.round(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0) * 1000) / 1000;
}

function sameAmount(left, right) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= EPSILON;
}

function snapshot(transaction) {
  return {
    id: transaction.id,
    clientId: transaction.clientId,
    date: transaction.date.toISOString(),
    type: transaction.type,
    amount: Number(transaction.amount),
    description: transaction.description,
    reference: transaction.reference,
    paymentMethod: transaction.paymentMethod,
  };
}

async function buildPlan() {
  const client = await prisma.client.findUnique({ where: { old_id: oldId }, select: { id: true, old_id: true, name: true } });
  if (!client) throw new Error('No existe Jose JR en produccion.');
  const shipments = await prisma.shipment.findMany({
    where: { shipment_number: { in: expectedShipments.map((shipment) => shipment.shipmentNumber) } },
    select: { id: true, shipment_number: true, clientId: true, date_shipped: true, price_total: true, client: { select: { old_id: true, name: true } } },
    orderBy: { shipment_number: 'asc' },
  });
  if (shipments.length !== expectedShipments.length) throw new Error('Falta una cabecera de envio fuente de Jose JR.');
  for (const expected of expectedShipments) {
    const shipment = shipments.find((item) => item.shipment_number === expected.shipmentNumber);
    if (
      !shipment
      || shipment.clientId !== client.id
      || !sameAmount(shipment.price_total, expected.amount)
      || shipment.date_shipped?.toISOString().slice(0, 10) !== expected.date
    ) {
      throw new Error(`El envio #${expected.shipmentNumber} no coincide con CABE_ENVIOS. No se modifico nada.`);
    }
  }
  const transactions = await prisma.transaction.findMany({
    where: { clientId: client.id },
    select: { id: true, clientId: true, date: true, type: true, amount: true, description: true, reference: true, paymentMethod: true },
    orderBy: { id: 'asc' },
  });
  const existingCharges = transactions.filter((transaction) => expectedShipments.some((shipment) => transaction.reference === `SHIP-${shipment.shipmentNumber}`));
  if (existingCharges.length) throw new Error('Ya existe un cargo de envio para Jose JR; se requiere revision manual.');
  const payments = transactions.filter((transaction) => transaction.type === 'PAGO' && transaction.reference === 'Manual');
  if (payments.length !== 2 || !sameAmount(total(payments), total(expectedShipments))) {
    throw new Error('Los pagos existentes no cierran exactamente contra los envios fuente. No se modifico nada.');
  }
  return { client, shipments, transactions, payments, expectedTotal: total(expectedShipments) };
}

function report(plan) {
  return {
    client: `${plan.client.name} (#${plan.client.old_id})`,
    shipmentNumbers: plan.shipments.map((shipment) => shipment.shipment_number),
    paymentTransactionIds: plan.payments.map((payment) => payment.id),
    sourceAmount: plan.expectedTotal,
    balanceBefore: total(plan.transactions),
    balanceAfter: 0,
  };
}

async function applyPlan(plan) {
  mkdirSync(join(process.cwd(), 'backups'), { recursive: true });
  writeFileSync(backupPath, JSON.stringify({ exportedAt: new Date().toISOString(), plan: report(plan), transactions: plan.transactions.map(snapshot), shipments: plan.shipments }, null, 2));
  await prisma.$transaction(async (tx) => {
    const current = await tx.transaction.findMany({
      where: { clientId: plan.client.id },
      select: { id: true, clientId: true, date: true, type: true, amount: true, description: true, reference: true, paymentMethod: true },
      orderBy: { id: 'asc' },
    });
    if (current.length !== plan.transactions.length || current.some((transaction, index) => JSON.stringify(snapshot(transaction)) !== JSON.stringify(snapshot(plan.transactions[index])))) {
      throw new Error('Los movimientos de Jose JR cambiaron durante la revision. Se revirtio la operacion.');
    }
    await tx.transaction.createMany({
      data: plan.shipments.map((shipment) => ({
        clientId: plan.client.id,
        date: shipment.date_shipped,
        type: 'CARGO',
        amount: -Number(shipment.price_total),
        description: `CARGA #${shipment.shipment_number} - Restituido desde CABE_ENVIOS`,
        reference: `SHIP-${shipment.shipment_number}`,
      })),
    });
    const created = await tx.transaction.findMany({
      where: { clientId: plan.client.id, reference: { in: plan.shipments.map((shipment) => `SHIP-${shipment.shipment_number}`) } },
      select: { id: true, amount: true, reference: true },
    });
    if (created.length !== plan.shipments.length) throw new Error('No se crearon todos los cargos de envio. Se revirtio la operacion.');
    const balance = await tx.transaction.aggregate({ where: { clientId: plan.client.id }, _sum: { amount: true } });
    if (!sameAmount(balance._sum.amount || 0, 0)) throw new Error('El saldo final de Jose JR no quedo en cero. Se revirtio la operacion.');
    await tx.accountEvidence.create({
      data: {
        clientId: plan.client.id,
        category: 'SHIPMENT_CHARGE_RECONCILIATION',
        source: 'VENTAS - COMPRAS 2025-2026 / CABE_ENVIOS',
        note: `Se crearon cargos SHIP para envios ${plan.shipments.map((shipment) => `#${shipment.shipment_number}`).join(', ')} por USD ${plan.expectedTotal}. Los pagos manuales ${plan.payments.map((payment) => payment.id).join(', ')} ya sumaban el mismo importe. Respaldo local: ${backupPath}.`,
      },
    });
    const run = await tx.syncRun.create({ data: { scope: 'SHIPMENT_CHARGE_RECONCILIATION', status: 'SUCCESS', finishedAt: new Date(), summary: report(plan) } });
    await tx.syncChange.create({ data: { syncRunId: run.id, entity: 'CLIENT_ACCOUNT', entityKey: '#291', action: 'RECONCILED', reason: 'Se restituyeron seis cargos de envio respaldados por CABE_ENVIOS.' } });
  }, { isolationLevel: 'Serializable' });
}

async function main() {
  const plan = await buildPlan();
  console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'REVIEW', ...report(plan) }, null, 2));
  if (!apply) return;
  await applyPlan(plan);
  console.log(`OK: se restituyeron ${plan.shipments.length} cargos de envio de Jose JR. Respaldo: ${backupPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
