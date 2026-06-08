#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = ['1', 'true', 'yes', 'on'].includes(String(process.env.APPLY || '').toLowerCase());
const adjustmentDate = process.env.ADJUSTMENT_DATE ? new Date(process.env.ADJUSTMENT_DATE) : new Date('2026-01-01T12:00:00.000Z');
const tolerance = 0.005;
const cashFlowOldIds = new Set([162, 70, 66, 273, 72, 214, 147, 119, 174, 96]);

function money(value) {
  return Number(value || 0).toFixed(2);
}

function referenceFor(clientId) {
  return `CC-ZERO-BASELINE-2026:${clientId}`;
}

async function run() {
  const clients = await prisma.client.findMany({
    select: { id: true, old_id: true, name: true },
  });
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const eligibleClientIds = clients
    .filter((client) => !(client.old_id && cashFlowOldIds.has(client.old_id)))
    .map((client) => client.id);

  const balances = await prisma.transaction.groupBy({
    by: ['clientId'],
    where: {
      clientId: { in: eligibleClientIds },
      NOT: { reference: { startsWith: 'CC-ZERO-BASELINE-2026:' } },
    },
    _sum: { amount: true },
  });

  const existingAdjustments = await prisma.transaction.findMany({
    where: {
      clientId: { in: eligibleClientIds },
      reference: { startsWith: 'CC-ZERO-BASELINE-2026:' },
    },
    select: { id: true, clientId: true, amount: true, reference: true },
  });
  const adjustmentByClientId = new Map(existingAdjustments.map((tx) => [tx.clientId, tx]));

  console.log(apply ? 'MODO APLICAR: se crearán/actualizarán ajustes a cero.' : 'MODO REVISION: no se modifica la base.');
  console.log('client_id,old_id,client_name,balance_without_adjustment,adjustment,action');

  let affected = 0;
  let totalAdjustment = 0;

  for (const balance of balances) {
    if (!balance.clientId) continue;
    const client = clientById.get(balance.clientId);
    if (!client) continue;

    const baseBalance = balance._sum.amount || 0;
    if (Math.abs(baseBalance) <= tolerance) continue;

    const adjustment = -baseBalance;
    const existing = adjustmentByClientId.get(client.id);
    let action = existing ? 'WOULD_UPDATE_ZERO_ADJUSTMENT' : 'WOULD_CREATE_ZERO_ADJUSTMENT';
    if (existing && Math.abs(existing.amount - adjustment) <= tolerance) action = 'OK_ZERO';

    if (apply && action !== 'OK_ZERO') {
      const data = {
        clientId: client.id,
        date: adjustmentDate,
        type: adjustment >= 0 ? 'PAGO' : 'CARGO',
        amount: adjustment,
        description: 'Ajuste cuenta corriente a cero - cliente sin CC en CASH FLOW 2026',
        reference: referenceFor(client.id),
        paymentMethod: adjustment >= 0 ? 'AJUSTE' : null,
      };

      if (existing) {
        await prisma.transaction.update({ where: { id: existing.id }, data });
        action = 'UPDATED_ZERO_ADJUSTMENT';
      } else {
        await prisma.transaction.create({ data });
        action = 'CREATED_ZERO_ADJUSTMENT';
      }
    }

    affected++;
    totalAdjustment += adjustment;
    console.log([
      client.id,
      client.old_id || '',
      `"${client.name.replaceAll('"', '""')}"`,
      money(baseBalance),
      money(adjustment),
      action,
    ].join(','));
  }

  console.log(`TOTAL_CLIENTS,${affected}`);
  console.log(`TOTAL_ADJUSTMENT,${money(totalAdjustment)}`);
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
