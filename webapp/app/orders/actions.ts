
'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';

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

        // 4. Update Transaction (if exists)
        // Check if there is a 'CARGO' transaction related to this order (Order #...)
        const orderReference = String(currentItem.order.order_number || currentItem.order.id);
        const legacyReference = `Order #${orderReference}`;

        // Numeric references are historical; new app charges use Order #<number>.
        const transactions = await prisma.transaction.findMany({
            where: {
                type: 'CARGO',
                clientId: currentItem.order.clientId,
                OR: [
                    { reference: orderReference },
                    { reference: legacyReference },
                ],
            },
            select: { id: true },
        });

        if (transactions.length > 1) {
            throw new Error(`El pedido #${orderReference} tiene más de un cargo asociado. Revisá la cuenta antes de modificar artículos.`);
        }

        if (transactions.length === 1) {
            await prisma.transaction.update({
                where: { id: transactions[0].id },
                data: { amount: -newOrderTotal } // Cargo is negative
            });
            console.log(`Updated transaction ${transactions[0].id} for Order #${currentItem.order.id} to new total: ${newOrderTotal}`);
        } else {
            // No cargo is created here: only the canonical order creation flow can create it.
            console.log(`No transaction found for Order #${currentItem.order.id} to update.`);
        }

        revalidatePath(`/orders/${currentItem.orderId}`);
        return { success: true };
    } catch (error) {
        console.error('Error updating order item:', error);
        return { success: false, error: 'Failed to update item' };
    }
}
