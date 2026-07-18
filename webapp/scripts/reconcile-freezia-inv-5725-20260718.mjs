import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.env.APPLY === '1';
const EPSILON = 0.005;
const target = {
  transactionId: 299420,
  supplierId: 9,
  date: '2026-03-23',
  type: 'CARGO',
  amount: -4380,
  reference: 'INV-5725',
  sourceAmount: 7300,
  sourceDocuments: [
    'https://drive.google.com/file/d/1_YiwahD4SzEncXJOGCDBqYDGwLTGKw-a/view',
    'https://drive.google.com/file/d/1bdh8QTiGqeTU6RcBWAkyh2neDaI1XROX/view',
  ],
};
const backupPath = join(process.cwd(), 'backups', 'freezia-inv-5725-reconciliation-2026-07-18.json');

function sameAmount(left, right) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= EPSILON;
}

function snapshot(transaction) {
  return {
    id: transaction.id,
    supplierId: transaction.supplierId,
    date: transaction.date.toISOString(),
    type: transaction.type,
    amount: Number(transaction.amount),
    description: transaction.description,
    reference: transaction.reference,
    paymentMethod: transaction.paymentMethod,
  };
}

function assertTarget(transaction) {
  if (
    !transaction
    || transaction.supplierId !== target.supplierId
    || transaction.date.toISOString().slice(0, 10) !== target.date
    || transaction.type !== target.type
    || !sameAmount(transaction.amount, target.amount)
    || transaction.reference !== target.reference
  ) {
    throw new Error('El cargo de Freezia no coincide con la evidencia revisada. No se modifico nada.');
  }
}

async function buildPlan() {
  const transaction = await prisma.transaction.findUnique({
    where: { id: target.transactionId },
    include: { supplier: { select: { id: true, name: true } } },
  });
  assertTarget(transaction);
  if (transaction.supplier?.name !== 'FREEZIA TRADING LLC') {
    throw new Error('El proveedor de INV-5725 no coincide. No se modifico nada.');
  }
  const matching = await prisma.transaction.findMany({
    where: { supplierId: target.supplierId, reference: target.reference },
    orderBy: { id: 'asc' },
  });
  const payment = matching.find((row) => row.type === 'PAGO' && sameAmount(row.amount, target.sourceAmount));
  if (!payment || matching.length !== 2) {
    throw new Error('La contrapartida de pago de INV-5725 no coincide exactamente. No se modifico nada.');
  }
  return { transaction, matching, payment };
}

function report(plan) {
  return {
    supplier: plan.transaction.supplier.name,
    reference: target.reference,
    transactionId: target.transactionId,
    amountBefore: Number(plan.transaction.amount),
    amountAfter: -target.sourceAmount,
    paymentTransactionId: plan.payment.id,
    sourceAmount: target.sourceAmount,
    sourceDocuments: target.sourceDocuments,
  };
}

async function applyPlan(plan) {
  mkdirSync(join(process.cwd(), 'backups'), { recursive: true });
  writeFileSync(backupPath, JSON.stringify({
    exportedAt: new Date().toISOString(),
    plan: report(plan),
    transactions: plan.matching.map(snapshot),
  }, null, 2));

  await prisma.$transaction(async (tx) => {
    const current = await tx.transaction.findUnique({ where: { id: target.transactionId } });
    assertTarget(current);
    const currentMatching = await tx.transaction.findMany({
      where: { supplierId: target.supplierId, reference: target.reference },
      orderBy: { id: 'asc' },
    });
    if (
      currentMatching.length !== plan.matching.length
      || currentMatching.some((row, index) => JSON.stringify(snapshot(row)) !== JSON.stringify(snapshot(plan.matching[index])))
    ) {
      throw new Error('Los movimientos de INV-5725 cambiaron durante la revision. Se revirtio la operacion.');
    }
    await tx.transaction.update({
      where: { id: target.transactionId },
      data: {
        amount: -target.sourceAmount,
        description: 'Compra #22 - INV-5725 conciliada con Invoice y transferencia fuente.',
      },
    });
    const finalRows = await tx.transaction.findMany({
      where: { supplierId: target.supplierId, reference: target.reference },
      select: { amount: true },
    });
    const finalBalance = finalRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    if (!sameAmount(finalBalance, 0)) {
      throw new Error('INV-5725 no quedo conciliada. Se revirtio la operacion.');
    }
    const run = await tx.syncRun.create({
      data: {
        scope: 'SUPPLIER_INVOICE_RECONCILIATION',
        status: 'SUCCESS',
        finishedAt: new Date(),
        summary: { ...report(plan), backupPath },
      },
    });
    await tx.syncChange.create({
      data: {
        syncRunId: run.id,
        entity: 'SUPPLIER_LEDGER',
        entityKey: 'FREEZIA:INV-5725',
        action: 'RECONCILED',
        reason: 'Invoice y transferencia Mercury prueban USD 7.300; se corrigio el cargo registrado en USD 4.380.',
      },
    });
  }, { isolationLevel: 'Serializable' });
}

async function main() {
  const plan = await buildPlan();
  console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'REVIEW', ...report(plan) }, null, 2));
  if (!apply) return;
  await applyPlan(plan);
  console.log(`OK: ${target.reference} quedo conciliada. Respaldo: ${backupPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
