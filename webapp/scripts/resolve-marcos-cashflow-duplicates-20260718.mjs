import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { reconcileCashflowRows } from '../lib/cashflow-reconciliation.mjs';

const prisma = new PrismaClient();
const apply = process.env.APPLY === '1';
const oldId = 162;
const rawPrefix = 'CASHFLOW-RAW-2026:MARCOS_CC:';
const adjustmentReference = 'CASHFLOW-RECONCILIATION-2026:162';
const backupPath = join(process.cwd(), 'backups', 'marcos-cashflow-duplicates-2026-07-18.json');
const EPSILON = 0.005;

function sourcePath() {
  const index = process.argv.indexOf('--source');
  return index >= 0 ? process.argv[index + 1] : process.env.CASHFLOW_RAW_EXPORT_PATH;
}

function total(rows) {
  return Math.round(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0) * 1000) / 1000;
}

function sameAmount(left, right) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= EPSILON;
}

function dateKey(value) {
  return new Date(value).toISOString();
}

function snapshot(transaction) {
  return {
    id: transaction.id,
    clientId: transaction.clientId,
    date: dateKey(transaction.date),
    type: transaction.type,
    amount: Number(transaction.amount),
    description: transaction.description,
    reference: transaction.reference,
    paymentMethod: transaction.paymentMethod,
  };
}

function sameSnapshot(current, expected) {
  return current.id === expected.id
    && current.clientId === expected.clientId
    && dateKey(current.date) === expected.date
    && current.type === expected.type
    && sameAmount(current.amount, expected.amount)
    && current.description === expected.description
    && current.reference === expected.reference
    && current.paymentMethod === expected.paymentMethod;
}

function findSource(sourceRows, reference, type, amount) {
  const row = sourceRows.find((item) => item.reference === reference && item.type === type && sameAmount(item.amount, amount));
  if (!row) throw new Error(`No se encontro la evidencia fuente ${reference}.`);
  return row;
}

async function buildPlan(input) {
  const rows = JSON.parse(await readFile(input, 'utf8'));
  const sourceRows = rows.filter((row) => row.oldId === oldId);
  const client = await prisma.client.findUnique({ where: { old_id: oldId }, select: { id: true, old_id: true, name: true } });
  if (!client || sourceRows.length === 0) throw new Error('No se encontro la cuenta o la fuente de Marcos.');

  const sourceEvidence = [
    findSource(sourceRows, `${rawPrefix}375`, 'PAGO', 15000),
    findSource(sourceRows, `${rawPrefix}376`, 'CARGO', -300),
    findSource(sourceRows, `${rawPrefix}399`, 'PAGO', 15000),
    findSource(sourceRows, `${rawPrefix}400`, 'CARGO', -300),
    findSource(sourceRows, `${rawPrefix}387`, 'CARGO', -9120),
  ];
  const transactions = await prisma.transaction.findMany({
    where: { clientId: client.id },
    select: { id: true, clientId: true, date: true, type: true, amount: true, description: true, reference: true, paymentMethod: true },
    orderBy: { id: 'asc' },
  });
  const raw = transactions.filter((transaction) => String(transaction.reference || '').startsWith(rawPrefix));
  const reconciliation = reconcileCashflowRows(sourceRows, raw);
  if (reconciliation.exactRows !== sourceRows.length || reconciliation.oppositeSignRows || reconciliation.changedRows || reconciliation.missingRows || reconciliation.extraRows) {
    throw new Error('Las filas RAW de Marcos no coinciden exactamente con Cash Flow.');
  }

  const remove = transactions.filter((transaction) => [1111498, 1173202, 1173203].includes(transaction.id));
  if (remove.length !== 3) throw new Error('No estan presentes los tres movimientos duplicados esperados.');
  const expected = new Map([
    [1111498, { type: 'CARGO', amount: -9120, reference: 'ORDER:11576' }],
    [1173202, { type: 'PAGO', amount: 14700, reference: 'Manual' }],
    [1173203, { type: 'PAGO', amount: 14700, reference: 'Manual' }],
  ]);
  for (const transaction of remove) {
    const rule = expected.get(transaction.id);
    if (!rule || transaction.type !== rule.type || !sameAmount(transaction.amount, rule.amount) || transaction.reference !== rule.reference) {
      throw new Error(`El movimiento ${transaction.id} ya no cumple la evidencia de duplicado.`);
    }
  }
  const adjustment = transactions.filter((transaction) => transaction.reference === adjustmentReference);
  if (adjustment.length !== 1) throw new Error('No existe un unico ajuste de conciliacion para Marcos.');
  const operational = transactions.filter((transaction) => !raw.includes(transaction) && !adjustment.includes(transaction) && !remove.includes(transaction));
  const expectedAdjustment = -total(operational);

  return { client, sourceRows, sourceEvidence, transactions, raw, remove, adjustment: adjustment[0], operational, expectedAdjustment };
}

