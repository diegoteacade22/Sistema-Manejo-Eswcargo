
'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { upsertOrderLedgerCharge } from '@/lib/client-ledger';

export async function updateOrderItem(itemId: number, data: { quantity?: number; unit_price?: number }) {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== 'ADMIN') {
        throw new Error('Unauthorized');
    }

    try {
        // 1. Get current item to calculate deltas
        const currentItem = await prisma.orderItem.findUnique({
            where: { id: itemId },
            include: { order: true }
        });

        if (!currentItem) throw new Error('Item not found');

        const newQuantity = data.quantity ?? currentItem.quantity;
        const newUnitPrice = data.unit_price ?? currentItem.unit_price;
        const newSubtotal = newQuantity * newUnitPrice;

        // 2. Update the item
        await prisma.orderItem.update({
            where: { id: itemId },
            data: {
                quantity: newQuantity,
                unit_price: newUnitPrice,
                subtotal: newSubtotal
            }
        });

        // 3. Recalculate Order Total (critical step)
        const allItems = await prisma.orderItem.findMany({
            where: { orderId: currentItem.orderId }
        });

        const newOrderTotal = allItems.reduce((sum, item) => sum + item.subtotal, 0);

        await prisma.order.update({
            where: { id: currentItem.orderId },
            data: { total_amount: newOrderTotal }
        });

        await upsertOrderLedgerCharge(prisma, {
            id: currentItem.order.id,
            order_number: currentItem.order.order_number,
            clientId: currentItem.order.clientId,
            total_amount: newOrderTotal,
            date: currentItem.order.date,
        });

        revalidatePath(`/orders/${currentItem.orderId}`);
        revalidatePath(`/clients/${currentItem.order.clientId}`);
        revalidatePath('/analytics/financial');
        return { success: true };
    } catch (error) {
        console.error('Error updating order item:', error);
        return { success: false, error: 'Failed to update item' };
    }
}
