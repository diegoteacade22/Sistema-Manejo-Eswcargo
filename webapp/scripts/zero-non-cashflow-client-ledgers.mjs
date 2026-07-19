import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const EPSILON = 0.005;
const REFERENCE_PREFIX = 'CC-CUTOVER-ZERO-2026:';
const controls = JSON.parse(readFileSync(new URL('./client-balance-controls.json', import.meta.url), 'utf8'));
const cashFlowClientIds = new Set(controls.cashFlowAccounts.map((account) => account.oldId));

function localCutoverDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

const CUTOVER_DATE = process.env.CUTOVER_DATE || localCutoverDate();

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function total(transactions) {
  return round(transactions.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0));
}

function sameAmount(left, right) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= EPSILON;
}

function snapshot(transactions) {
  return transactions.map((transaction) => ({
    id: transaction.id,
    clientId: transaction.clientId,
    date: transaction.date.toISOString(),
    type: transaction.type,
    amount: Number(transaction.amount),
    description: transaction.description,
    reference: transaction.reference,
    paymentMethod: transaction.paymentMethod,
  }));
}

function differs(current, expected) {
  if (current.length !== expected.length) return `cantidad ${expected.length} -> ${current.length}`;
  for (let index = 0; index < current.length; index += 1) {
    const left = current[index];
    const right = expected[index];
    if (left.id !== right.id) return `indice ${index}: id ${right.id} -> ${left.id}`;
    if (left.reference !== right.reference) return `id ${left.id}: referencia cambio`;
    if (left.type !== right.type) return `id ${left.id}: tipo cambio`;
    if (!sameAmount(left.amount, right.amount)) return `id ${left.id}: importe cambio`;
    if (left.date.toISOString() !== right.date) return `id ${left.id}: fecha cambio`;
  }
  return null;
}

async function buildPlan() {
  const transactions = await prisma.transaction.findMany({
    where: { clientId: { not: null } },
    select: {
      id: true,
      clientId: true,
      date: true,
      type: true,
      amount: true,
      description: true,
      reference: true,
      paymentMethod: true,
      client: { select: { id: true, old_id: true, name: true } },
    },
    orderBy: [{ clientId: 'asc' }, { date: 'asc' }, { id: 'asc' }],
  });

  const byClient = new Map();
  for (const transaction of transactions) {
    const group = byClient.get(transaction.clientId) || [];
    group.push(transaction);
    byClient.set(transaction.clientId, group);
  }

  const candidates = [...byClient.values()]
    .map((group) => {
      const client = group[0].client;
      const balance = total(group);
      const existingCutover = group.filter((transaction) => String(transaction.reference || '').startsWith(REFERENCE_PREFIX));
      return {
        client,
        transactions: group,
        balance,
        existingCutover,
        isCashFlowAccount: client.old_id !== null && cashFlowClientIds.has(client.old_id),
      };
    })
    .filter((account) => !account.isCashFlowAccount && Math.abs(account.balance) > EPSILON)
    .sort((left, right) => left.client.name.localeCompare(right.client.name));

  for (const account of candidates) {
    if (account.existingCutover.length > 0) {
      throw new Error(`${account.client.name}: ya existe un ajuste de punto cero. Revisalo manualmente antes de reintentar.`);
    }
  }

  return { transactions, candidates };
}

function report(plan) {
  return {
    policy: 'Todos los clientes fuera de CASH FLOW 2026 quedan saldados; las 11 cuentas definidas en client-balance-controls.json conservan su saldo fuente.',
    cashFlowAccountOldIds: [...cashFlowClientIds].sort((left, right) => left - right),
    candidates: plan.candidates.map((account) => ({
      clientId: account.client.id,
      oldId: account.client.old_id,
      client: account.client.name,
      balanceBefore: account.balance,
      adjustmentAmount: round(-account.balance),
      adjustmentType: account.balance > 0 ? 'CARGO' : 'PAGO',
      reference: `${REFERENCE_PREFIX}${account.client.id}`,
    })),
    totals: {
      accountsToZero: plan.candidates.length,
      positiveBalanceToNeutralize: round(plan.candidates.filter((account) => account.balance > 0).reduce((sum, account) => sum + account.balance, 0)),
      negativeBalanceToNeutralize: round(plan.candidates.filter((account) => account.balance < 0).reduce((sum, account) => sum + account.balance, 0)),
    },
  };
}

async function applyPlan(plan) {
  mkdirSync(join(process.cwd(), 'backups'), { recursive: true });
  const backupPath = join(process.cwd(), 'backups', `cc-cutover-zero-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(backupPath, JSON.stringify({ exportedAt: new Date().toISOString(), plan: report(plan), transactions: snapshot(plan.transactions) }, null, 2));

  await prisma.$transaction(async (tx) => {
    const current = await tx.transaction.findMany({
      where: { clientId: { not: null } },
      select: { id: true, clientId: true, date: true, type: true, amount: true, description: true, reference: true, paymentMethod: true },
      orderBy: [{ clientId: 'asc' }, { date: 'asc' }, { id: 'asc' }],
    });
    const change = differs(current, snapshot(plan.transactions));
    if (change) throw new Error(`Los movimientos cambiaron durante la revisión (${change}). Se revirtió toda la operación.`);

    for (const account of plan.candidates) {
      const adjustmentAmount = round(-account.balance);
      const transaction = await tx.transaction.create({
        data: {
          clientId: account.client.id,
          date: new Date(),
          type: adjustmentAmount > 0 ? 'PAGO' : 'CARGO',
          amount: adjustmentAmount,
          description: `Saldado a la fecha ${CUTOVER_DATE}: cuenta fuera de CASH FLOW 2026.`,
          reference: `${REFERENCE_PREFIX}${account.client.id}`,
        },
      });
      await tx.accountEvidence.create({
        data: {
          clientId: account.client.id,
          transactionId: transaction.id,
          category: 'CC_CUTOVER_ZERO_BY_OWNER',
          source: `Decisión operativa del titular, ${CUTOVER_DATE}`,
          note: 'Cuenta fuera de CASH FLOW 2026; se conserva el historial y se agrega el saldo de cierre para el corte de sistema.',
        },
      });
    }

    for (const account of plan.candidates) {
      const final = await tx.transaction.aggregate({ where: { clientId: account.client.id }, _sum: { amount: true } });
      if (!sameAmount(final._sum.amount || 0, 0)) {
        throw new Error(`${account.client.name}: el saldo final no quedó en cero. Se revirtió toda la operación.`);
      }
    }
  }, { maxWait: 10_000, timeout: 60_000 });

  return backupPath;
}

async function main() {
  const plan = await buildPlan();
  const result = report(plan);
  if (!apply) {
    console.log(JSON.stringify({ apply: false, ...result }, null, 2));
    return;
  }
  const backupPath = await applyPlan(plan);
  console.log(JSON.stringify({ apply: true, backupPath, ...result }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
