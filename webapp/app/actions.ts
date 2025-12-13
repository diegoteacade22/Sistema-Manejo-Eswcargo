'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function createOrder(prevState: any, formData: FormData) {
    // Extract data from FormData
    // Note: For a complex form with dynamic items, FormData can be tricky.
    // It's often better to bind a JSON object or use a hidden input with JSON string if using refined client-side state.
    // OR, we can accept a plain JS object if we call this action via `useTransition` or directly, bypassing traditional form submission if needed for complexity.
    // Let's assume we receive a raw object for the "items" and "client" part if we invoke it directly, 
    // but "use server" actions usually expect standard args if used in form.
    // simpler strategy: logic here, called by client component.
}

export async function submitOrder(data: {
    clientId: number;
    date: Date;
    items: { productId: number | null; name: string; quantity: number; price: number; cost: number }[];
    notes?: string;
}) {
    if (!data.clientId || data.items.length === 0) {
        return { success: false, message: 'Faltan datos requeridos (Cliente o Items)' };
    }

    try {
        const totalAmount = data.items.reduce((acc, item) => acc + (item.price * item.quantity), 0);

        // Find max order number to increment (simple logic for now)
        const lastOrder = await prisma.order.findFirst({ orderBy: { order_number: 'desc' } });
        const newOrderNumber = (lastOrder?.order_number || 0) + 1;

        // Transaction DB
        const result = await prisma.$transaction(async (tx: any) => {
            // 1. Create Order
            const order = await tx.order.create({
                data: {
                    order_number: newOrderNumber,
                    clientId: data.clientId,
                    date: data.date,
                    status: 'PENDIENTE',
                    total_amount: totalAmount,
                    notes: data.notes,
                    items: {
                        create: data.items.map(item => ({
                            productId: item.productId,
                            productName: item.name,
                            quantity: item.quantity,
                            unit_price: item.price,
                            unit_cost: item.cost,
                            subtotal: item.price * item.quantity,
                            shipping_cost: 0 // Default for now
                        }))
                    }
                }
            });

            // 2. Create Debt Transaction (Cargo)
            await tx.transaction.create({
                data: {
                    clientId: data.clientId,
                    date: data.date,
                    type: 'CARGO',
                    amount: totalAmount,
                    description: `Pedido #${newOrderNumber}`,
                    reference: String(newOrderNumber)
                }
            });

            // 3. Update Stock (Optional/Advanced - skipping for safety unless requested, but good practice)
            // for (const item of data.items) {
            //    if (item.productId) {
            //        await tx.product.update({ 
            //            where: { id: item.productId },
            //            data: { stock: { decrement: item.quantity } }
            //        });
            //    }
            // }

            return order;
        });

        revalidatePath('/orders');
        revalidatePath('/clients');
        revalidatePath('/');
        return { success: true, orderId: result.id };

    } catch (error) {
        console.error('Error creating order:', error);
        return { success: false, message: 'Error interno al crear el pedido' };
    }
}

export async function registerPayment(clientId: number, amount: number, description: string, reference: string, paymentMethod: string) {
    // Amount for payments should decrease debt, so we store it as negative or handle the logic here.
    // In the schema, it says "Positive increases debt (Cargo), Negative decreases (Pago)".
    // So we negate the amount if the user enters a positive number for a payment.
    const finalAmount = amount > 0 ? -amount : amount;

    try {
        const transaction = await prisma.transaction.create({
            data: {
                clientId,
                type: 'PAGO',
                paymentMethod,
                amount: finalAmount,
                date: new Date(),
                description: description || 'Pago a cuenta',
                reference
            } as any,
        });

        revalidatePath(`/clients/${clientId}`);
        revalidatePath('/clients');
        return { success: true, transaction };
    } catch (error) {
        console.error('Error registering payment:', error);
        return { success: false, error: 'Failed to register payment' };
    }
}

export async function updateOrderStatus(orderId: number, status: string, shipmentId?: number | null) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = { status };

        if (shipmentId !== undefined) {
            data.shipmentId = shipmentId;
        }

        await prisma.order.update({
            where: { id: orderId },
            data: data
        });

        revalidatePath(`/orders/${orderId}`);
        revalidatePath('/orders');
        revalidatePath('/shipments');
        return { success: true };
    } catch (error) {
        console.error('Error updating order status:', error);
        return { success: false, message: 'Error al actualizar el estado' };
    }
}

