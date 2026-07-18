import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

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

function exact(transaction, row) {
  return transaction.type === row.type && Math.abs(transaction.amount - row.amount) <= EPSILON;
}

function opposite(transaction, row) {
  return transaction.type !== row.type && Math.abs(transaction.amount + row.amount) <= EPSILON;
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
  const rawByReference = new Map();
  for (const transaction of raw) {
    const group = rawByReference.get(transaction.reference) || [];
    group.push(transaction);
    rawByReference.set(transaction.reference, group);
  }
  const references = new Set(sourceRows.map((row) => row.reference));
  const accounts = [];

  for (const oldId of oldIds.sort((a, b) => a - b)) {
    const client = clientByOldId.get(oldId);
    const source = sourceRows.filter((row) => row.oldId === oldId);
    const all = client ? transactions.filter((transaction) => transaction.clientId === client.id) : [];
    const rawRows = all.filter((transaction) => String(transaction.reference || '').startsWith('CASHFLOW-RAW-2026:'));
    const samples = { oppositeSign: [], missing: [], changed: [], duplicateReference: [], extra: [] };
    let exactRows = 0;
    let oppositeSignRows = 0;
    let changedRows = 0;
    let missingRows = 0;
    let duplicateReferenceRows = 0;

    for (const row of source) {
      const transactionsByReference = rawByReference.get(row.reference) || [];
      const transaction = transactionsByReference[0];
      if (transactionsByReference.length > 1) {
        duplicateReferenceRows += transactionsByReference.length - 1;
        if (samples.duplicateReference.length < 5) {
          samples.duplicateReference.push({
            reference: row.reference,
            transactionIds: transactionsByReference.map((item) => item.id),
          });
        }
      }
      if (!transaction) {
        missingRows += 1;
        if (samples.missing.length < 5) samples.missing.push(row.reference);
      } else if (exact(transaction, row)) {
        exactRows += 1;
      } else if (opposite(transaction, row)) {
        oppositeSignRows += 1;
        if (samples.oppositeSign.length < 5) samples.oppositeSign.push(row.reference);
      } else {
        changedRows += 1;
        if (samples.changed.length < 5) samples.changed.push({
          reference: row.reference,
          expected: { type: row.type, amount: row.amount },
          actual: { id: transaction.id, type: transaction.type, amount: transaction.amount },
        });
      }
    }

    const extra = rawRows.filter((transaction) => !references.has(transaction.reference));
    for (const transaction of extra.slice(0, 5)) {
      samples.extra.push({ id: transaction.id, reference: transaction.reference, amount: transaction.amount });
    }
    const sourceBalance = total(source);
    const systemBalance = total(all);
    accounts.push({
      oldId,
      client: client ? { id: client.id, name: client.name } : null,
      sourceRows: source.length,
      rawRows: rawRows.length,
      exactRows,
      oppositeSignRows,
      changedRows,
      missingRows,
      duplicateReferenceRows,
      extraRawRows: extra.length,
      sourceBalance,
      rawBalance: total(rawRows),
      systemBalance,
      finalBalanceMatchesSource: Math.abs(systemBalance - sourceBalance) <= EPSILON,
      samples,
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
    console.warn(`Advertencia Cash Flow: ${report.totals.oppositeSignRows} signos opuestos, ${report.totals.changedRows} cambios, ${report.totals.missingRows} faltantes, ${report.totals.duplicateReferenceRows} referencias repetidas, ${report.totals.extraRawRows} extras y ${report.totals.accountsWithFinalBalanceMismatch.length} saldos finales distintos.`);
  }
  if (process.env.CASHFLOW_RAW_DRIFT_STRICT === '1' && drift) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
