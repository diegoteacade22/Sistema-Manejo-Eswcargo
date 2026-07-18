import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DAYS = Number(process.env.SUPPLIER_LEDGER_AUDIT_LOOKBACK_DAYS || 730);
const EPSILON = 0.01;

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function add(groups, key, transaction) {
  const group = groups.get(key) || [];
  group.push(transaction);
  groups.set(key, group);
}

function summarize(transactions) {
  return transactions.map((transaction) => ({
    id: transaction.id,
    date: dayKey(transaction.date),
    type: transaction.type,
    amount: money(transaction.amount),
    description: transaction.description || null,
    reference: transaction.reference || null,
    paymentMethod: transaction.paymentMethod || null,
  }));
}

function purchaseIdFromDescription(description) {
  const match = String(description || '').match(/\bcompra\s*#\s*(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

async function main() {
  const since = new Date();
  since.setDate(since.getDate() - DAYS);
  since.setHours(0, 0, 0, 0);

  const transactions = await prisma.transaction.findMany({
    where: { supplierId: { not: null }, date: { gte: since } },
    select: {
      id: true,
      supplierId: true,
      date: true,
      type: true,
      amount: true,
      description: true,
      reference: true,
      paymentMethod: true,
      supplier: { select: { id: true, name: true } },
    },
    orderBy: [{ supplierId: 'asc' }, { date: 'asc' }, { id: 'asc' }],
  });

  const exactGroups = new Map();
  const settlementGroups = new Map();
  const referencedPurchaseIds = new Set();

  for (const transaction of transactions) {
    const exactKey = [
      transaction.supplierId,
      transaction.type,
      Math.round(transaction.amount * 100),
      dayKey(transaction.date),
      normalize(transaction.description),
      normalize(transaction.reference),
      normalize(transaction.paymentMethod),
    ].join('|');
    add(exactGroups, exactKey, transaction);

    const purchaseId = purchaseIdFromDescription(transaction.description);
    if (purchaseId) referencedPurchaseIds.add(purchaseId);

    const reference = normalize(transaction.reference);
    if (reference) add(settlementGroups, `${transaction.supplierId}|${reference}`, transaction);
  }

  const purchases = await prisma.purchase.findMany({
    where: { id: { in: [...referencedPurchaseIds] } },
    select: { id: true, invoice_number: true, supplierId: true, total_amount: true },
  });
  const purchaseById = new Map(purchases.map((purchase) => [purchase.id, purchase]));

  const exactDuplicates = [...exactGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, supplier: group[0].supplier, transactions: summarize(group) }));

  const amountMismatches = [];
  for (const [key, group] of settlementGroups.entries()) {
    const charges = group.filter((transaction) => transaction.type === 'CARGO' && transaction.amount < 0);
    const payments = group.filter((transaction) => transaction.type === 'PAGO' && transaction.amount > 0);
    if (!charges.length || !payments.length) continue;

    const charged = money(charges.reduce((total, transaction) => total + Math.abs(transaction.amount), 0));
    const paid = money(payments.reduce((total, transaction) => total + transaction.amount, 0));
    if (Math.abs(charged - paid) > EPSILON) {
      amountMismatches.push({
        key,
        supplier: group[0].supplier,
        charged,
        paid,
        difference: money(paid - charged),
        transactions: summarize(group),
      });
    }
  }

  const unlinkedPurchaseReferences = transactions
    .filter((transaction) => transaction.type === 'CARGO' && transaction.amount < 0)
    .map((transaction) => ({ transaction, purchaseId: purchaseIdFromDescription(transaction.description) }))
    .filter(({ purchaseId }) => purchaseId && !purchaseById.has(purchaseId))
    .map(({ transaction, purchaseId }) => ({
      supplier: transaction.supplier,
      purchaseId,
      transaction: summarize([transaction])[0],
    }));

  const report = {
    generatedAt: new Date().toISOString(),
    lookbackDays: DAYS,
    analyzedTransactions: transactions.length,
    exactDuplicates,
    amountMismatches,
    unlinkedPurchaseReferences,
  };

  console.log(JSON.stringify(report, null, 2));
  if (exactDuplicates.length || amountMismatches.length || unlinkedPurchaseReferences.length) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