function report(plan) {
  return {
    client: `${plan.client.name} (#${plan.client.old_id})`,
    removedTransactionIds: plan.remove.map((transaction) => transaction.id),
    sourceReferences: plan.sourceEvidence.map((row) => row.reference),
    previousAdjustment: plan.adjustment.amount,
    expectedAdjustment: plan.expectedAdjustment,
    finalBalance: total(plan.sourceRows),
  };
}

async function applyPlan(plan) {
  mkdirSync(join(process.cwd(), 'backups'), { recursive: true });
  writeFileSync(backupPath, JSON.stringify({ exportedAt: new Date().toISOString(), plan: report(plan), transactions: plan.transactions.map(snapshot) }, null, 2));

  await prisma.$transaction(async (tx) => {
    const current = await tx.transaction.findMany({
      where: { clientId: plan.client.id },
      select: { id: true, clientId: true, date: true, type: true, amount: true, description: true, reference: true, paymentMethod: true },
      orderBy: { id: 'asc' },
    });
    if (current.length !== plan.transactions.length || current.some((transaction, index) => !sameSnapshot(transaction, snapshot(plan.transactions[index])))) {
      throw new Error('Los movimientos de Marcos cambiaron durante la revision. Se revirtio la operacion.');
    }

    await tx.transaction.deleteMany({ where: { id: { in: plan.remove.map((transaction) => transaction.id) } } });
    await tx.transaction.update({
      where: { id: plan.adjustment.id },
      data: {
        amount: plan.expectedAdjustment,
        type: plan.expectedAdjustment > 0 ? 'PAGO' : 'CARGO',
        description: 'Ajuste automatico: movimientos operativos conservados frente a Cash Flow fuente.',
      },
    });

    const finalTransactions = await tx.transaction.findMany({
      where: { clientId: plan.client.id },
      select: { id: true, clientId: true, date: true, type: true, amount: true, description: true, reference: true },
    });
    const finalRaw = finalTransactions.filter((transaction) => String(transaction.reference || '').startsWith(rawPrefix));
    const reconciliation = reconcileCashflowRows(plan.sourceRows, finalRaw);
    if (
      reconciliation.exactRows !== plan.sourceRows.length
      || reconciliation.relocatedRows || reconciliation.oppositeSignRows || reconciliation.changedRows || reconciliation.missingRows || reconciliation.duplicateReferenceRows || reconciliation.extraRows
      || !sameAmount(total(finalTransactions), total(plan.sourceRows))
    ) {
      throw new Error('La cuenta final no coincide exactamente con Cash Flow. Se revirtio la operacion.');
    }
    await tx.accountEvidence.create({
      data: {
        clientId: plan.client.id,
        category: 'CASHFLOW_DUPLICATE_RESOLUTION',
        source: 'CASH FLOW 2026 / MARCOS CC',
        note: `Se retiraron transacciones duplicadas ${plan.remove.map((transaction) => transaction.id).join(', ')}. La fuente conserva ${plan.sourceEvidence.map((row) => row.reference).join(', ')}. Respaldo local: ${backupPath}.`,
      },
    });
    const run = await tx.syncRun.create({
      data: {
        scope: 'CASHFLOW_DUPLICATE_RESOLUTION',
        status: 'SUCCESS',
        finishedAt: new Date(),
        summary: report(plan),
      },
    });
    await tx.syncChange.create({
      data: {
        syncRunId: run.id,
        entity: 'CLIENT_ACCOUNT',
        entityKey: '#162',
        action: 'DEDUPLICATED',
        reason: 'Los cargos y pagos duplicados quedaron cubiertos por lineas fuente exactas de Cash Flow.',
      },
    });
  }, { isolationLevel: 'Serializable' });
}

async function main() {
  const input = sourcePath();
  if (!input) throw new Error('Indique --source <archivo-json> o CASHFLOW_RAW_EXPORT_PATH.');
  const plan = await buildPlan(input);
  console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'REVIEW', ...report(plan) }, null, 2));
  if (!apply) return;
  await applyPlan(plan);
  console.log(`OK: se retiraron ${plan.remove.length} duplicados de Marcos. Respaldo: ${backupPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
