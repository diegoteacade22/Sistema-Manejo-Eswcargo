#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = ['1', 'true', 'yes', 'on'].includes(String(process.env.APPLY || '').toLowerCase());
const adjustmentDate = process.env.ADJUSTMENT_DATE ? new Date(process.env.ADJUSTMENT_DATE) : new Date('2026-01-01T12:00:00.000Z');
const tolerance = 0.005;

const cashFlowTargets = [
  { sheet: 'MARCOS CC', oldId: 162, nameHint: 'Marcos Roku', targetBalance: 4491 },
  { sheet: 'AYLEN CC', oldId: 70, nameHint: 'Aylen Gentiletti', targetBalance: -315 },
  { sheet: 'FACU FABRI CC', oldId: 66, nameHint: 'Facu Fabriccini', targetBalance: -3588.375 },
  { sheet: 'MOLINA OCT', oldId: 273, nameHint: 'Octavio Molina', targetBalance: -1194 },
  { sheet: 'RAMIRO STRAR CC', oldId: 72, nameHint: 'Ramiro Star Computacion', targetBalance: 0.5 },
  { sheet: 'LUCA CC', oldId: 214, nameHint: 'Luca', targetBalance: 0 },
  { sheet: 'SEBAS LUC CC', oldId: 147, nameHint: 'Sebas Luc', targetBalance: -6750 },
  { sheet: 'TOMAS CC', oldId: 119, nameHint: 'Tomas', targetBalance: 0 },
  { sheet: 'GONZALO CC', oldId: 174, nameHint: 'Gonzalo', targetBalance: 0 },
  { sheet: 'NAHUEL CC', oldId: 96, nameHint: 'Nahuel', targetBalance: 0 },
];

function money(value) {
  return Number(value || 0).toFixed(2);
}

function referenceFor(row) {
  return `CASHFLOW-OPENING-2026:${row.oldId}`;
}

async function findClient(row) {
  const byOldId = await prisma.client.findUnique({
    where: { old_id: row.oldId },
    select: { id: true, old_id: true, name: true },
  });
  if (byOldId) return byOldId;

  return prisma.client.findFirst({
    where: { name: { contains: row.nameHint } },
    select: { id: true, old_id: true, name: true },
  });
}

async function currentBalanceWithoutAdjustment(clientId, adjustmentReference) {
  const result = await prisma.transaction.aggregate({
    where: {
      clientId,
      NOT: { reference: adjustmentReference },
    },
    _sum: { amount: true },
  });
  return result._sum.amount || 0;
}

async function currentBalance(clientId) {
  const result = await prisma.transaction.aggregate({
    where: { clientId },
    _sum: { amount: true },
  });
  return result._sum.amount || 0;
}

async function run() {
  console.log(apply ? 'MODO APLICAR: se crearán/actualizarán ajustes.' : 'MODO REVISION: no se modifica la base.');
  console.log('sheet,client_id,old_id,client_name,current_without_adjustment,current_total,target,adjustment,action');

  for (const row of cashFlowTargets) {
    const client = await findClient(row);
    if (!client) {
      console.log(`${row.sheet},,,${row.nameHint},,${money(row.targetBalance)},,CLIENT_NOT_FOUND`);
      continue;
    }

    const reference = referenceFor(row);
    const baseBalance = await currentBalanceWithoutAdjustment(client.id, reference);
    const adjustment = row.targetBalance - baseBalance;
    const existing = await prisma.transaction.findFirst({
      where: { clientId: client.id, reference },
      select: { id: true, amount: true },
    });
    const actualBalance = await currentBalance(client.id);

    let action = existing ? 'WOULD_UPDATE_ADJUSTMENT' : 'WOULD_CREATE_ADJUSTMENT';
    if (existing && Math.abs(existing.amount - adjustment) <= tolerance && Math.abs(actualBalance - row.targetBalance) <= tolerance) {
      action = 'OK_MATCHES_TARGET';
    }
    if (Math.abs(adjustment) <= tolerance) action = existing ? 'WOULD_ZERO_ADJUSTMENT' : 'OK_NO_ADJUSTMENT';

    if (apply && !['OK_NO_ADJUSTMENT', 'OK_MATCHES_TARGET'].includes(action)) {
      const data = {
        clientId: client.id,
        date: adjustmentDate,
        type: adjustment >= 0 ? 'PAGO' : 'CARGO',
        amount: adjustment,
        description: `Ajuste saldo inicial CASH FLOW 2026 - ${row.sheet}`,
        reference,
        paymentMethod: adjustment >= 0 ? 'AJUSTE' : null,
      };

      if (existing) {
        await prisma.transaction.update({ where: { id: existing.id }, data });
        action = 'UPDATED_ADJUSTMENT';
      } else {
        await prisma.transaction.create({ data });
        action = 'CREATED_ADJUSTMENT';
      }
    }

    console.log([
      row.sheet,
      client.id,
      client.old_id || '',
      `"${client.name.replaceAll('"', '""')}"`,
      money(baseBalance),
      money(actualBalance),
      money(row.targetBalance),
      money(adjustment),
      action,
    ].join(','));
  }
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
