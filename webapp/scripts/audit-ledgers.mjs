import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MAX_REASONABLE_DEBT = Number(process.env.LEDGER_AUDIT_MAX_DEBT || 100000);
const MAX_BASELINE_ONLY_BALANCE = Number(process.env.LEDGER_AUDIT_MAX_BASELINE_ONLY || 5000);
const MAX_NAN_CLIENT_BALANCE = Number(process.env.LEDGER_AUDIT_MAX_NAN_BALANCE || 1000);
const DUPLICATE_LOOKBACK_DAYS = Number(process.env.LEDGER_AUDIT_DUPLICATE_LOOKBACK_DAYS || 120);

function money(value) {
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

async function main() {
  const issues = [];
  const warnings = [];

  const balances = await prisma.transaction.groupBy({
    by: ['clientId'],
    where: { clientId: { not: null } },
    _sum: { amount: true },
    _count: { _all: true },
  });

  const clientIds = balances.map((balance) => balance.clientId).filter(Boolean);
  const clients = await prisma.client.findMany({
    where: { id: { in: clientIds } },
    select: { id: true, old_id: true, name: true },
  });
  const clientById = new Map(clients.map((client) => [client.id, client]));

  const wrongSignTransactions = await prisma.transaction.findMany({
    where: {
      OR: [
        { type: 'PAGO', amount: { lt: 0 } },
        { type: 'CARGO', amount: { gt: 0 } },
      ],
    },
    select: {
      id: true,
      clientId: true,
      type: true,
      amount: true,
      description: true,
      client: { select: { id: true, old_id: true, name: true } },
    },
    take: 20,
  });
  for (const tx of wrongSignTransactions) {
    const client = tx.client;
    issues.push(`Movimiento con signo incorrecto: tx ${tx.id} ${tx.type} $${money(tx.amount)} ${client?.name || 'sin cliente'} (#${client?.old_id ?? client?.id ?? tx.clientId ?? '-'}) ${tx.description || ''}`);
  }

  for (const balance of balances) {
    const amount = balance._sum.amount || 0;
    const client = clientById.get(balance.clientId);
    if (!client) continue;

    if (amount < -MAX_REASONABLE_DEBT) {
      issues.push(`Saldo deudor absurdo: ${client.name} (#${client.old_id ?? client.id}) = -$${money(Math.abs(amount))}`);
    }

    if (String(client.name || '').trim().toLowerCase() === 'nan' && Math.abs(amount) > MAX_NAN_CLIENT_BALANCE) {
      issues.push(`Cliente sin nombre con saldo relevante: id ${client.id} old_id ${client.old_id ?? '-'} = $${money(amount)}`);
    }
  }

  const baselines = await prisma.transaction.findMany({
    where: { reference: { startsWith: 'CC-ZERO-BASELINE-2026:' } },
    select: {
      id: true,
      clientId: true,
      amount: true,
      reference: true,
      client: { select: { id: true, old_id: true, name: true } },
    },
  });
  const groupedByClient = new Map(balances.map((balance) => [balance.clientId, balance]));

  for (const baseline of baselines) {
    const group = groupedByClient.get(baseline.clientId);
    const txCount = group?._count?._all || 0;
    const balance = group?._sum?.amount || 0;
    const client = baseline.client;
    const label = `${client?.name || 'Cliente sin nombre'} (#${client?.old_id ?? client?.id ?? baseline.clientId})`;

    if (txCount === 1 && Math.abs(baseline.amount) > MAX_BASELINE_ONLY_BALANCE) {
      issues.push(`Ajuste baseline unico crea saldo artificial: ${label} baseline $${money(baseline.amount)} balance $${money(balance)}`);
    } else if (Math.abs(baseline.amount) > MAX_REASONABLE_DEBT && Math.abs(balance) > MAX_NAN_CLIENT_BALANCE) {
      issues.push(`Ajuste baseline gigante deja saldo activo: ${label} baseline $${money(baseline.amount)} balance $${money(balance)}`);
    } else if (Math.abs(baseline.amount) > MAX_REASONABLE_DEBT) {
      warnings.push(`Ajuste baseline grande compensado: ${label} baseline $${money(baseline.amount)} balance $${money(balance)}`);
    }
  }

  const nameGroups = new Map();
  for (const client of clients) {
    const key = String(client.name || '').trim().toLowerCase();
    if (!key || key === 'nan') continue;
    if (!nameGroups.has(key)) nameGroups.set(key, []);
    nameGroups.get(key).push(client);
  }
  for (const [name, group] of nameGroups.entries()) {
    if (group.length <= 1) continue;
    const nonZero = group
      .map((client) => {
        const balance = balances.find((item) => item.clientId === client.id)?._sum?.amount || 0;
        return { client, balance };
      })
      .filter((item) => Math.abs(item.balance) > 0.01);

    if (nonZero.length > 1) {
      warnings.push(`Nombre duplicado con mas de una cuenta con saldo: ${name} -> ${nonZero.map((item) => `id ${item.client.id}: $${money(item.balance)}`).join(', ')}`);
    }
  }

  const duplicateSince = new Date();
  duplicateSince.setDate(duplicateSince.getDate() - DUPLICATE_LOOKBACK_DAYS);
  duplicateSince.setHours(0, 0, 0, 0);

  const recentPayments = await prisma.transaction.findMany({
    where: {
      type: 'PAGO',
      clientId: { not: null },
      amount: { gt: 0 },
      date: { gte: duplicateSince },
    },
    select: {
      id: true,
      clientId: true,
      date: true,
      amount: true,
      paymentMethod: true,
      reference: true,
      description: true,
      client: { select: { id: true, old_id: true, name: true } },
    },
    orderBy: { date: 'desc' },
  });
  const paymentGroups = new Map();
  for (const payment of recentPayments) {
    const key = [
      payment.clientId,
      payment.date.toISOString().slice(0, 10),
      Math.round(payment.amount * 100),
      payment.paymentMethod || '',
      payment.reference || '',
    ].join('|');
    if (!paymentGroups.has(key)) paymentGroups.set(key, []);
    paymentGroups.get(key).push(payment);
  }
  for (const group of paymentGroups.values()) {
    if (group.length <= 1) continue;
    const first = group[0];
    warnings.push(`Posible pago duplicado: ${first.client?.name || 'sin cliente'} (#${first.client?.old_id ?? first.client?.id ?? first.clientId}) ${first.date.toISOString().slice(0, 10)} $${money(first.amount)} refs [${group.map((tx) => tx.id).join(', ')}]`);
  }

  if (warnings.length) {
    console.warn('Advertencias de auditoria CC:');
    for (const warning of warnings) console.warn(`- ${warning}`);
  }

  if (issues.length) {
    console.error('Auditoria CC bloqueada:');
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }

  console.log(`Auditoria CC OK: ${balances.length} cuentas revisadas.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
