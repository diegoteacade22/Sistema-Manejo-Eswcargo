import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [client, purchase] = await Promise.all([
    prisma.client.findFirst({ select: { id: true } }),
    prisma.purchase.findFirst({ select: { id: true, supplierId: true } }),
  ]);

  if (!client || !purchase) {
    throw new Error('La base requiere al menos un cliente y una compra para verificar los controles financieros.');
  }

  const clientId = client.id;
  const purchaseId = purchase.id;
  const supplierId = purchase.supplierId;

  const token = `QA-GUARD-${Date.now()}`;
  let shipmentBlocked = false;
  let supplierPaymentBlocked = false;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.transaction.create({
        data: {
          clientId,
          type: 'CARGO',
          amount: -1,
          date: new Date(),
          description: 'QA financial guard',
          reference: `SHIP-${token}`,
        },
      });
      await tx.transaction.create({
        data: {
          clientId,
          type: 'CARGO',
          amount: -1,
          date: new Date(),
          description: 'QA financial guard duplicate',
          reference: `SHIP-${token}`,
        },
      });
      throw new Error('El control de cargos de envío permitió un duplicado.');
    }, { isolationLevel: 'Serializable' });
  } catch (error: any) {
    if (error?.code !== 'P2002') throw error;
    shipmentBlocked = true;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const firstPayment = await tx.purchasePayment.create({
        data: {
          purchaseId,
          supplierId,
          amount: 1,
          date: new Date(),
          reference: token,
        },
      });
      await tx.purchasePaymentGuard.create({
        data: {
          purchaseId,
          purchasePaymentId: firstPayment.id,
          paymentDate: new Date(),
          amount: 1,
          referenceKey: token,
        },
      });
      const duplicatePayment = await tx.purchasePayment.create({
        data: {
          purchaseId,
          supplierId,
          amount: 1,
          date: new Date(),
          reference: token,
        },
      });
      await tx.purchasePaymentGuard.create({
        data: {
          purchaseId,
          purchasePaymentId: duplicatePayment.id,
          paymentDate: new Date(),
          amount: 1,
          referenceKey: token,
        },
      });
      throw new Error('El control de pagos a proveedor permitió un duplicado.');
    }, { isolationLevel: 'Serializable' });
  } catch (error: any) {
    if (error?.code !== 'P2002') throw error;
    supplierPaymentBlocked = true;
  } finally {
    await prisma.$disconnect();
  }

  if (!shipmentBlocked || !supplierPaymentBlocked) {
    throw new Error('Los controles financieros no bloquearon ambas duplicaciones de prueba.');
  }

  console.log('OK: los controles de cargos de envío y pagos a proveedor bloquean duplicados sin persistir datos de prueba.');
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
