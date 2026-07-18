import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const baselineCount = await prisma.transaction.count({
    where: {
      reference: { startsWith: 'CC-ZERO-BASELINE-2026:' },
    },
  });

  const legacyImportCount = await prisma.transaction.count({
    where: { reference: { startsWith: 'CC-Import-' } },
  });

  // A legacy balance is not evidence of an error. This entrypoint is kept as
  // a review tool so a maintenance flag cannot erase financial history.
  console.log(`Revisión CC legacy: ${legacyImportCount} movimiento(s) CC-Import-* en cuarentena.`);
  console.log(`Revisión baseline histórico: ${baselineCount} ajuste(s) preservados; la cobertura indica cuáles requieren evidencia.`);
  console.log('No se eliminó ningún movimiento. Una corrección requiere fuente verificable y respaldo reversible.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
