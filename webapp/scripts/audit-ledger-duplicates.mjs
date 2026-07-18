import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DAYS = Number(process.env.LEDGER_DUPLICATE_LOOKBACK_DAYS || 730);
const ADJUSTMENT_PATTERN = /(ajuste|baseline|opening|neutraliz|duplicate|final-adj|saldo a cero|saldada|zero)/i;

function ledgerSearchText(tx) {
  return `${tx.description || ''} ${tx.reference || ''} ${tx.paymentMethod || ''}`.trim();
}

function isAdjustmentTransaction(tx) {
  return ADJUSTMENT_PATTERN.test(ledgerSearchText(tx));
}

function isQuarantinedLedgerTransaction(tx) {
  return /^CC-Import-/i.test(String(tx.reference || '').trim());
}

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

function documentKey(tx) {
  const text = ledgerSearchText(tx);
  const invoice = text.match(/(?:INV(?:OICE)?|PEDIDO|ORDER)\s*#?\s*(\d+)/i);
  if (invoice) return `DOCUMENT:${invoice[1]}`;

  const shipment = text.match(/(?:ENV[IÍ]O|SHIPMENT|PACKING\s*LIST|\bPL)\s*#?\s*(\d+)/i);
  return shipment ? `SHIPMENT:${shipment[1]}` : null;
}

function orderNumberFromTransaction(tx) {
  const reference = String(tx.reference || '').trim();
  if (/^\d+$/.test(reference)) return Number(reference);

  const match = ledgerSearchText(tx).match(/(?:PEDIDO|ORDER)\s*#?\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function isReversal(tx) {
  return /\b(?:DEVOL(?:UCION)?|RETORNO|REFUND|REVERS)/i.test(String(tx.description || ''));
}

function add(groups, key, tx) {
  const group = groups.get(key) || [];
  group.push(tx);
  groups.set(key, group);
}

function summarize(group) {
  return group.map((tx) => ({
    id: tx.id,
    date: dayKey(tx.date),
    type: tx.type,
    amount: tx.amount,
    description: tx.description || null,
    reference: tx.reference || null,
    paymentMethod: tx.paymentMethod || null,
  }));
}

async function main() {
  const since = new Date();
  since.setDate(since.getDate() - DAYS);
  since.setHours(0, 0, 0, 0);

  const transactions = await prisma.transaction.findMany({
    where: { clientId: { not: null }, date: { gte: since } },
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

  const operational = transactions.filter((tx) => !isAdjustmentTransaction(tx) && !isQuarantinedLedgerTransaction(tx));
  const exactGroups = new Map();
  const documentGroups = new Map();
  const documentOccurrences = new Map();
  const paymentGroups = new Map();
  const orderCharges = [];

  for (const tx of operational) {
    const exactKey = [
      tx.clientId,
      tx.type,
      Math.round(tx.amount * 100),
      dayKey(tx.date),
      normalize(tx.description),
      normalize(tx.reference),
      normalize(tx.paymentMethod),
    ].join('|');
    add(exactGroups, exactKey, tx);

    if (tx.type === 'CARGO' && tx.amount < 0) {
      const document = documentKey(tx);
      if (document) {
        add(documentGroups, [tx.clientId, document, Math.round(Math.abs(tx.amount) * 100)].join('|'), tx);
        add(documentOccurrences, [tx.clientId, document].join('|'), tx);
      }

      const orderNumber = orderNumberFromTransaction(tx);
      if (orderNumber) orderCharges.push({ tx, orderNumber });
    }

    if (tx.type === 'PAGO' && tx.amount > 0) {
      const reference = String(tx.reference || '').trim().toUpperCase();
      if (reference) {
        add(paymentGroups, [
          tx.clientId,
          dayKey(tx.date),
          Math.round(tx.amount * 100),
          reference,
        ].join('|'), tx);
      }
    }
  }

  const exactDuplicates = [...exactGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, client: group[0].client, transactions: summarize(group) }));
  const documentDuplicates = [...documentGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, client: group[0].client, transactions: summarize(group) }));
  const repeatedDocumentGroups = [...documentOccurrences.entries()]
    .filter(([, group]) => group.length > 1);
  const reversalDocuments = repeatedDocumentGroups
    .filter(([, group]) => group.some(isReversal))
    .map(([key, group]) => ({ key, client: group[0].client, transactions: summarize(group) }));
  const repeatedDocuments = repeatedDocumentGroups
    .filter(([, group]) => !group.some(isReversal))
    .map(([key, group]) => ({ key, client: group[0].client, transactions: summarize(group) }));
  const repeatedPayments = [...paymentGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, client: group[0].client, transactions: summarize(group) }));
  const orderNumbers = [...new Set(orderCharges.map(({ orderNumber }) => orderNumber))];
  const orders = orderNumbers.length
    ? await prisma.order.findMany({
      where: { order_number: { in: orderNumbers } },
      select: { order_number: true, clientId: true, total_amount: true, client: { select: { old_id: true, name: true } } },
    })
    : [];
  const orderByNumber = new Map(orders.map((order) => [order.order_number, order]));
  const wrongClientOrderCharges = orderCharges.flatMap(({ tx, orderNumber }) => {
    const order = orderByNumber.get(orderNumber);
    if (!order || order.clientId === tx.clientId) return [];
    return [{
      orderNumber,
      transaction: summarize([tx])[0],
      ledgerClient: tx.client,
      sourceClient: order.client,
      sourceTotal: order.total_amount,
    }];
  });

  const report = {
    generatedAt: new Date().toISOString(),
    lookbackDays: DAYS,
    analyzedTransactions: operational.length,
    exactDuplicates,
    documentDuplicates,
    reversalDocuments,
    repeatedDocuments,
    repeatedPayments,
    wrongClientOrderCharges,
  };

  console.log(JSON.stringify(report, null, 2));
  if (exactDuplicates.length || documentDuplicates.length || repeatedDocuments.length || repeatedPayments.length || wrongClientOrderCharges.length) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
