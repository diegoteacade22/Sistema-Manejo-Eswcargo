import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const rollbackMarker = 'QA_GUARD_ROLLBACK';

async function main() {
  const [client, purchaseItem] = await Promise.all([
    prisma.client.findFirst({ select: { id: true } }),
    prisma.purchaseItem.findFirst({
      where: { quantity: { gt: 0 } },
      select: { id: true, quantity: true, allocated_quantity: true },
    }),
  ]);

  if (!client || !purchaseItem) {
    throw new Error('La base requiere al menos un cliente y un ítem de compra para verificar los controles.');
  }

  const availableQuantity = purchaseItem.quantity - purchaseItem.allocated_quantity;
  if (availableQuantity <= 0) {
    throw new Error('No hay un ítem de compra con cantidad disponible para verificar la reserva atómica.');
  }

  let allocationBlocked = false;
  try {
    await prisma.$transaction(async (tx) => {
      const reserved = await tx.purchaseItem.updateMany({
        where: {
          id: purchaseItem.id,
          allocated_quantity: { lte: purchaseItem.quantity - availableQuantity },
        },
        data: { allocated_quantity: { increment: availableQuantity } },
      });
      if (reserved.count !== 1) throw new Error('No se pudo reservar la cantidad disponible de prueba.');

      const duplicateReservation = await tx.purchaseItem.updateMany({
        where: {
          id: purchaseItem.id,
          allocated_quantity: { lte: purchaseItem.quantity - 1 },
        },
        data: { allocated_quantity: { increment: 1 } },
      });
      if (duplicateReservation.count !== 0) {
        throw new Error('La reserva atómica permitió superar la cantidad disponible.');
      }
      throw new Error(rollbackMarker);
    }, { isolationLevel: 'Serializable' });
  } catch (error: any) {
    if (error?.message !== rollbackMarker) throw error;
    allocationBlocked = true;
  }

  const submissionKey = `QA-ORDER-GUARD-${Date.now()}`;
  let orderReplayBlocked = false;
  try {
    await prisma.$transaction(async (tx) => {
      const firstOrder = await tx.order.create({
        data: {
          clientId: client.id,
          date: new Date(),
          status: 'QA_GUARD',
          total_amount: 0,
          currency: 'USD',
          source: 'QA_GUARD',
        },
      });
      await tx.orderSubmissionGuard.create({
        data: { submissionKey, orderId: firstOrder.id },
      });

      const duplicateOrder = await tx.order.create({
        data: {
          clientId: client.id,
          date: new Date(),
          status: 'QA_GUARD',
          total_amount: 0,
          currency: 'USD',
          source: 'QA_GUARD',
        },
      });
      await tx.orderSubmissionGuard.create({
        data: { submissionKey, orderId: duplicateOrder.id },
      });
      throw new Error('La clave de idempotencia permitió crear un pedido duplicado.');
    }, { isolationLevel: 'Serializable' });
  } catch (error: any) {
    if (error?.code !== 'P2002') throw error;
    orderReplayBlocked = true;
  } finally {
    await prisma.$disconnect();
  }

  if (!allocationBlocked || !orderReplayBlocked) {
    throw new Error('Los controles de reserva o idempotencia no bloquearon el escenario de prueba.');
  }

  console.log('OK: la reserva de compras y la idempotencia de pedidos bloquean duplicaciones sin persistir datos de prueba.');
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
