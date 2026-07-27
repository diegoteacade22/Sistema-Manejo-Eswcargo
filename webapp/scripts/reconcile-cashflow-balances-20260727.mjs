import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const EPSILON = 0.005;
const SNAPSHOT_DATE = '2026-07-27';
const REFERENCE_PREFIX = `CC-CASHFLOW-BALANCE-${SNAPSHOT_DATE}:`;

const targets = [
  { oldId: 162, sheet: 'MARCOS CC', row: 415, target: 29854 },
  { oldId: 70, sheet: 'AYLEN CC', row: 192, target: -110 },
  { oldId: 66, sheet: 'FACU FABRI CC', row: 271, target: -0.375 },
  { oldId: 72, sheet: 'RAMIRO STRAR CC', row: 54, target: 0.5 },
  { oldId: 275, sheet: 'MARTIN DUS', row: 22, target: 0 },
  { oldId: 265, sheet: 'FEDE CANNING', row: 49, target: -4489 },
  { oldId: 119, sheet: 'TOMAS CC', row: 40, target: 0 },
  { oldId: 273, sheet: 'MOLINA OCT', row: 28, target: 280 },
  { oldId: 147, sheet: 'SEBAS LUC CC', row: 37, target: -17585 },
  { oldId: 214, sheet: 'LUCA CC', row: 68, target: 0 },
  { oldId: 174, sheet: 'GONZALO CC', row: 26, target: 0 },
  { oldId: 96, sheet: 'NAHUEL CC', row: 14, target: 0 },
];

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function sameAmount(left, right) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= EPSILON;
}

async function buildPlan() {
  const clients = await prisma.client.findMany({
    where: { old_id: { in: targets.map((target) => target.oldId) } },
    select: { id: true, old_id: true, name: true },
  });
  const byOldId = new Map(clients.map((client) => [client.old_id, client]));
  const missing = targets.filter((target) => !byOldId.has(target.oldId));
  if (missing.length > 0) {
    throw new Error(`Faltan clientes CASH FLOW: ${missing.map((target) => target.oldId).join(', ')}`);
  }

  const clientIds = clients.map((client) => client.id);
  const transactions = await prisma.transaction.findMany({
    where: { clientId: { in: clientIds } },
    select: {
      id: true, clientId: true, date: true, type: true, amount: true,
      description: true, reference: true, paymentMethod: true,
    },
    orderBy: [{ clientId: 'asc' }, { date: 'asc' }, { id: 'asc' }],
  });

  const accounts = targets.map((target) => {
    const client = byOldId.get(target.oldId);
    const rows = transactions.filter((transaction) => transaction.clientId === client.id);
    const balance = round(rows.reduce((sum, transaction) => sum + transaction.amount, 0));
    const reference = `${REFERENCE_PREFIX}${client.id}`;
    const existing = rows.filter((transaction) => transaction.reference === reference);
    if (existing.length > 1) {
      throw new Error(`${client.name}: hay más de un ajuste ${reference}.`);
    }
    const adjustment = round((existing[0]?.amount || 0) + target.target - balance);
    return { ...target, client, balance, reference, existing: existing[0] || null, adjustment };
  });

  return {
    transactions,
    accounts,
    candidates: accounts.filter((account) => !sameAmount(account.balance, account.target)),
  };
}

function report(plan) {
  return {
    source: `CASH FLOW 2026 leído en vivo el ${SNAPSHOT_DATE}`,
    accounts: plan.accounts.map((account) => ({
      clientId: account.client.id,
      oldId: account.oldId,
      client: account.client.name,
      sheet: account.sheet,
      sourceRow: account.row,
      balanceBefore: account.balance,
      targetBalance: account.target,
      adjustmentAmount: account.adjustment,
      action: sameAmount(account.balance, account.target)
        ? 'NONE'
        : (account.existing ? 'UPDATE' : 'CREATE'),
    })),
    accountsToAdjust: plan.candidates.length,
  };
}

async function applyPlan(plan) {
  mkdirSync(join(process.cwd(), 'backups'), { recursive: true });
  const backupPath = join(
    process.cwd(),
    'backups',
    `cashflow-balance-reconciliation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  writeFileSync(backupPath, JSON.stringify({
    exportedAt: new Date().toISOString(),
    report: report(plan),
    transactions: plan.transactions.map((transaction) => ({
      ...transaction,
      date: transaction.date.toISOString(),
    })),
  }, null, 2));

  await prisma.$transaction(async (tx) => {
    for (const account of plan.candidates) {
      const data = {
        clientId: account.client.id,
        date: new Date(`${SNAPSHOT_DATE}T12:00:00-04:00`),
        type: account.adjustment > 0 ? 'PAGO' : 'CARGO',
        amount: account.adjustment,
        description: `Conciliación de saldo con ${account.sheet}, fila ${account.row}.`,
        reference: account.reference,
      };
      const transaction = account.existing
        ? await tx.transaction.update({ where: { id: account.existing.id }, data })
        : await tx.transaction.create({ data });

      const evidence = await tx.accountEvidence.findFirst({
        where: { transactionId: transaction.id, category: 'CASH_FLOW_BALANCE_RECONCILIATION' },
        select: { id: true },
      });
      if (!evidence) {
        await tx.accountEvidence.create({
          data: {
            clientId: account.client.id,
            transactionId: transaction.id,
            category: 'CASH_FLOW_BALANCE_RECONCILIATION',
            source: `CASH FLOW 2026 / ${account.sheet}!A${account.row}:G${account.row}`,
            note: `Saldo efectivo confirmado: ${account.target}.`,
          },
        });
      }
    }

    for (const account of plan.accounts) {
      const total = await tx.transaction.aggregate({
        where: { clientId: account.client.id },
        _sum: { amount: true },
      });
      if (!sameAmount(total._sum.amount || 0, account.target)) {
        throw new Error(`${account.client.name}: no alcanzó el saldo ${account.target}; se revirtió todo.`);
      }
    }
  }, { maxWait: 10_000, timeout: 60_000 });

  return backupPath;
}

async function main() {
  const plan = await buildPlan();
  if (!apply) {
    console.log(JSON.stringify({ apply: false, ...report(plan) }, null, 2));
    return;
  }
  const backupPath = await applyPlan(plan);
  console.log(JSON.stringify({ apply: true, backupPath, ...report(plan) }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
