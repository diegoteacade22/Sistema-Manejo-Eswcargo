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

async function main() {
  const input = sourcePath();
  if (!input) throw new Error('Indique --source <archivo-json> o CASHFLOW_RAW_EXPORT_PATH.');
  const sourceRows = JSON.parse(await readFile(input, 'utf8'));
  if (!Array.isArray(sourceRows)) throw new Error('La fuente Cash Flow debe ser una lista JSON.');

  const oldIds = [...new Set(sourceRows.map((row) => row.oldId).filter(Number.isInteger))];
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
  const raw = transactions.filter((transaction) => String(transaction.reference || '').startsWith('CASHFLOW-RAW-2026:'));
  const accounts = [];

  for (const oldId of oldIds.sort((a, b) => a - b)) {
    const client = clientByOldId.get(oldId);
    const source = sourceRows.filter((row) => row.oldId === oldId);
    const all = client ? transactions.filter((transaction) => transaction.clientId === client.id) : [];
    const rawRows = all.filter((transaction) => String(transaction.reference || '').startsWith('CASHFLOW-RAW-2026:'));
    const reconciliation = reconcileCashflowRows(source, rawRows);
    const sourceBalance = total(source);
    const systemBalance = total(all);
    accounts.push({
      oldId,
      client: client ? { id: client.id, name: client.name } : null,
      sourceRows: source.length,
      rawRows: rawRows.length,
      exactRows: reconciliation.exactRows,
      relocatedRows: reconciliation.relocatedRows,
      oppositeSignRows: reconciliation.oppositeSignRows,
      changedRows: reconciliation.changedRows,
      missingRows: reconciliation.missingRows,
      duplicateReferenceRows: reconciliation.duplicateReferenceRows,
      extraRawRows: reconciliation.extraRows,
      sourceBalance,
      rawBalance: total(rawRows),
      systemBalance,
      finalBalanceMatchesSource: Math.abs(systemBalance - sourceBalance) <= EPSILON,
      samples: reconciliation.samples,
    });
  }

  const add = (field) => accounts.reduce((sum, account) => sum + account[field], 0);
  const report = {
    generatedAt: new Date().toISOString(),
    sourceRows: sourceRows.length,
    rawRows: raw.length,
    accounts,
    totals: {
      exactRows: add('exactRows'),
      relocatedRows: add('relocatedRows'),
      oppositeSignRows: add('oppositeSignRows'),
      changedRows: add('changedRows'),
      missingRows: add('missingRows'),
      duplicateReferenceRows: add('duplicateReferenceRows'),
      extraRawRows: add('extraRawRows'),
      accountsWithFinalBalanceMismatch: accounts.filter((account) => !account.finalBalanceMatchesSource).map((account) => account.oldId),
    },
  };
  console.log(JSON.stringify(report, null, 2));

  const drift = report.totals.oppositeSignRows || report.totals.changedRows || report.totals.missingRows || report.totals.duplicateReferenceRows
    || report.totals.extraRawRows || report.totals.accountsWithFinalBalanceMismatch.length;
  if (drift) {
    console.warn(`Advertencia Cash Flow: ${report.totals.relocatedRows} filas reubicadas, ${report.totals.oppositeSignRows} signos opuestos, ${report.totals.changedRows} cambios, ${report.totals.missingRows} faltantes, ${report.totals.duplicateReferenceRows} referencias repetidas, ${report.totals.extraRawRows} extras y ${report.totals.accountsWithFinalBalanceMismatch.length} saldos finales distintos.`);
  }
  if (process.env.CASHFLOW_RAW_DRIFT_STRICT === '1' && drift) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
