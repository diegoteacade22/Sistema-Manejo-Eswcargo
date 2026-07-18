import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const summaryOnly = process.argv.includes('--summary');
const controls = JSON.parse(readFileSync(new URL('./client-balance-controls.json', import.meta.url), 'utf8'));
const cashFlowClientIds = new Set(controls.cashFlowAccounts.map((account) => account.oldId));
const confirmedZeroClientIds = new Set(controls.lockedBalances.map((account) => account.oldId));

function round(amount) {
  return Math.round(amount * 100) / 100;
}

function accountStatus(transactions, client, shipmentReconciledClientIds) {
  const hasBaseline = transactions.some((transaction) => String(transaction.reference || '').startsWith('CC-ZERO-BASELINE-2026:'));
  const onlyBaseline = hasBaseline && transactions.every((transaction) => String(transaction.reference || '').startsWith('CC-ZERO-BASELINE-2026:'));
  const hasReconciliationAdjustment = transactions.some((transaction) => String(transaction.reference || '').startsWith('CASHFLOW-RECONCILIATION-2026:'));
  if (hasReconciliationAdjustment && cashFlowClientIds.has(client.old_id)) return 'cashflow_adjustment_requires_detail';
  if (hasReconciliationAdjustment && confirmedZeroClientIds.has(client.old_id)) return 'locked_zero_adjustment_requires_evidence';
  if (cashFlowClientIds.has(client.old_id)) return 'cashflow_source';
  if (shipmentReconciledClientIds.has(client.id) && Math.abs(transactions.reduce((sum, transaction) => sum + transaction.amount, 0)) <= 0.01) {
    return 'shipment_source_reconciled';
  }
  if (confirmedZeroClientIds.has(client.old_id)) return 'confirmed_zero';
  if (onlyBaseline) return 'baseline_only_requires_evidence';
  if (hasBaseline) return 'baseline_mixed_requires_evidence';
  return 'operational_without_cashflow_source';
}

async function main() {
  const transactions = await prisma.transaction.findMany({
    where: { clientId: { not: null } },
    select: {
      clientId: true,
      amount: true,
      reference: true,
      date: true,
      client: { select: { id: true, old_id: true, name: true } },
    },
    orderBy: [{ clientId: 'asc' }, { date: 'asc' }, { id: 'asc' }],
  });
  const shipmentReconciliations = await prisma.accountEvidence.findMany({
    where: { category: 'SHIPMENT_CHARGE_RECONCILIATION' },
    select: { clientId: true },
  });
  const shipmentReconciledClientIds = new Set(shipmentReconciliations.map((evidence) => evidence.clientId));

  const grouped = new Map();
  for (const transaction of transactions) {
    const group = grouped.get(transaction.clientId) || [];
    group.push(transaction);
    grouped.set(transaction.clientId, group);
  }

  const accounts = [...grouped.values()].map((group) => {
    const client = group[0].client;
    const baselineTransactions = group.filter((transaction) => String(transaction.reference || '').startsWith('CC-ZERO-BASELINE-2026:'));
    const reconciliationTransactions = group.filter((transaction) => String(transaction.reference || '').startsWith('CASHFLOW-RECONCILIATION-2026:'));
    return {
      clientId: client.id,
      oldId: client.old_id,
      client: client.name,
      status: accountStatus(group, client, shipmentReconciledClientIds),
      transactionCount: group.length,
      balance: round(group.reduce((sum, transaction) => sum + transaction.amount, 0)),
      baselineTransactionCount: baselineTransactions.length,
      baselineAmount: round(baselineTransactions.reduce((sum, transaction) => sum + transaction.amount, 0)),
      reconciliationAdjustmentCount: reconciliationTransactions.length,
      reconciliationAdjustmentAmount: round(reconciliationTransactions.reduce((sum, transaction) => sum + transaction.amount, 0)),
      firstTransactionDate: group[0].date.toISOString().slice(0, 10),
      lastTransactionDate: group[group.length - 1].date.toISOString().slice(0, 10),
    };
  }).sort((left, right) => left.client.localeCompare(right.client));

  const counts = Object.fromEntries(
    [...new Set(accounts.map((account) => account.status))]
      .map((status) => [status, accounts.filter((account) => account.status === status).length]),
  );
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalAccounts: accounts.length,
    nonZeroAccounts: accounts.filter((account) => Math.abs(account.balance) > 0.01).length,
    zeroBalanceAccounts: accounts.filter((account) => Math.abs(account.balance) <= 0.01).length,
    counts,
    accounts: summaryOnly ? undefined : accounts,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
