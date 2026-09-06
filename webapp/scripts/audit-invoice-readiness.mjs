import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { activeInvoiceItems, activeInvoiceTotal } from './invoice-readiness-policy.mjs';

const prisma = new PrismaClient();

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function main() {
  const seedPath = path.join(process.cwd(), 'prisma', 'orders_seed.json');
  if (!fs.existsSync(seedPath)) {
    throw new Error('Falta el snapshot de pedidos para auditar invoices.');
  }

  const sourceByNumber = new Map();
  for (const order of JSON.parse(fs.readFileSync(seedPath, 'utf8'))) {
    if (Number.isInteger(order?.order_number)) sourceByNumber.set(order.order_number, order);
  }

  const sourceOrders = [...sourceByNumber.values()]
    .filter((order) => activeInvoiceItems(order.items).length > 0);
  if (!sourceOrders.length) {
    console.log('✅ Auditoría de invoices omitida: la actualización no contiene pedidos con productos.');
    return;
  }

  const orderNumbers = sourceOrders.map((order) => order.order_number);
  const dbOrders = await prisma.order.findMany({
    where: { order_number: { in: orderNumbers } },
    select: {
      order_number: true,
      total_amount: true,
      items: { select: { quantity: true, unit_price: true } },
    },
  });
  const dbByNumber = new Map(dbOrders.map((order) => [order.order_number, order]));
  const issues = [];

  for (const source of sourceOrders) {
    const sourceTotal = roundMoney(activeInvoiceTotal(source.items));
    const dbOrder = dbByNumber.get(source.order_number);
    if (!dbOrder) {
      issues.push(`#${source.order_number}: el pedido no existe en la base.`);
      continue;
    }
    if (!dbOrder.items.length) {
      issues.push(`#${source.order_number}: se importó sin productos.`);
      continue;
    }
    if (sourceTotal > 0 && Number(dbOrder.total_amount || 0) <= 0) {
      issues.push(`#${source.order_number}: fuente USD ${sourceTotal.toFixed(2)} pero base USD ${Number(dbOrder.total_amount || 0).toFixed(2)}.`);
    }
  }

  if (issues.length) {
    console.error(`Invoices no listos: ${issues.join('; ')}`);
    process.exitCode = 1;
    return;
  }

  console.log(`✅ Auditoría de invoices OK: ${sourceOrders.length} pedidos con productos verificados.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
