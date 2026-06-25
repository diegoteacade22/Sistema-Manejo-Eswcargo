import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const legacyImports = await prisma.transaction.deleteMany({
    where: { reference: { startsWith: 'CC-Import-' } },
  });

  const baselineOnlyCandidates = await prisma.transaction.findMany({
    where: {
      reference: { startsWith: 'CC-ZERO-BASELINE-2026:' },
      clientId: { not: null },
      amount: { lt: -5000 },
    },
    select: {
      id: true,
      clientId: true,
      amount: true,
    },
  });

  const baselineOnlyIds = [];
  for (const candidate of baselineOnlyCandidates) {
    const managedCount = await prisma.transaction.count({
      where: {
        clientId: candidate.clientId,
        NOT: { reference: { startsWith: 'CC-Import-' } },
      },
    });

    if (managedCount === 1) {
      baselineOnlyIds.push(candidate.id);
    }
  }

  const baselineOnly = baselineOnlyIds.length
    ? await prisma.transaction.deleteMany({ where: { id: { in: baselineOnlyIds } } })
    : { count: 0 };

  console.log(`Limpieza CC legacy: ${legacyImports.count} movimientos CC-Import-* eliminados.`);
  console.log(`Limpieza baseline artificial: ${baselineOnly.count} ajustes únicos eliminados.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
