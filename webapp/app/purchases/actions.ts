'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requireAdminUser } from '@/lib/access';
import { upsertOrderLedgerCharge } from '@/lib/client-ledger';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

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
  receipt_url?: string | null;
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

async function savePurchaseReceipt(file: File | null) {
  if (!file || file.size === 0) return null;

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowedTypes.includes(file.type)) {
    throw new Error('El comprobante debe ser JPG, PNG, WEBP o PDF.');
  }

  const extension = file.name.split('.').pop()?.toLowerCase() || 'bin';
  const safeName = `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}.${extension}`;
  const relativeDir = '/purchase-receipts';
  const absoluteDir = path.join(process.cwd(), 'public', relativeDir);
  await mkdir(absoluteDir, { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(absoluteDir, safeName), buffer);
  return `${relativeDir}/${safeName}`;
}

async function getNextOrderNumber(tx: any) {
  // Exclude system-generated orders (900000+ series: VIRTUAL_SHIPMENT, SYSTEM_BALANCE, etc.)
  const lastOrder = await tx.order.findFirst({
    where: { order_number: { lt: 900000 } },
    orderBy: { order_number: 'desc' }
  });
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
        receipt_url: data.receipt_url || null,
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

export async function createPurchaseFromForm(formData: FormData) {
  await requireAdminUser();

  try {
    const receiptValue = formData.get('receipt');
    const receiptFile = receiptValue instanceof File ? receiptValue : null;
    const receiptUrl = await savePurchaseReceipt(receiptFile);
    const rawItems = String(formData.get('items') || '[]');
    const items = JSON.parse(rawItems) as CreatePurchaseItemInput[];

    return createPurchase({
      supplierId: Number(formData.get('supplierId')),
      date: new Date(String(formData.get('date') || new Date().toISOString())),
      invoice_number: String(formData.get('invoice_number') || ''),
      payment_method: String(formData.get('payment_method') || ''),
      receipt_url: receiptUrl,
      notes: String(formData.get('notes') || ''),
      items,
    });
  } catch (error: unknown) {
    console.error('Error creating purchase from form', error);
    return { success: false, message: error instanceof Error ? error.message : 'No se pudo crear la compra.' };
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

      await upsertOrderLedgerCharge(tx, {
        id: updatedOrder.id,
        order_number: updatedOrder.order_number,
        clientId: updatedOrder.clientId,
        total_amount: updatedOrder.total_amount,
        date: updatedOrder.date,
      });

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
    revalidatePath(`/clients/${input.clientId}`);
    revalidatePath('/clients');
    revalidatePath('/analytics/financial');

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
