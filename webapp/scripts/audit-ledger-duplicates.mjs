import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { documentKey, shipmentNumberFromTransaction } from './ledger-audit-reference.mjs';

const prisma = new PrismaClient();
const LOOKBACK_DAYS = Number(process.env.LEDGER_DUPLICATE_LOOKBACK_DAYS || 0);
const ADJUSTMENT_PATTERN = /(ajuste|baseline|opening|neutraliz|duplicate|final-adj|saldo a cero|saldada|zero)/i;
const auditExceptions = JSON.parse(readFileSync(new URL('./ledger-audit-exceptions.json', import.meta.url), 'utf8'));
const documentedRepeatedReferences = new Map(
  (auditExceptions.documentedRepeatedReferences || []).map((entry) => [entry.key, entry]),
);

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
  const since = LOOKBACK_DAYS > 0 ? new Date() : null;
  if (since) {
    since.setDate(since.getDate() - LOOKBACK_DAYS);
    since.setHours(0, 0, 0, 0);
  }

  const transactions = await prisma.transaction.findMany({
    where: {
      clientId: { not: null },
      ...(since ? { date: { gte: since } } : {}),
    },
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
  const shipmentCharges = [];

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

      const shipmentNumber = shipmentNumberFromTransaction(tx);
      if (shipmentNumber) shipmentCharges.push({ tx, shipmentNumber });
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
  const documentedRepeatedDocuments = repeatedDocumentGroups
    .filter(([key, group]) => !group.some(isReversal) && documentedRepeatedReferences.has(key))
    .map(([key, group]) => ({
      key,
      client: group[0].client,
      transactions: summarize(group),
      evidence: documentedRepeatedReferences.get(key),
    }));
  const repeatedDocuments = repeatedDocumentGroups
    .filter(([key, group]) => !group.some(isReversal) && !documentedRepeatedReferences.has(key))
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
  const shipmentNumbers = [...new Set(shipmentCharges.map(({ shipmentNumber }) => shipmentNumber))];
  const shipments = shipmentNumbers.length
    ? await prisma.shipment.findMany({
      where: { shipment_number: { in: shipmentNumbers } },
      select: {
        shipment_number: true,
        client: { select: { id: true, old_id: true, name: true } },
        items: { select: { order: { select: { client: { select: { id: true, old_id: true, name: true } } } } } },
        orders: { select: { client: { select: { id: true, old_id: true, name: true } } } },
      },
    })
    : [];
  const shipmentByNumber = new Map(shipments.map((shipment) => [shipment.shipment_number, shipment]));
  const shipmentChargeChecks = shipmentCharges.map(({ tx, shipmentNumber }) => {
    const shipment = shipmentByNumber.get(shipmentNumber);
    const owners = new Map();
    for (const item of shipment?.items || []) {
      const client = item.order?.client;
      if (client) owners.set(client.id, client);
    }
    for (const order of shipment?.orders || []) {
      const client = order.client;
      if (client) owners.set(client.id, client);
    }
    if (owners.size === 0 && shipment?.client) owners.set(shipment.client.id, shipment.client);
    return { tx, shipmentNumber, owners: [...owners.values()] };
  });
  const wrongClientShipmentCharges = shipmentChargeChecks
    .filter(({ tx, owners }) => owners.length === 1 && owners[0].id !== tx.clientId)
    .map(({ tx, shipmentNumber, owners }) => ({
      shipmentNumber,
      transaction: summarize([tx])[0],
      ledgerClient: tx.client,
      sourceClient: owners[0],
    }));
  const ambiguousShipmentCharges = shipmentChargeChecks
    .filter(({ owners }) => owners.length !== 1)
    .map(({ tx, shipmentNumber, owners }) => ({
      shipmentNumber,
      transaction: summarize([tx])[0],
      sourceClients: owners,
    }));

  const report = {
    generatedAt: new Date().toISOString(),
    lookbackDays: LOOKBACK_DAYS || null,
    analyzedTransactions: operational.length,
    exactDuplicates,
    documentDuplicates,
    reversalDocuments,
    documentedRepeatedDocuments,
    repeatedDocuments,
    repeatedPayments,
    wrongClientOrderCharges,
    wrongClientShipmentCharges,
    ambiguousShipmentCharges,
  };

  console.log(JSON.stringify(report, null, 2));
  if (exactDuplicates.length || documentDuplicates.length || repeatedDocuments.length || repeatedPayments.length || wrongClientOrderCharges.length || wrongClientShipmentCharges.length || ambiguousShipmentCharges.length) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
