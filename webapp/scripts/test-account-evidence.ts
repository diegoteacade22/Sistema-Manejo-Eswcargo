import { PrismaClient } from '@prisma/client';
import { createAccountEvidence } from '../lib/account-evidence';

const prisma = new PrismaClient();
const rollbackMarker = 'QA_ACCOUNT_EVIDENCE_ROLLBACK';

async function main() {
  const client = await prisma.client.findFirst({ select: { id: true } });
  if (!client) throw new Error('La base requiere al menos un cliente para verificar evidencia de cuenta.');

  let evidenceCreated = false;
  try {
    await prisma.$transaction(async (tx) => {
      const evidence = await createAccountEvidence(tx, {
        clientId: client.id,
        category: 'QA',
        note: rollbackMarker,
      });
      evidenceCreated = evidence.clientId === client.id && evidence.note === rollbackMarker;
      throw new Error(rollbackMarker);
    }, { isolationLevel: 'Serializable' });
  } catch (error: any) {
    if (error?.message !== rollbackMarker) throw error;
  }

  const persisted = await prisma.accountEvidence.count({ where: { note: rollbackMarker } });
  if (!evidenceCreated || persisted !== 0) {
    throw new Error('La evidencia de cuenta no se creó de forma transaccional o dejó datos de prueba.');
  }

  console.log('OK: la evidencia de cuenta se registra de forma transaccional y no deja datos de prueba.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
