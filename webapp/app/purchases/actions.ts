'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requireAdminUser } from '@/lib/access';

type CreatePurchaseItemInput = {
  productId: number;
  quantity: number;
  unit_cost: number;
};

type CreatePurchaseInput = {
  supplierId: number;
  date: Date;
  invoice_number?: string;
  payment_method?: string;
  notes?: string;
  items: CreatePurchaseItemInput[];
};

type AssignPurchaseInput = {
  purchaseItemId: number;
  clientId: number;
  quantity: number;
  unitPrice: number;
  notes?: string;
};

async function getNextOrderNumber(tx: any) {
  const lastOrder = await tx.order.findFirst({ orderBy: { order_number: 'desc' } });
  return (lastOrder?.order_number || 0) + 1;
}

async function findOpenOrderForClient(tx: any, clientId: number) {
  return tx.order.findFirst({
    where: {
      clientId,
      status: {
        notIn: ['VENDIDO', 'CANCELADO', 'ENTREGADO']
      }
    },
    orderBy: [
      { date: 'desc' },
      { id: 'desc' }
    ]
  });
}

async function upsertOrderChargeTransaction(tx: any, order: { id: number; order_number: number | null; clientId: number; total_amount: number }) {
  if (!order.order_number) return;

  const txRef = String(order.order_number);
  const existingCharge = await tx.transaction.findFirst({
    where: {
      clientId: order.clientId,
      type: 'CARGO',
      reference: txRef,
    }
  });

  if (existingCharge) {
    await tx.transaction.update({
      where: { id: existingCharge.id },
      data: {
        amount: -Math.abs(order.total_amount),
        description: `Pedido #${order.order_number}`,
      }
    });
    return;
  }

  await tx.transaction.create({
    data: {
      clientId: order.clientId,
      date: new Date(),
      type: 'CARGO',
      amount: -Math.abs(order.total_amount),
      description: `Pedido #${order.order_number}`,
      reference: txRef
    }
  });
}

export async function createPurchase(data: CreatePurchaseInput) {
  await requireAdminUser();

  if (!data.supplierId || !data.items?.length) {
    return { success: false, message: 'Proveedor e ítems son requeridos.' };
  }

  const validItems = data.items.filter((item) => item.quantity > 0 && item.unit_cost >= 0);
  if (!validItems.length) {
    return { success: false, message: 'Debes cargar al menos un ítem válido.' };
  }

  try {
    const productIds = [...new Set(validItems.map((item) => item.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, sku: true, name: true }
    });

    if (products.length !== productIds.length) {
      return { success: false, message: 'Hay productos inválidos en la compra.' };
    }

    const productMap = new Map(products.map((product) => [product.id, product]));

    const total_amount = validItems.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0);

    const purchase = await prisma.purchase.create({
      data: {
        supplierId: data.supplierId,
        date: data.date,
        invoice_number: data.invoice_number?.trim() || null,
        payment_method: data.payment_method?.trim() || null,
        notes: data.notes?.trim() || null,
        total_amount,
        items: {
          create: validItems.map((item) => {
            const product = productMap.get(item.productId)!;
            return {
              sku: product.sku,
              productName: product.name,
              quantity: item.quantity,
              unit_cost: item.unit_cost,
              subtotal: item.quantity * item.unit_cost,
            };
          })
        }
      }
    });

    revalidatePath('/purchases');
    revalidatePath('/orders/new');

    return { success: true, purchaseId: purchase.id };
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return { success: false, message: 'El número de invoice ya existe en otra compra.' };
    }
    console.error('Error creating purchase', error);
    return { success: false, message: 'No se pudo crear la compra.' };
  }
}

