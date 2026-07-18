import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { reconcileCashflowRows } from '../lib/cashflow-reconciliation.mjs';

const prisma = new PrismaClient();
const apply = process.env.APPLY === '1';
const oldId = 273;
const sourcePrefix = 'CASHFLOW-RAW-2026:MOLINA_OCT:';
const adjustmentReference = 'CASHFLOW-RECONCILIATION-2026:273';
const backupPath = join(process.cwd(), 'backups', 'cashflow-octavio-rebuild-2026-07-18.json');
const EPSILON = 0.005;

function sourcePath() {
  const index = process.argv.indexOf('--source');
  return index >= 0 ? process.argv[index + 1] : process.env.CASHFLOW_RAW_EXPORT_PATH;
}

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function total(rows) {
  return round(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
}

async function loadValidatedPlan(input) {
  const allSourceRows = JSON.parse(await readFile(input, 'utf8'));
  const sourceRows = allSourceRows.filter((row) => row.oldId === oldId);
  const client = await prisma.client.findUnique({ where: { old_id: oldId }, select: { id: true, old_id: true, name: true } });
  if (!client || sourceRows.length === 0) throw new Error('No se encontró la cuenta o la fuente de Octavio. No se modificó nada.');

  const transactions = await prisma.transaction.findMany({
    where: { clientId: client.id },
    select: { id: true, clientId: true, date: true, type: true, amount: true, description: true, reference: true },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });
  const raw = transactions.filter((transaction) => String(transaction.reference || '').startsWith(sourcePrefix));
  const adjustments = transactions.filter((transaction) => transaction.reference === adjustmentReference);
  const operational = transactions.filter((transaction) => !raw.includes(transaction) && !adjustments.includes(transaction));
  const reconciliation = reconcileCashflowRows(sourceRows, raw);
  const sourceBalance = total(sourceRows);
  const rawBalance = total(raw);
  const missing = sourceRows.filter((row) => !raw.some((transaction) => transaction.reference === row.reference));
  const adjustmentBalance = total(adjustments);

  if (
    adjustments.length !== 1
    || operational.length !== 0
    || reconciliation.oppositeSignRows !== 0
    || reconciliation.changedRows !== 0
    || reconciliation.duplicateReferenceRows !== 0
    || reconciliation.extraRows !== 0
    || reconciliation.missingRows === 0
    || missing.length !== reconciliation.missingRows
    || Math.abs(total(missing) - adjustmentBalance) > EPSILON
    || Math.abs(sourceBalance - rawBalance - adjustmentBalance) > EPSILON
  ) {
    throw new Error('La cuenta de Octavio ya no cumple las condiciones de reconstrucción segura. No se modificó nada.');
  }

  return { client, sourceRows, raw, adjustments, missing, sourceBalance, rawBalance, adjustmentBalance, reconciliation };
}

async function main() {
  const input = sourcePath();
  if (!input) throw new Error('Indique --source <archivo-json> o CASHFLOW_RAW_EXPORT_PATH.');
  const plan = await loadValidatedPlan(input);
  console.log(`${apply ? 'MODO APLICAR' : 'MODO REVISIÓN'}: ${plan.client.name}, ${plan.missing.length} filas fuente, ajuste ${plan.adjustmentBalance.toFixed(2)}.`);
  if (!apply) return;

  mkdirSync(join(process.cwd(), 'backups'), { recursive: true });
  writeFileSync(backupPath, JSON.stringify({ exportedAt: new Date().toISOString(), plan }, null, 2));

  await prisma.$transaction(async (tx) => {
    const currentAdjustment = await tx.transaction.findUnique({ where: { id: plan.adjustments[0].id } });
    if (!currentAdjustment || currentAdjustment.reference !== adjustmentReference || Math.abs(currentAdjustment.amount - plan.adjustmentBalance) > EPSILON) {
      throw new Error('El ajuste cambió durante la validación. Se revirtió la operación.');
    }

    await tx.transaction.createMany({
      data: plan.missing.map((row) => ({
        clientId: plan.client.id,
        date: new Date(row.date),
        type: row.type,
        amount: row.amount,
        description: row.description,
        reference: row.reference,
      })),
    });
    const created = await tx.transaction.findMany({
      where: { clientId: plan.client.id, reference: { in: plan.missing.map((row) => row.reference) } },
      select: { id: true, reference: true, date: true, type: true, amount: true },
      orderBy: { id: 'asc' },
    });
    if (created.length !== plan.missing.length) throw new Error('No se crearon todas las filas fuente. Se revirtió la operación.');

    const deleted = await tx.transaction.deleteMany({ where: { id: plan.adjustments[0].id, reference: adjustmentReference } });
    if (deleted.count !== 1) throw new Error('No se eliminó el ajuste global esperado. Se revirtió la operación.');

    const finalBalance = await tx.transaction.aggregate({ where: { clientId: plan.client.id }, _sum: { amount: true } });
    if (Math.abs(Number(finalBalance._sum.amount || 0) - plan.sourceBalance) > EPSILON) {
      throw new Error('El saldo final no coincide con Cash Flow. Se revirtió la operación.');
    }

    const evidenceTransaction = created[0];
    await tx.accountEvidence.create({
      data: {
        clientId: plan.client.id,
        transactionId: evidenceTransaction.id,
        transactionReference: evidenceTransaction.reference,
        transactionDate: evidenceTransaction.date,
        transactionType: evidenceTransaction.type,
        transactionAmount: evidenceTransaction.amount,
        category: 'CASHFLOW_RECONCILIATION',
        source: 'CASH FLOW 2026 / MOLINA OCT',
        note: `Se reemplazó el ajuste global ${adjustmentReference} por ${created.length} filas verificadas de Cash Flow. Respaldo local: ${backupPath}.`,
      },
    });
    const run = await tx.syncRun.create({
      data: {
        scope: 'CASHFLOW_LEDGER_REBUILD',
        status: 'SUCCESS',
        finishedAt: new Date(),
        summary: { oldId, addedReferences: plan.missing.map((row) => row.reference), removedAdjustment: adjustmentReference, sourceBalance: plan.sourceBalance },
      },
    });
    await tx.syncChange.create({
      data: {
        syncRunId: run.id,
        entity: 'CLIENT_ACCOUNT',
        entityKey: `#${oldId}`,
        action: 'REBUILT',
        reason: 'Se sustituyó un ajuste global por filas fuente verificadas de Cash Flow.',
      },
    });
  }, { isolationLevel: 'Serializable' });

  console.log(`OK: Octavio reconstruido con ${plan.missing.length} filas fuente. Respaldo: ${backupPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
