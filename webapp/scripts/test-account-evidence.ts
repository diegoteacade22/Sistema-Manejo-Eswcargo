import { PrismaClient } from '@prisma/client';
import { createAccountEvidence } from '../lib/account-evidence';

const prisma = new PrismaClient();
const rollbackMarker = 'QA_ACCOUNT_EVIDENCE_ROLLBACK';

async function main() {
  const transaction = await prisma.transaction.findFirst({
    where: { clientId: { not: null } },
    select: { id: true, clientId: true, date: true, type: true, amount: true, reference: true },
  });
  if (!transaction?.clientId) throw new Error('La base requiere un movimiento de cliente para verificar evidencia de cuenta.');
  const otherTransaction = await prisma.transaction.findFirst({
    where: { clientId: { not: null, notIn: [transaction.clientId] } },
    select: { id: true },
  });

  let evidenceCreated = false;
  const nonce = Date.now().toString();
  const evidenceFile = new File([Buffer.from(`%PDF-1.4\n% evidencia QA ${nonce}\n`)], `qa-${nonce}.pdf`, { type: 'application/pdf' });
  let unlinkedReceiptRejected = false;
  try {
    await createAccountEvidence(prisma, {
      clientId: transaction.clientId,
      category: 'PAYMENT_RECEIPT',
      evidenceFile,
    });
  } catch {
    unlinkedReceiptRejected = true;
  }
  if (!unlinkedReceiptRejected) throw new Error('Se aceptó un recibo de pago sin movimiento vinculado.');

  try {
    await prisma.$transaction(async (tx) => {
      const result = await createAccountEvidence(tx, {
        clientId: transaction.clientId!,
        transactionId: transaction.id,
        category: 'QA',
        note: rollbackMarker,
        evidenceFile,
      });
      if (!result.created) throw new Error('La primera evidencia QA fue tratada como duplicada.');
      evidenceCreated = result.evidence.clientId === transaction.clientId
        && result.evidence.note === rollbackMarker
        && result.evidence.transactionId === transaction.id
        && result.evidence.transactionReference === transaction.reference
        && result.evidence.transactionType === transaction.type
        && result.evidence.transactionAmount === transaction.amount;

      const duplicate = await createAccountEvidence(tx, {
        clientId: transaction.clientId!,
        transactionId: transaction.id,
        category: 'QA',
        note: rollbackMarker,
        evidenceFile,
      });
      if (duplicate.created) throw new Error('No se detectó el comprobante duplicado.');

      if (otherTransaction) {
        let crossAccountLinkBlocked = false;
        await tx.$executeRawUnsafe('SAVEPOINT account_evidence_trigger_test');
        try {
          await tx.accountEvidence.create({
            data: {
              clientId: transaction.clientId!,
              transactionId: otherTransaction.id,
              category: 'QA',
              note: rollbackMarker,
            },
          });
        } catch {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT account_evidence_trigger_test');
          crossAccountLinkBlocked = true;
        }
        if (!crossAccountLinkBlocked) throw new Error('La base permitió vincular evidencia a un movimiento de otra cuenta.');
      }
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
