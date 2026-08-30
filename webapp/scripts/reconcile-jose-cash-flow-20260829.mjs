import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const clientOldId = 269;
const targetBalance = -5666.5;
const adjustmentReference = 'CASHFLOW-RECONCILIATION-2026:269:JOLO-20260829';
const backupPath = path.resolve('backups/jose-cc-reconciliation-2026-08-29.json');

function total(rows) {
  return rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

async function main() {
  const client = await prisma.client.findUnique({
    where: { old_id: clientOldId },
    select: { id: true, old_id: true, name: true },
  });
  if (!client || client.id !== clientOldId) throw new Error('Precondición fallida: no se encontró exactamente el cliente #269.');

  const autoZeroRows = await prisma.transaction.findMany({
    where: { clientId: client.id, reference: { startsWith: 'AUTO-ZERO:' } },
    select: { id: true, clientId: true, date: true, type: true, amount: true, description: true, reference: true, paymentMethod: true, createdAt: true },
    orderBy: { id: 'asc' },
  });
  if (autoZeroRows.length !== 15 || Math.abs(total(autoZeroRows) - 116030.5) > 0.005) {
    throw new Error(`Precondición fallida: AUTO-ZERO de José cambió (filas=${autoZeroRows.length}, total=${total(autoZeroRows)}).`);
  }

  const existingAdjustment = await prisma.transaction.findFirst({
    where: { clientId: client.id, reference: adjustmentReference },
    select: { id: true, amount: true, type: true },
  });
  if (existingAdjustment) throw new Error('La conciliación de José ya existe; no se repite la operación.');

  const before = await prisma.transaction.aggregate({ where: { clientId: client.id }, _sum: { amount: true }, _count: { _all: true } });
  const balanceAfterRemovingAutoZero = Number(before._sum.amount || 0) - total(autoZeroRows);
  const adjustment = targetBalance - balanceAfterRemovingAutoZero;
  if (Math.abs(adjustment - 56364) > 0.005) throw new Error(`Precondición fallida: ajuste esperado 56364, calculado ${adjustment}.`);

  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, `${JSON.stringify({
    exportedAt: new Date().toISOString(),
    reason: 'Reconciliación de JOLO CC contra saldo final de CASH FLOW 2026',
    sourceSheet: 'JOLO CC',
    sourceFinalBalance: targetBalance,
    client,
    before,
    autoZeroRows,
    autoZeroTotal: total(autoZeroRows),
    balanceAfterRemovingAutoZero,
    adjustment,
  }, null, 2)}\n`, 'utf8');

  const result = await prisma.$transaction(async (tx) => {
    const liveRows = await tx.transaction.findMany({
      where: { clientId: client.id, reference: { startsWith: 'AUTO-ZERO:' } },
      select: { id: true, amount: true },
    });
    if (liveRows.length !== autoZeroRows.length || Math.abs(total(liveRows) - total(autoZeroRows)) > 0.005) {
      throw new Error('Precondición fallida dentro de la transacción: cambiaron los AUTO-ZERO de José.');
    }
    const deleted = await tx.transaction.deleteMany({ where: { id: { in: autoZeroRows.map((row) => row.id) }, clientId: client.id, reference: { startsWith: 'AUTO-ZERO:' } } });
    if (deleted.count !== autoZeroRows.length) throw new Error(`Se esperaban ${autoZeroRows.length} borrados y se hicieron ${deleted.count}.`);
    const created = await tx.transaction.create({
      data: {
        clientId: client.id,
        date: new Date('2026-08-29T12:00:00.000Z'),
        type: 'PAGO',
        amount: adjustment,
        description: 'Conciliación saldo final CASH FLOW 2026 - JOLO CC (fuente: planilla)',
        reference: adjustmentReference,
        paymentMethod: 'AJUSTE',
      },
      select: { id: true, amount: true, reference: true },
    });
    return { deleted: deleted.count, created };
  });

  const after = await prisma.transaction.aggregate({ where: { clientId: client.id }, _sum: { amount: true }, _count: { _all: true } });
  const remainingAutoZero = await prisma.transaction.count({ where: { clientId: client.id, reference: { startsWith: 'AUTO-ZERO:' } } });
  if (Math.abs(Number(after._sum.amount || 0) - targetBalance) > 0.005 || remainingAutoZero !== 0) {
    throw new Error(`Readback fallido: saldo=${after._sum.amount}, AUTO-ZERO restantes=${remainingAutoZero}.`);
  }
  console.log(JSON.stringify({ backupPath, client, sourceSheet: 'JOLO CC', targetBalance, before, balanceAfterRemovingAutoZero, adjustment, result, after, remainingAutoZero }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
