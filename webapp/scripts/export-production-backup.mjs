import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { PrismaClient } from '@prisma/client';

const tables = [
  'Client',
  'User',
  'Product',
  'SparePart',
  'Supplier',
  'Order',
  'OrderItem',
  'Transaction',
  'Shipment',
  'Purchase',
  'PurchaseItem',
  'PurchaseAllocation',
  'PurchasePayment',
  'PaymentReceipt',
  'Expense',
  'ManualPackingItem',
  'SupplierProduct',
];

const outputPath = process.argv[2];
if (!outputPath) {
  throw new Error('Uso: node scripts/export-production-backup.mjs <archivo.json.gz>');
}

const prisma = new PrismaClient();

function serialize(value) {
  if (typeof value === 'bigint') return { type: 'bigint', value: value.toString() };
  if (Buffer.isBuffer(value)) return { type: 'bytes', base64: value.toString('base64') };
  return value;
}

async function main() {
  const snapshot = {
    createdAt: new Date().toISOString(),
    format: 'eswcargo-production-backup-v1',
    tables: {},
  };

  for (const table of tables) {
    const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "${table}"`);
    snapshot.tables[table] = rows;
    console.log(`${table}: ${rows.length} filas`);
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const contents = JSON.stringify(snapshot, (_, value) => serialize(value));
  await fs.writeFile(outputPath, gzipSync(contents));
  console.log(`Respaldo creado: ${outputPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
