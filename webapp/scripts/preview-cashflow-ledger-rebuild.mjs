import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { reconcileCashflowRows } from '../lib/cashflow-reconciliation.mjs';

const prisma = new PrismaClient();
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

function isRaw(transaction) {
  return String(transaction.reference || '').startsWith('CASHFLOW-RAW-2026:');
}

function isReconciliationAdjustment(transaction) {
  return String(transaction.reference || '').startsWith('CASHFLOW-RECONCILIATION-2026:');
}

async function main() {
  const input = sourcePath();
  if (!input) throw new Error('Indique --source <archivo-json> o CASHFLOW_RAW_EXPORT_PATH.');
  const sourceRows = JSON.parse(await readFile(input, 'utf8'));
  if (!Array.isArray(sourceRows)) throw new Error('La fuente Cash Flow debe ser una lista JSON.');

  const oldIds = [...new Set(sourceRows.map((row) => row.oldId).filter(Number.isInteger))].sort((a, b) => a - b);
  const clients = await prisma.client.findMany({
    where: { old_id: { in: oldIds } },
    select: { id: true, old_id: true, name: true },
  });
  const clientByOldId = new Map(clients.map((client) => [client.old_id, client]));
  const transactions = await prisma.transaction.findMany({
    where: { clientId: { in: clients.map((client) => client.id) } },
    select: { id: true, clientId: true, date: true, type: true, amount: true, description: true, reference: true },
    orderBy: [{ clientId: 'asc' }, { date: 'asc' }, { id: 'asc' }],
  });

  const accounts = oldIds.map((oldId) => {
    const client = clientByOldId.get(oldId) || null;
    const source = sourceRows.filter((row) => row.oldId === oldId);
    const all = client ? transactions.filter((transaction) => transaction.clientId === client.id) : [];
    const raw = all.filter(isRaw);
    const adjustments = all.filter(isReconciliationAdjustment);
    const operational = all.filter((transaction) => !isRaw(transaction) && !isReconciliationAdjustment(transaction));
    const sourceBalance = total(source);
    const rawBalance = total(raw);
    const operationalBalance = total(operational);
    const adjustmentBalance = total(adjustments);
    const unadjustedBalance = round(rawBalance + operationalBalance);
    const requiredAdjustment = round(sourceBalance - unadjustedBalance);
    const reconciliation = reconcileCashflowRows(source, raw);
    const adjustmentMatchesDifference = Math.abs(requiredAdjustment - adjustmentBalance) <= EPSILON;
    const safeToMaterializeMissingSourceRows = adjustments.length === 1
      && operational.length === 0
      && adjustmentMatchesDifference
      && reconciliation.oppositeSignRows === 0
      && reconciliation.changedRows === 0
      && reconciliation.duplicateReferenceRows === 0
      && reconciliation.extraRows === 0
      && reconciliation.missingRows > 0;
    return {
      oldId,
      client: client ? { id: client.id, name: client.name } : null,
      sourceRows: source.length,
      sourceBalance,
      rawRows: raw.length,
      rawBalance,
      operationalRows: operational.length,
      operationalBalance,
      adjustmentRows: adjustments.length,
      adjustmentBalance,
      unadjustedBalance,
      requiredAdjustment,
      adjustmentMatchesDifference,
      safeToMaterializeMissingSourceRows,
      sourceMapping: {
        exactRows: reconciliation.exactRows,
        relocatedRows: reconciliation.relocatedRows,
        oppositeSignRows: reconciliation.oppositeSignRows,
        changedRows: reconciliation.changedRows,
        missingRows: reconciliation.missingRows,
        duplicateReferenceRows: reconciliation.duplicateReferenceRows,
        extraRawRows: reconciliation.extraRows,
      },
      safeToReplaceAdjustment: adjustments.length === 0 || (
        operational.length === 0
        && reconciliation.oppositeSignRows === 0
        && reconciliation.changedRows === 0
        && reconciliation.missingRows === 0
        && reconciliation.duplicateReferenceRows === 0
        && reconciliation.extraRows === 0
      ),
    };
  });

  const report = {
    generatedAt: new Date().toISOString(),
    sourceRows: sourceRows.length,
    accounts,
    totals: {
      accounts: accounts.length,
      accountsWithAdjustments: accounts.filter((account) => account.adjustmentRows > 0).length,
      accountsSafeToReplaceAdjustment: accounts.filter((account) => account.adjustmentRows > 0 && account.safeToReplaceAdjustment).length,
      accountsSafeToMaterializeMissingSourceRows: accounts.filter((account) => account.safeToMaterializeMissingSourceRows).length,
      adjustmentsMatchingSourceDifference: accounts.filter((account) => account.adjustmentRows > 0 && account.adjustmentMatchesDifference).length,
      sourceBalance: total(accounts.map((account) => ({ amount: account.sourceBalance }))),
      systemBalance: total(accounts.map((account) => ({ amount: round(account.unadjustedBalance + account.adjustmentBalance) }))),
    },
  };

  console.log(JSON.stringify(report, null, 2));
  if (report.totals.accountsWithAdjustments) {
    console.warn(`Advertencia: ${report.totals.accountsWithAdjustments} cuentas dependen de ajustes globales; no se aplicó ninguna reconstrucción.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