export async function assignPurchaseToClient(input: AssignPurchaseInput) {
  await requireAdminUser();

  if (!input.purchaseItemId || !input.clientId || input.quantity <= 0 || input.unitPrice < 0) {
    return { success: false, message: 'Datos de asignación inválidos.' };
  }

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const purchaseItem = await tx.purchaseItem.findUnique({
        where: { id: input.purchaseItemId },
        include: {
          purchase: true,
          product: { select: { id: true } }
        }
      });

      if (!purchaseItem) {
        throw new Error('Ítem de compra no encontrado.');
      }

      const allocated = await tx.purchaseAllocation.aggregate({
        where: { purchaseItemId: input.purchaseItemId },
        _sum: { quantity: true }
      });

      const allocatedQty = allocated?._sum?.quantity ?? 0;
      const pendingQty = purchaseItem.quantity - allocatedQty;

      if (input.quantity > pendingQty) {
        throw new Error(`No hay cantidad suficiente. Pendiente: ${pendingQty}.`);
      }

      let order = await findOpenOrderForClient(tx, input.clientId);
      if (!order) {
        const nextOrderNumber = await getNextOrderNumber(tx);
        order = await tx.order.create({
          data: {
            order_number: nextOrderNumber,
            clientId: input.clientId,
            date: new Date(),
            status: 'COMPRAR',
            total_amount: 0,
            currency: 'USD',
            notes: `Creado automáticamente desde compra #${purchaseItem.purchaseId}`,
            source: 'PURCHASE_ASSIGNMENT'
          }
        });
      }

      const subtotal = input.quantity * input.unitPrice;
      const orderItem = await tx.orderItem.create({
        data: {
          orderId: order.id,
          productId: purchaseItem.product?.id || null,
          productName: purchaseItem.productName,
          quantity: input.quantity,
          unit_price: input.unitPrice,
          unit_cost: purchaseItem.unit_cost,
          subtotal,
          profit: (input.unitPrice - purchaseItem.unit_cost) * input.quantity,
          supplierId: purchaseItem.purchase.supplierId,
          purchase_invoice: purchaseItem.purchase.invoice_number,
          status: 'RESERVADO',
          shipping_cost: 0
        }
      });

      const orderTotals = await tx.orderItem.aggregate({
        where: { orderId: order.id },
        _sum: { subtotal: true }
      });

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          total_amount: orderTotals?._sum?.subtotal ?? 0
        }
      });

      await upsertOrderChargeTransaction(tx, updatedOrder);

      const allocation = await tx.purchaseAllocation.create({
        data: {
          purchaseItemId: purchaseItem.id,
          clientId: input.clientId,
          orderId: updatedOrder.id,
          orderItemId: orderItem.id,
          quantity: input.quantity,
          unit_cost_snapshot: purchaseItem.unit_cost,
          unit_price_snapshot: input.unitPrice,
          notes: input.notes?.trim() || null,
        }
      });

      return {
        allocationId: allocation.id,
        orderId: updatedOrder.id,
      };
    });

    revalidatePath('/purchases');
    revalidatePath('/orders');

    return { success: true, ...result };
  } catch (error: any) {
    console.error('Error assigning purchase item', error);
    return { success: false, message: error?.message || 'No se pudo asignar el ítem.' };
  }
}

export async function markPurchaseAsPaid(purchaseId: number) {
  await requireAdminUser();

  if (!purchaseId || Number.isNaN(purchaseId)) {
    return { success: false, message: 'Compra inválida.' };
  }

  try {
    const purchaseItems = await prisma.purchaseItem.findMany({
      where: { purchaseId },
      select: { id: true }
    });

    if (!purchaseItems.length) {
      return { success: false, message: 'La compra no tiene ítems.' };
    }

    const purchaseItemIds = purchaseItems.map((item) => item.id);
    const allocations = await (prisma as any).purchaseAllocation.findMany({
      where: { purchaseItemId: { in: purchaseItemIds } },
      select: { orderItemId: true, orderId: true }
    });

    if (!allocations.length) {
      return { success: false, message: 'No hay asignaciones para actualizar.' };
    }

    const orderItemIds = [...new Set(allocations.map((allocation: any) => Number(allocation.orderItemId)))] as number[];
    const orderIds = [...new Set(allocations.map((allocation: any) => Number(allocation.orderId)))] as number[];

    const updatedItems = await prisma.orderItem.updateMany({
      where: {
        id: { in: orderItemIds },
        status: 'RESERVADO'
      },
      data: {
        status: 'ENCARGADO'
      }
    });

    await prisma.order.updateMany({
      where: {
        id: { in: orderIds },
        status: { in: ['COMPRAR', 'RESERVADO'] }
      },
      data: {
        status: 'ENCARGADO'
      }
    });

    revalidatePath('/purchases');
    revalidatePath(`/purchases/${purchaseId}`);
    revalidatePath('/orders');

    return {
      success: true,
      updatedItems: updatedItems.count,
      message: `Se actualizaron ${updatedItems.count} ítems a ENCARGADO.`
    };
  } catch (error) {
    console.error('Error marking purchase as paid', error);
    return { success: false, message: 'No se pudo marcar la compra como pagada.' };
  }
}
