
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
        const txRef = `Order #${currentItem.order.order_number || currentItem.order.id}`;

        // Find existing transaction (CARGO)
        const tx = await prisma.transaction.findFirst({
            where: {
                reference: { startsWith: txRef },
                type: 'CARGO',
                clientId: currentItem.order.clientId
            }
        });

        if (tx) {
            await prisma.transaction.update({
                where: { id: tx.id },
                data: { amount: -newOrderTotal } // Cargo is negative
            });
            console.log(`Updated transaction ${tx.id} for Order #${currentItem.order.id} to new total: ${newOrderTotal}`);
        } else {
            // If no transaction found by exact ref, try finding by description slightly loose?
            // Or maybe it hasn't been synced yet. Since this is "local first", we might want to create it?
            // For now, let's just update if found.
            console.log(`No transaction found for Order #${currentItem.order.id} to update.`);
        }

        revalidatePath(`/orders/${currentItem.orderId}`);
        return { success: true };
    } catch (error) {
        console.error('Error updating order item:', error);
        return { success: false, error: 'Failed to update item' };
    }
}
