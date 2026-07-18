import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.env.APPLY === '1';
const start = new Date('2026-07-18T08:40:52.706Z');
const end = new Date('2026-07-18T08:40:55.848Z');
const expectedCount = 1133;
const backupDir = join(process.cwd(), 'backups');
const backupPath = join(backupDir, 'ledger-batch-2026-07-18T084052Z.json');

const where = {
  createdAt: { gte: start, lte: end },
  OR: [
    { reference: { startsWith: 'Order #' } },
    { reference: { startsWith: 'Envío #' } },
    { reference: { startsWith: 'PagoExtra-' } },
    { reference: { startsWith: 'Purchase #' } },
    { reference: { startsWith: 'Manual-' } },
  ],
};

async function main() {
  const transactions = await prisma.transaction.findMany({ where, orderBy: { id: 'asc' } });
  const total = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);

  console.log(`${apply ? 'MODO APLICAR' : 'MODO REVISIÓN'}: lote ${transactions.length}/${expectedCount}, total ${total.toFixed(2)}.`);
  if (transactions.length !== expectedCount) {
    throw new Error(`Lote no coincide: se esperaban ${expectedCount} movimientos y se encontraron ${transactions.length}. No se modificó nada.`);
  }

  if (!apply) return;

  mkdirSync(backupDir, { recursive: true });
  writeFileSync(backupPath, JSON.stringify({ exportedAt: new Date().toISOString(), start, end, transactions }, null, 2));
  const deleted = await prisma.transaction.deleteMany({ where: { id: { in: transactions.map((transaction) => transaction.id) } } });
  if (deleted.count !== expectedCount) {
    throw new Error(`Eliminación incompleta: se eliminaron ${deleted.count}/${expectedCount}. Respaldo: ${backupPath}`);
  }

  console.log(`OK: se eliminó el lote duplicado y se guardó el respaldo en ${backupPath}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
