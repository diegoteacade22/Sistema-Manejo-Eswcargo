import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.env.APPLY === '1';
const backupDir = join(process.cwd(), 'backups');
const backupPath = join(backupDir, 'stale-neutralized-order-charges-2026-07-18.json');

const corrections = [
  { staleTransactionId: 88905, baselineTransactionId: 466201, clientId: 320, orderNumber: 2398, sourceClientOldId: 147, amount: 585 },
  { staleTransactionId: 88906, baselineTransactionId: 466203, clientId: 253, orderNumber: 2399, sourceClientOldId: 162, amount: 580 },
  { staleTransactionId: 425313, baselineTransactionId: 466204, clientId: 197, orderNumber: 2470, sourceClientOldId: 70, amount: 11537 },
];

async function validateCorrection(correction) {
  const [stale, baseline, sourceOrder] = await Promise.all([
    prisma.transaction.findUnique({ where: { id: correction.staleTransactionId } }),
    prisma.transaction.findUnique({ where: { id: correction.baselineTransactionId } }),
    prisma.order.findUnique({
      where: { order_number: correction.orderNumber },
      include: { client: { select: { old_id: true } } },
    }),
  ]);

  if (!stale || !baseline || !sourceOrder) {
    throw new Error(`Validación incompleta para pedido #${correction.orderNumber}. No se modificó nada.`);
  }
  if (
    stale.clientId !== correction.clientId ||
    stale.type !== 'CARGO' ||
    stale.reference !== String(correction.orderNumber) ||
    Math.abs(stale.amount + correction.amount) > 0.001
  ) {
    throw new Error(`El cargo heredado de #${correction.orderNumber} ya no coincide con la evidencia auditada. No se modificó nada.`);
  }
  if (
    baseline.clientId !== correction.clientId ||
    baseline.type !== 'PAGO' ||
    baseline.reference !== `CC-ZERO-BASELINE-2026:${correction.clientId}` ||
    Math.abs(baseline.amount - correction.amount) > 0.001
  ) {
    throw new Error(`El ajuste compensatorio de #${correction.orderNumber} ya no coincide con la evidencia auditada. No se modificó nada.`);
  }
  if (sourceOrder.client?.old_id !== correction.sourceClientOldId || sourceOrder.total_amount <= correction.amount) {
    throw new Error(`El pedido fuente #${correction.orderNumber} no coincide con el cliente o total auditados. No se modificó nada.`);
  }

  const remainingTransactions = await prisma.transaction.count({
    where: {
      clientId: correction.clientId,
      id: { notIn: [correction.staleTransactionId, correction.baselineTransactionId] },
    },
  });
  if (correction.clientId !== 197 && remainingTransactions !== 0) {
    throw new Error(`La cuenta ${correction.clientId} tiene movimientos adicionales; no se elimina su par histórico automáticamente.`);
  }

  return { stale, baseline, sourceOrder };
}

async function main() {
  const validated = [];
  for (const correction of corrections) {
    validated.push(await validateCorrection(correction));
  }

  const ids = validated.flatMap(({ stale, baseline }) => [stale.id, baseline.id]);
  const net = validated.reduce((sum, { stale, baseline }) => sum + stale.amount + baseline.amount, 0);
  if (Math.abs(net) > 0.001) {
    throw new Error(`Los pares no preservan saldo (neto ${net}). No se modificó nada.`);
  }
  console.log(`${apply ? 'MODO APLICAR' : 'MODO REVISIÓN'}: ${ids.length} movimientos históricos, neto ${net.toFixed(2)}.`);
  if (!apply) return;

  mkdirSync(backupDir, { recursive: true });
  writeFileSync(backupPath, JSON.stringify({ exportedAt: new Date().toISOString(), corrections, validated }, null, 2));
  const deleted = await prisma.transaction.deleteMany({ where: { id: { in: ids } } });
  if (deleted.count !== ids.length) {
    throw new Error(`Eliminación incompleta: ${deleted.count}/${ids.length}. Respaldo: ${backupPath}`);
  }
  console.log(`OK: se eliminaron ${deleted.count} movimientos heredados sin alterar saldos. Respaldo: ${backupPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