export async function createShipment(data: {
    forwarder: string;
    clientId?: number | null;
    date_shipped: Date;
    notes?: string;
}) {
    try {
        // Find max shipment number
        const lastShipment = await (prisma as any).shipment.findFirst({ orderBy: { shipment_number: 'desc' } });
        const newShipmentNumber = (lastShipment?.shipment_number || 0) + 1;

        const shipment = await (prisma as any).shipment.create({
            data: {
                shipment_number: newShipmentNumber,
                forwarder: data.forwarder,
                clientId: data.clientId || null,
                date_shipped: data.date_shipped,
                status: 'EN_TRANSITO', // Default status
                notes: data.notes
            }
        });

        revalidatePath('/shipments');
        return { success: true, shipmentId: shipment.id };

    } catch (error) {
        console.error('Error creating shipment:', error);
        return { success: false, message: 'Error al crear el envío' };
    }
}

// --- SUPPLIERS ---

export async function createSupplier(data: {
    name: string;
    contact?: string;
    email?: string;
    phone?: string;
    address?: string;
    notes?: string;
}) {
    try {
        await (prisma as any).supplier.create({ data });
        revalidatePath('/suppliers');
        return { success: true };
    } catch (error) {
        console.error('Error creating supplier:', error);
        return { success: false, message: 'Error al crear proveedor' };
    }
}

export async function updateSupplier(id: number, data: {
    name: string;
    contact?: string;
    email?: string;
    phone?: string;
    address?: string;
    notes?: string;
}) {
    try {
        await (prisma as any).supplier.update({
            where: { id },
            data
        });
        revalidatePath('/suppliers');
        revalidatePath(`/suppliers/${id}`);
        return { success: true };
    } catch (error) {
        console.error('Error updating supplier:', error);
        return { success: false, message: 'Error al actualizar proveedor' };
    }
}

// --- CLIENTS ---

export async function createClient(data: {
    name: string;
    document_id?: string;
    email?: string;
    phone?: string;
    address?: string;
    notes?: string;
}) {
    try {
        await prisma.client.create({ data });
        revalidatePath('/clients');
        return { success: true };
    } catch (error) {
        console.error('Error creating client:', error);
        return { success: false, message: 'Error al crear cliente' };
    }
}

export async function updateClient(id: number, data: {
    name: string;
    document_id?: string;
    email?: string;
    phone?: string;
    address?: string;
    notes?: string;
}) {
    try {
        await prisma.client.update({
            where: { id },
            data
        });
        revalidatePath('/clients');
        revalidatePath(`/clients/${id}`);
        return { success: true };
    } catch (error) {
        console.error('Error updating client:', error);
        return { success: false, message: 'Error al actualizar cliente' };
    }
}

// --- PRODUCTS ---

export async function createProduct(data: {
    sku: string;
    name: string;
    description?: string;
    color_grade?: string;
    lp1?: number;
    stock?: number;
}) {
    try {
        await prisma.product.create({ data: { ...data, sku: data.sku || 'PENDING-' + Date.now() } });
        revalidatePath('/products');
        return { success: true };
    } catch (error) {
        console.error('Error creating product:', error);
        return { success: false, message: 'Error al crear producto' };
    }
}

export async function updateProduct(id: number, data: {
    sku: string;
    name: string;
    description?: string;
    color_grade?: string;
    lp1?: number;
    stock?: number;
}) {
    try {
        await prisma.product.update({
            where: { id },
            data
        });
        revalidatePath('/products');
        revalidatePath(`/products/${id}`);
        return { success: true };
    } catch (error) {
        console.error('Error updating product:', error);
        return { success: false, message: 'Error al actualizar producto' };
    }
}

// --- MAINTENANCE ---

export async function deleteEntity(type: 'client' | 'supplier' | 'product' | 'order', id: number) {
    try {
        if (type === 'client') {
            const count = await prisma.order.count({ where: { clientId: id } });
            if (count > 0) return { success: false, message: `No se puede borrar: El cliente tiene ${count} pedidos.` };
            await prisma.client.delete({ where: { id } });
        } else if (type === 'supplier') {
            // Suppliers don't strictly link to orders in current schema (maybe via products? no default relation).
            // But let's assume they might be linked to some shipments if added later?
            // Currently Supplier table is standalone mostly.
            await (prisma as any).supplier.delete({ where: { id } });
        } else if (type === 'product') {
            const count = await prisma.orderItem.count({ where: { productId: id } });
            if (count > 0) return { success: false, message: `No se puede borrar: El producto está en ${count} pedidos.` };
            await prisma.product.delete({ where: { id } });
        } else if (type === 'order') {
            // Orders can be deleted, cascading items.
            await prisma.order.delete({ where: { id } });
        }

        return { success: true, message: 'Registro eliminado correctamente' };
    } catch (error) {
        console.error('Error deleting entity:', error);
        return { success: false, message: 'Error al eliminar (posible restricción de clave foránea)' };
    }
}
