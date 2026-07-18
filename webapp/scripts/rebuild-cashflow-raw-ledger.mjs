import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { reconcileCashflowRows } from '../lib/cashflow-reconciliation.mjs';

const prisma = new PrismaClient();
const apply = process.env.APPLY === '1';
const EPSILON = 0.005;
const RAW_PREFIX = 'CASHFLOW-RAW-2026:';
const RECONCILIATION_PREFIX = 'CASHFLOW-RECONCILIATION-2026:';
const backupPath = join(process.cwd(), 'backups', 'cashflow-raw-ledger-rebuild-2026-07-18.json');

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

function sameNumber(left, right) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= EPSILON;
}

function sourceDate(row) {
  const value = new Date(row.date);
  if (Number.isNaN(value.getTime())) throw new Error(`Fecha fuente invalida en ${row.reference}.`);
  return value;
}

function isRaw(transaction) {
  return String(transaction.reference || '').startsWith(RAW_PREFIX);
}

function isAdjustment(transaction) {
  return String(transaction.reference || '').startsWith(RECONCILIATION_PREFIX);
}

function comparable(transaction) {
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

function assertSourceRows(sourceRows) {
  const references = new Set();
  for (const row of sourceRows) {
    if (!Number.isInteger(row.oldId) || !row.reference?.startsWith(RAW_PREFIX)) {
      throw new Error('La fuente contiene una fila sin cuenta o referencia Cash Flow valida.');
    }
    if (references.has(row.reference)) throw new Error(`La fuente repite la referencia ${row.reference}.`);
    references.add(row.reference);
    sourceDate(row);
  }
}

async function buildPlan(input) {
  const sourceRows = JSON.parse(await readFile(input, 'utf8'));
  if (!Array.isArray(sourceRows) || sourceRows.length === 0) throw new Error('La fuente Cash Flow no contiene filas.');
  assertSourceRows(sourceRows);

  const oldIds = [...new Set(sourceRows.map((row) => row.oldId))].sort((a, b) => a - b);
  const clients = await prisma.client.findMany({
    where: { old_id: { in: oldIds } },
    select: { id: true, old_id: true, name: true },
  });
  if (clients.length !== oldIds.length) {
    const found = new Set(clients.map((client) => client.old_id));
    throw new Error(`No existen en el sistema las cuentas: ${oldIds.filter((oldId) => !found.has(oldId)).join(', ')}.`);
  }
  const clientByOldId = new Map(clients.map((client) => [client.old_id, client]));
  const transactions = await prisma.transaction.findMany({
    where: { clientId: { in: clients.map((client) => client.id) } },
    select: { id: true, clientId: true, date: true, type: true, amount: true, description: true, reference: true, paymentMethod: true },
    orderBy: [{ clientId: 'asc' }, { id: 'asc' }],
  });

  const accounts = oldIds.map((oldId) => {
    const client = clientByOldId.get(oldId);
    const source = sourceRows.filter((row) => row.oldId === oldId);
    const current = transactions.filter((transaction) => transaction.clientId === client.id);
    const raw = current.filter(isRaw);
    const adjustments = current.filter(isAdjustment);
    const operational = current.filter((transaction) => !isRaw(transaction) && !isAdjustment(transaction));
    const rawByReference = new Map();
    for (const transaction of raw) {
      const group = rawByReference.get(transaction.reference) || [];
      group.push(transaction);
      rawByReference.set(transaction.reference, group);
    }
    const duplicates = [...rawByReference.entries()].filter(([, group]) => group.length > 1);
    if (duplicates.length) throw new Error(`${client.name}: hay referencias RAW duplicadas (${duplicates.map(([reference]) => reference).join(', ')}).`);

    const sourceReferences = new Set(source.map((row) => row.reference));
    const updates = [];
    const creates = [];
    for (const row of source) {
      const stored = rawByReference.get(row.reference)?.[0];
      if (!stored) {
        creates.push(row);
        continue;
      }
      const targetDate = sourceDate(row);
      const sameDate = stored.date.toISOString().slice(0, 10) === targetDate.toISOString().slice(0, 10);
      if (!sameDate || stored.type !== row.type || !sameNumber(stored.amount, row.amount) || (stored.description || '') !== (row.description || '')) {
        updates.push({ stored, row });
      }
    }
    const deletes = raw.filter((transaction) => !sourceReferences.has(transaction.reference));
    const sourceBalance = total(source);
    const operationalBalance = total(operational);
    const requiredAdjustment = round(-operationalBalance);
    const reconciliation = reconcileCashflowRows(source, raw);

    return {
      oldId,
      client,
      source,
      raw,
      adjustments,
      operational,
      updates,
      creates,
      deletes,
      sourceBalance,
      operationalBalance,
      requiredAdjustment,
      reconciliation,
    };
  });

  return { sourceRows, clients, transactions, accounts };
}

function reportPlan(plan) {
  return {
    sourceRows: plan.sourceRows.length,
    accounts: plan.accounts.map((account) => ({
      oldId: account.oldId,
      client: account.client.name,
      sourceRows: account.source.length,
      rawUpdates: account.updates.length,
      rawCreates: account.creates.length,
      rawDeletes: account.deletes.length,
      adjustmentRowsBefore: account.adjustments.length,
      requiredAdjustment: account.requiredAdjustment,
      operationalBalance: account.operationalBalance,
      finalBalanceAfter: account.sourceBalance,
    })),
    totals: {
      rawUpdates: plan.accounts.reduce((sum, account) => sum + account.updates.length, 0),
      rawCreates: plan.accounts.reduce((sum, account) => sum + account.creates.length, 0),
      rawDeletes: plan.accounts.reduce((sum, account) => sum + account.deletes.length, 0),
      adjustmentsToSet: plan.accounts.filter((account) => Math.abs(account.requiredAdjustment) > EPSILON).length,
      adjustmentsToRemove: plan.accounts.filter((account) => Math.abs(account.requiredAdjustment) <= EPSILON && account.adjustments.length > 0).length,
    },
  };
}

function snapshotDifference(current, expected) {
  if (current.length !== expected.length) return `cantidad ${expected.length} -> ${current.length}`;
  for (let index = 0; index < current.length; index += 1) {
    const transaction = current[index];
    const snapshot = expected[index];
    if (transaction.id !== snapshot.id) return `indice ${index}: id ${snapshot.id} -> ${transaction.id}`;
    if (transaction.reference !== snapshot.reference) return `id ${transaction.id}: referencia cambio`;
    if (transaction.type !== snapshot.type) return `id ${transaction.id}: tipo ${snapshot.type} -> ${transaction.type}`;
    if (!sameNumber(transaction.amount, snapshot.amount)) return `id ${transaction.id}: importe ${snapshot.amount} -> ${transaction.amount}`;
    const expectedDate = snapshot.date instanceof Date ? snapshot.date.toISOString() : snapshot.date;
    if (transaction.date.toISOString() !== expectedDate) return `id ${transaction.id}: fecha ${expectedDate} -> ${transaction.date.toISOString()}`;
  }
  return null;
}

async function applyPlan(plan) {
  mkdirSync(join(process.cwd(), 'backups'), { recursive: true });
  const backup = {
    exportedAt: new Date().toISOString(),
    sourceRows: plan.sourceRows,
    transactions: plan.transactions.map(comparable),
    plan: reportPlan(plan),
  };
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));

  await prisma.$transaction(async (tx) => {
    const current = await tx.transaction.findMany({
      where: { clientId: { in: plan.clients.map((client) => client.id) } },
      select: { id: true, clientId: true, date: true, type: true, amount: true, description: true, reference: true, paymentMethod: true },
      orderBy: [{ clientId: 'asc' }, { id: 'asc' }],
    });
    const difference = snapshotDifference(current, plan.transactions);
    if (difference) {
      throw new Error(`Los movimientos cambiaron durante la revision (${difference}). Se revirtio toda la operacion.`);
    }

    for (const account of plan.accounts) {
      for (const update of account.updates) {
        await tx.transaction.update({
          where: { id: update.stored.id },
          data: {
            date: sourceDate(update.row),
            type: update.row.type,
            amount: update.row.amount,
            description: update.row.description,
          },
        });
      }
      if (account.creates.length) {
        await tx.transaction.createMany({
          data: account.creates.map((row) => ({
            clientId: account.client.id,
            date: sourceDate(row),
            type: row.type,
            amount: row.amount,
            description: row.description,
            reference: row.reference,
          })),
        });
      }
      if (account.deletes.length) {
        await tx.transaction.deleteMany({ where: { id: { in: account.deletes.map((transaction) => transaction.id) } } });
      }

      if (account.adjustments.length) {
        await tx.transaction.deleteMany({ where: { id: { in: account.adjustments.map((transaction) => transaction.id) } } });
      }
      if (Math.abs(account.requiredAdjustment) > EPSILON) {
        await tx.transaction.create({
          data: {
            clientId: account.client.id,
            date: new Date(),
            type: account.requiredAdjustment > 0 ? 'PAGO' : 'CARGO',
            amount: account.requiredAdjustment,
            description: 'Ajuste automatico: movimientos operativos conservados frente a Cash Flow fuente.',
            reference: `${RECONCILIATION_PREFIX}${account.oldId}`,
          },
        });
      }
    }

    for (const account of plan.accounts) {
      const finalTransactions = await tx.transaction.findMany({
        where: { clientId: account.client.id },
        select: { id: true, clientId: true, date: true, type: true, amount: true, description: true, reference: true },
      });
      const raw = finalTransactions.filter(isRaw);
      const reconciliation = reconcileCashflowRows(account.source, raw);
      const finalBalance = total(finalTransactions);
      if (
        reconciliation.relocatedRows !== 0
        || reconciliation.oppositeSignRows !== 0
        || reconciliation.changedRows !== 0
        || reconciliation.missingRows !== 0
        || reconciliation.duplicateReferenceRows !== 0
        || reconciliation.extraRows !== 0
        || !sameNumber(finalBalance, account.sourceBalance)
      ) {
        throw new Error(`${account.client.name}: la verificacion final no coincide con Cash Flow. Se revirtio toda la operacion.`);
      }
    }

    const run = await tx.syncRun.create({
      data: {
        scope: 'CASHFLOW_RAW_LEDGER_REBUILD',
        status: 'SUCCESS',
        finishedAt: new Date(),
        summary: reportPlan(plan),
      },
    });
    await tx.syncChange.createMany({
      data: plan.accounts.map((account) => ({
        syncRunId: run.id,
        entity: 'CLIENT_ACCOUNT',
        entityKey: `#${account.oldId}`,
        action: 'REBUILT',
        reason: 'Filas CASHFLOW-RAW reconstruidas desde Cash Flow; documentos operativos preservados y ajuste recalculado.',
      })),
    });
  }, { isolationLevel: 'Serializable', timeout: 120000 });
}

async function main() {
  const input = sourcePath();
  if (!input) throw new Error('Indique --source <archivo-json> o CASHFLOW_RAW_EXPORT_PATH.');
  const plan = await buildPlan(input);
  const report = reportPlan(plan);
  console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'REVIEW', ...report }, null, 2));
  if (!apply) return;

  await applyPlan(plan);
  console.log(`OK: ${report.totals.rawUpdates} actualizaciones, ${report.totals.rawCreates} altas y ${report.totals.rawDeletes} bajas RAW. Respaldo: ${backupPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
