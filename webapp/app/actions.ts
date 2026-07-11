'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdminUser } from '@/lib/access';
import { sendInvoiceEmail, sendPackingListEmail } from '@/app/email-actions';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { createClientPaymentWithReceipt } from '@/lib/payment-receipts';
import { buildShipmentItems } from '@/lib/shipment-items';

type DeliveryChannel = 'EMAIL' | 'WHATSAPP' | 'SKIPPED' | 'FAILED';

type DeliveryResult = {
    success: boolean;
    channel: DeliveryChannel;
    message: string;
};

function isEnabledEnv(value: string | undefined, defaultValue: boolean): boolean {
    if (value === undefined) return defaultValue;
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function getAppBaseUrl() {
    const raw =
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.AUTH_URL ||
        process.env.NEXTAUTH_URL ||
        'https://app.eswtech.net';
    return raw.replace(/\/+$/, '');
}

async function notifyOrderInvoiceDelivery(orderId: number): Promise<DeliveryResult> {
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { client: true }
    });

    if (!order) {
        return { success: false, channel: 'FAILED', message: 'Pedido no encontrado para notificación.' };
    }

    const autoEmailEnabled = isEnabledEnv(process.env.AUTO_NOTIFY_EMAIL_ENABLED, true);
    const autoWhatsAppEnabled = isEnabledEnv(process.env.AUTO_NOTIFY_WHATSAPP_ENABLED, true);
    const email = order.client?.email?.trim();
    const phone = order.client?.phone?.trim();

    if (autoEmailEnabled && email) {
        const emailResult = await sendInvoiceEmail(order.id, email);
        if (emailResult.success) {
            return {
                success: true,
                channel: 'EMAIL',
                message: `Invoice #${order.order_number ?? order.id} enviado por email a ${email}.`
            };
        }
    }

    if (!autoWhatsAppEnabled) {
        return {
            success: false,
            channel: 'FAILED',
            message: `No se pudo enviar invoice por email y WhatsApp automático está desactivado.`
        };
    }

    if (!phone) {
        return {
            success: false,
            channel: 'FAILED',
            message: `Cliente sin teléfono/WhatsApp para enviar invoice #${order.order_number ?? order.id}.`
        };
    }

    const invoiceUrl = `${getAppBaseUrl()}/orders/${order.id}/invoice`;
    const needsEmailReminder = !email;
    const message = [
        `Hola ${order.client?.name || 'cliente'},`,
        `Tu Invoice #${order.order_number ?? order.id} ya está disponible:`,
        invoiceUrl,
        needsEmailReminder ? 'Por favor respondé con tu email para enviarte próximas facturas por correo.' : ''
    ].filter(Boolean).join('\n');

    const waResult = await sendWhatsAppMessage(phone, message);
    if (!waResult.success) {
        return {
            success: false,
            channel: 'FAILED',
            message: `Falló envío WhatsApp de invoice #${order.order_number ?? order.id}: ${waResult.message}`
        };
    }

    return {
        success: true,
        channel: 'WHATSAPP',
        message: `Invoice #${order.order_number ?? order.id} enviado por WhatsApp.`
    };
}

async function notifyShipmentPackingListDelivery(
    shipmentId: number,
    options?: { skipIfAlreadySent?: boolean; requireItems?: boolean }
): Promise<DeliveryResult> {
    const shipment = await prisma.shipment.findUnique({
        where: { id: shipmentId },
        include: { client: true }
    });

    if (!shipment) {
        return { success: false, channel: 'FAILED', message: 'Envío no encontrado para notificación.' };
    }

    if (options?.skipIfAlreadySent && shipment.email_sent_at) {
        return {
            success: true,
            channel: 'SKIPPED',
            message: `Packing list de envío #${shipment.shipment_number ?? shipment.id} ya notificado previamente.`
        };
    }

    if (options?.requireItems) {
        const itemCount = await prisma.orderItem.count({
            where: {
                OR: [
                    { shipmentId: shipment.id },
                    { order: { shipmentId: shipment.id } }
                ]
            }
        });
        if (itemCount === 0) {
            return {
                success: true,
                channel: 'SKIPPED',
                message: `Envío #${shipment.shipment_number ?? shipment.id} todavía sin items para packing list.`
            };
        }
    }

    const autoEmailEnabled = isEnabledEnv(process.env.AUTO_NOTIFY_EMAIL_ENABLED, true);
    const autoWhatsAppEnabled = isEnabledEnv(process.env.AUTO_NOTIFY_WHATSAPP_ENABLED, true);
    const email = shipment.client?.email?.trim();
    const phone = shipment.client?.phone?.trim();

    if (autoEmailEnabled && email) {
        const emailResult = await sendPackingListEmail(shipment.id, email);
        if (emailResult.success) {
            return {
                success: true,
                channel: 'EMAIL',
                message: `Packing list #${shipment.shipment_number ?? shipment.id} enviado por email a ${email}.`
            };
        }
    }

    if (!autoWhatsAppEnabled) {
        return {
            success: false,
            channel: 'FAILED',
            message: `No se pudo enviar packing list por email y WhatsApp automático está desactivado.`
        };
    }

    if (!phone) {
        return {
            success: false,
            channel: 'FAILED',
            message: `Cliente sin teléfono/WhatsApp para envío #${shipment.shipment_number ?? shipment.id}.`
        };
    }

    const packingUrl = `${getAppBaseUrl()}/shipments/${shipment.id}/packing-list`;
    const needsEmailReminder = !email;
    const message = [
        `Hola ${shipment.client?.name || 'cliente'},`,
        `Tu Packing List del envío #${shipment.shipment_number ?? shipment.id} ya está disponible:`,
        packingUrl,
        needsEmailReminder ? 'Por favor respondé con tu email para enviarte próximos documentos por correo.' : ''
    ].filter(Boolean).join('\n');

    const waResult = await sendWhatsAppMessage(phone, message);
    if (!waResult.success) {
        return {
            success: false,
            channel: 'FAILED',
            message: `Falló envío WhatsApp de packing list #${shipment.shipment_number ?? shipment.id}: ${waResult.message}`
        };
    }

    return {
        success: true,
        channel: 'WHATSAPP',
        message: `Packing list #${shipment.shipment_number ?? shipment.id} enviado por WhatsApp.`
    };
}

export async function createOrder(prevState: any, formData: FormData) {
    await requireAdminUser();
    // legacy stub
}

export async function submitOrder(data: {
    clientId: number;
    date: Date;
    type?: string;
    items: {
        productId: number | null;
        name: string;
        quantity: number;
        price: number;
        cost: number;
        supplierId?: number | null;
        purchase_invoice?: string;
        shipment_number?: number | null;
        status?: string;
    }[];
    notes?: string;
}) {
    await requireAdminUser();
    if (!data.clientId || data.items.length === 0) {
        return { success: false, message: 'Faltan datos requeridos (Cliente o Items)' };
    }

    try {
        const totalAmount = data.items.reduce((acc, item) => acc + (item.price * item.quantity), 0);

        // Find max order number to increment (simple logic for now)
        const lastOrder = await prisma.order.findFirst({ orderBy: { order_number: 'desc' } });
        const newOrderNumber = (lastOrder?.order_number || 0) + 1;

        // Pre-fetch shipments for resolution
        const shipmentNumbers = data.items.map(i => i.shipment_number).filter(n => n !== null && n !== undefined) as number[];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shipments = await (prisma as any).shipment.findMany({
            where: { shipment_number: { in: shipmentNumbers } },
            select: { id: true, shipment_number: true }
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shipmentMap = new Map(shipments.map((s: any) => [s.shipment_number, s.id]));

        // Transaction DB
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await prisma.$transaction(async (tx: any) => {
            // 1. Create Order
            const order = await tx.order.create({
                data: {
                    order_number: newOrderNumber,
                    clientId: data.clientId,
                    date: data.date,
                    status: 'COMPRAR',
                    total_amount: totalAmount,
                    type: data.type,
                    notes: data.notes,
                    items: {
                        create: data.items.map(item => {
                            const shipmentId = item.shipment_number ? shipmentMap.get(item.shipment_number) : null;
                            const profit = (item.price - item.cost) * item.quantity;

                            return {
                                productId: item.productId,
                                productName: item.name,
                                quantity: item.quantity,
                                unit_price: item.price,
                                unit_cost: item.cost,
                                subtotal: item.price * item.quantity,
                                profit: profit,
                                supplierId: item.supplierId,
                                purchase_invoice: item.purchase_invoice,
                                shipmentId: shipmentId,
                                status: item.status,
                                shipping_cost: 0 // Default for now
                            };
                        })
                    }
                }
            });

            // 2. Create Debt Transaction (Cargo)
            await tx.transaction.create({
                data: {
                    clientId: data.clientId,
                    date: data.date,
                    type: 'CARGO',
                    amount: -totalAmount, // Negative = Debt
                    description: `Pedido #${newOrderNumber}`,
                    reference: String(newOrderNumber)
                }
            });

            return order;
        });

        // Recalculate Shipment Stats for all affected shipments
        // (Do this OUTSIDE the transaction for performance/deadlock safety, as it's a recalibration)
        if (shipmentMap.size > 0) {
            // We can iterate the map values (shipment IDs)
            for (const sId of shipmentMap.values()) {
                await recalculateShipmentStats(sId as number);
            }
        }

        // Auto-delivery: Invoice + related packing lists
        const deliveryResults: DeliveryResult[] = [];
        deliveryResults.push(await notifyOrderInvoiceDelivery(result.id));

        const relatedShipmentIds = [...new Set(
            Array.from(shipmentMap.values()).filter((id): id is number => typeof id === 'number')
        )];

        for (const sId of relatedShipmentIds) {
            deliveryResults.push(await notifyShipmentPackingListDelivery(sId, {
                skipIfAlreadySent: true,
                requireItems: true
            }));
        }

        const deliveryErrors = deliveryResults
            .filter(r => !r.success)
            .map(r => r.message);

        revalidatePath('/orders');
        revalidatePath('/clients');
        revalidatePath('/');
        return {
            success: true,
            orderId: result.id,
            delivery: deliveryResults,
            warning: deliveryErrors.length ? `Pedido creado con alertas de envío automático: ${deliveryErrors.join(' | ')}` : null
        };

    } catch (error) {
        console.error('Error creating order:', error);
        return { success: false, message: 'Error interno al crear el pedido' };
    }
}

export async function registerPayment(clientId: number, amount: number, description: string, reference: string, paymentMethod: string) {
    await requireAdminUser();

    try {
        const transaction = await createClientPaymentWithReceipt(prisma, {
            clientId,
            amount,
            date: new Date(),
            paymentMethod,
            description: description || 'Pago a cuenta',
            reference,
        });

        revalidatePath(`/clients/${clientId}`);
        revalidatePath('/clients');
        revalidatePath('/collections');
        revalidatePath('/payments');
        revalidatePath('/analytics/financial');
        revalidatePath('/');
        return { success: true, transaction };
    } catch (error) {
        console.error('Error registering payment:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Failed to register payment' };
    }
}

export async function registerPaymentFromForm(formData: FormData) {
    await requireAdminUser();

    const clientId = Number(formData.get('clientId'));
    const amount = Number(formData.get('amount'));
    const description = String(formData.get('description') || '');
    const reference = String(formData.get('reference') || '');
    const paymentMethod = String(formData.get('paymentMethod') || '');
    const receiptValue = formData.get('proof');
    const receiptFile = receiptValue instanceof File ? receiptValue : null;

    try {
        const transaction = await createClientPaymentWithReceipt(prisma, {
            clientId,
            amount,
            date: new Date(),
            paymentMethod,
            description: description || 'Pago a cuenta',
            reference,
            receiptFile,
        });

        revalidatePath(`/clients/${clientId}`);
        revalidatePath('/clients');
        revalidatePath('/collections');
        revalidatePath('/payments');
        revalidatePath('/analytics/financial');
        revalidatePath('/');
        return { success: true, transaction };
    } catch (error) {
        console.error('Error registering payment from form:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Failed to register payment' };
    }
}

export async function registerShipmentCharge(shipmentId: number, clientId: number, amount: number, notes?: string) {
    await requireAdminUser();
    try {
        const shipment = await prisma.shipment.findUnique({
            where: { id: shipmentId },
            select: { shipment_number: true }
        });

        if (!shipment) return { success: false, message: 'Envío no encontrado' };

        // Create Debit Transaction
        await prisma.transaction.create({
            data: {
                clientId,
                type: 'CARGO', // Debit/Charge
                amount: -Math.abs(amount), // Negative = Debt
                date: new Date(),
                description: `CARGA #${shipment.shipment_number} ${notes ? '- ' + notes : ''}`,
                reference: `SHIP-${shipment.shipment_number}`
            } as any
        });

        revalidatePath(`/clients/${clientId}`);
        revalidatePath('/shipments');
        return { success: true };

    } catch (error) {
        console.error('Error registering shipment charge:', error);
        return { success: false, message: 'Error al registrar el cargo del envío' };
    }
}

// Helper to recalc shipment stats
async function recalculateShipmentStats(shipmentId: number) {
    if (!shipmentId) return;

    const shipment = await prisma.shipment.findUnique({
        where: { id: shipmentId },
        include: {
            items: { include: { product: true, order: true } },
            orders: {
                include: {
                    items: { include: { product: true } }
                }
            }
        }
    });

    if (!shipment) return;

    const shipmentItems = buildShipmentItems(shipment);

    let totalWeight = 0;
    let totalCost = 0;
    let totalPrice = 0;
    let itemCount = 0;
    let profit = 0;

    // We prefer "Client" from the orders. 
    // If mixed clients, we might set null or keep first.
    const uniqueClientIds = new Set<number>();

    for (const item of shipmentItems) {
        // Sum quantities for "Cantidad Artículos"
        itemCount += item.quantity;

        // Sum financial totals
        totalCost += (item.unit_cost * item.quantity);
        totalPrice += (item.unit_price * item.quantity);
        profit += (item.profit);

        // Sum weights if product has it
        if (item.product?.weight) {
            totalWeight += (item.product.weight * item.quantity);
        }

        if (item.order?.clientId) uniqueClientIds.add(item.order.clientId);
    }

    // Determine main client
    const newClientId = uniqueClientIds.size === 1 ? [...uniqueClientIds][0] : undefined;

    // Update Shipment
    await (prisma as any).shipment.update({
        where: { id: shipmentId },
        data: {
            item_count: itemCount,
            cost_total: totalCost,
            price_total: totalPrice,
            profit: profit,
            ...(newClientId ? { clientId: newClientId } : {}),
        }
    });
}


export async function updateOrderStatus(orderId: number, status: string, shipmentId?: number | null) {
    await requireAdminUser();
    try {
        const existingOrder = await prisma.order.findUnique({
            where: { id: orderId },
            select: { shipmentId: true }
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = { status };
        const normalizedShipmentId = shipmentId === 0 ? null : shipmentId;
        const previousShipmentId = existingOrder?.shipmentId || null;

        if (shipmentId !== undefined) {
            data.shipmentId = normalizedShipmentId;
        }

        const updatedOrder = await prisma.order.update({
            where: { id: orderId },
            data: data
        });

        const itemData: any = { status };
        if (shipmentId !== undefined) {
            itemData.shipmentId = normalizedShipmentId;
        }

        await prisma.orderItem.updateMany({
            where: { orderId },
            data: itemData
        });

        // Trigger recalc for the NEW shipment
        if (updatedOrder.shipmentId) {
            await recalculateShipmentStats(updatedOrder.shipmentId);
        }

        if (previousShipmentId && previousShipmentId !== updatedOrder.shipmentId) {
            await recalculateShipmentStats(previousShipmentId);
        }

        // We might also want to recalc the OLD shipment if we moved it?
        // But we don't know the old ID here easily without a previous fetch.
        // For now, assume assignment is the main update action.

        revalidatePath(`/orders/${orderId}`);
        revalidatePath('/orders');
        revalidatePath('/shipments');
        if (updatedOrder.shipmentId) revalidatePath(`/shipments/${updatedOrder.shipmentId}`);
        if (previousShipmentId && previousShipmentId !== updatedOrder.shipmentId) revalidatePath(`/shipments/${previousShipmentId}`);

        let delivery: DeliveryResult | null = null;
        const shipmentWasAssigned =
            normalizedShipmentId !== undefined &&
            normalizedShipmentId !== null &&
            normalizedShipmentId !== existingOrder?.shipmentId;

        if (shipmentWasAssigned) {
            delivery = await notifyShipmentPackingListDelivery(normalizedShipmentId, {
                skipIfAlreadySent: true,
                requireItems: true
            });
        }

        return { success: true, delivery };
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
    await requireAdminUser();
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

        const delivery = await notifyShipmentPackingListDelivery(shipment.id, {
            skipIfAlreadySent: true,
            requireItems: true
        });

        revalidatePath('/shipments');
        return { success: true, shipmentId: shipment.id, delivery };

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
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
    notes?: string;
}) {
    await requireAdminUser();
    try {
        await (prisma as any).supplier.create({ data });
        revalidatePath('/suppliers');
        return { success: true };
    } catch (error: any) {
        console.error('Error creating supplier:', error);
        return { success: false, message: `Error al crear proveedor: ${error.message || error}` };
    }
}

export async function updateSupplier(id: number, data: {
    name: string;
    contact?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
    notes?: string;
}) {
    await requireAdminUser();
    try {
        await (prisma as any).supplier.update({
            where: { id },
            data
        });
        revalidatePath('/suppliers');
        revalidatePath(`/suppliers/${id}`);
        return { success: true };
    } catch (error: any) {
        console.error('Error updating supplier:', error);
        return { success: false, message: `Error al actualizar proveedor: ${error.message || error}` };
    }
}

// --- CLIENTS ---

export async function createClient(data: {
    name: string;
    document_id?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
    notes?: string;
    canAccess?: boolean;
}) {
    await requireAdminUser();
    try {
        // canAccess is valid but if the IDE shows red, Restart TS Server (Cmd+Shift+P)
        await prisma.client.create({
            data: {
                name: data.name,
                document_id: data.document_id,
                email: data.email,
                phone: data.phone,
                address: data.address,
                city: data.city,
                state: data.state,
                country: data.country,
                notes: data.notes,
                canAccess: data.canAccess ?? true
            } as any
        });
        revalidatePath('/clients');
        return { success: true };
    } catch (error: any) {
        console.error('Error creating client:', error);
        return { success: false, message: `Error al crear cliente: ${error.message || error}` };
    }
}

export async function updateClient(id: number, data: {
    name: string;
    document_id?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
    notes?: string;
    canAccess?: boolean;
}) {
    await requireAdminUser();
    try {
        await prisma.client.update({
            where: { id },
            data: {
                name: data.name,
                document_id: data.document_id,
                email: data.email,
                phone: data.phone,
                address: data.address,
                city: data.city,
                state: data.state,
                country: data.country,
                notes: data.notes,
                canAccess: data.canAccess
            } as any
        });
        revalidatePath('/clients');
        revalidatePath(`/clients/${id}`);
        return { success: true };
    } catch (error: any) {
        console.error('Error updating client:', error);
        return { success: false, message: `Error al actualizar cliente: ${error.message || error}` };
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
    await requireAdminUser();
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
    await requireAdminUser();
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

// --- SHIPMENTS ---

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function syncShipmentStatus(shipmentId: number) {
    await requireAdminUser();
    const shipment = await (prisma as any).shipment.findUnique({
        where: { id: shipmentId },
        include: { orders: true }
    });

    if (!shipment) return null;

    let newStatus = shipment.status;
    const now = new Date();

    // 1. Rule: Date Arrived exists -> EN 🇦🇷
    if (shipment.date_arrived) {
        const arrivedAt = new Date(shipment.date_arrived);
        newStatus = 'EN 🇦🇷';

        // 2. Rule: 3 days after arrival -> ENTREGADO
        if (now.getTime() - arrivedAt.getTime() >= 3 * MS_PER_DAY) {
            newStatus = 'ENTREGADO';
        }
    }
    // 3. Rule: Date Shipped exists -> SALIENDO
    else if (shipment.date_shipped) {
        const shippedAt = new Date(shipment.date_shipped);
        newStatus = 'SALIENDO';

        // 4. Rule: 48 hours after shipping -> LLEGANDO
        if (now.getTime() - shippedAt.getTime() >= 48 * MS_PER_HOUR) {
            newStatus = 'LLEGANDO';
        }
    }

    // If status changed, update DB directly without calling updateShipment
    if (newStatus !== shipment.status) {
        // Update shipment status
        await (prisma as any).shipment.update({
            where: { id: shipmentId },
            data: { status: newStatus }
        });

        // Sync Orders Status
        let targetOrderStatus = '';
        const s = newStatus.toUpperCase();

        if (s === 'SALIENDO') targetOrderStatus = 'SALIENDO';
        else if (s === 'LLEGANDO') targetOrderStatus = 'LLEGANDO';
        else if (s === 'EN BSAS' || s === 'ARRIBADO' || s === 'EN 🇦🇷') targetOrderStatus = 'EN 🇦🇷';
        else if (s === 'ENTREGADO' || s === 'FINALIZADO') targetOrderStatus = 'ENTREGADO';
        else if (s === 'MIAMI') targetOrderStatus = 'MIAMI';

        if (targetOrderStatus) {
            await prisma.order.updateMany({
                where: { shipmentId: shipmentId },
                data: { status: targetOrderStatus }
            });

            await prisma.orderItem.updateMany({
                where: { shipmentId: shipmentId },
                data: { status: targetOrderStatus }
            });
        }

        return newStatus;
    }

    return shipment.status;
}

export async function updateShipment(data: {
    id: number;
    status: string;
    forwarder?: string;
    date_shipped?: Date | null;
    date_arrived?: Date | null;
    notes?: string;
}) {
    await requireAdminUser();
    try {
        const shipment = await (prisma as any).shipment.update({
            where: { id: data.id },
            data: {
                status: data.status,
                forwarder: data.forwarder,
                date_shipped: data.date_shipped,
                date_arrived: data.date_arrived,
                notes: data.notes
            }
        });

        // Sync Orders Status if Shipment Status changes
        // Mapping Shipment Status -> Order Status
        let targetOrderStatus = '';
        const s = data.status.toUpperCase();

        if (s === 'SALIENDO') targetOrderStatus = 'SALIENDO';
        else if (s === 'LLEGANDO') targetOrderStatus = 'LLEGANDO';
        else if (s === 'EN BSAS' || s === 'ARRIBADO' || s === 'EN 🇦🇷') targetOrderStatus = 'EN 🇦🇷';
        else if (s === 'ENTREGADO' || s === 'FINALIZADO') targetOrderStatus = 'ENTREGADO';
        else if (s === 'MIAMI') targetOrderStatus = 'MIAMI';

        // Update all Orders and OrderItems with the same status
        await prisma.order.updateMany({
            where: { shipmentId: data.id },
            data: { status: targetOrderStatus }
        });

        await prisma.orderItem.updateMany({
            where: { shipmentId: data.id },
            data: { status: targetOrderStatus }
        });

        // Force recalculate stats to ensure consistency
        await recalculateShipmentStats(data.id);

        revalidatePath('/shipments');
        revalidatePath(`/shipments/${data.id}`);
        revalidatePath('/orders');
        revalidatePath('/');
        return { success: true };

    } catch (error) {
        console.error('Error updating shipment:', error);
        return { success: false, error: 'Error al actualizar envío' };
    }
}

export async function transitionShipmentsByDate(input: {
    date: string;
    fromStatus: string;
    toStatus: string;
}) {
    await requireAdminUser();
    try {
        if (!input.date || !input.fromStatus || !input.toStatus) {
            return { success: false, message: 'Faltan datos para transición masiva.' };
        }

        const date = new Date(`${input.date}T00:00:00`);
        if (Number.isNaN(date.getTime())) {
            return { success: false, message: 'Fecha inválida.' };
        }

        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);

        const rawFrom = input.fromStatus.toUpperCase();
        const rawTo = input.toStatus.toUpperCase();

        const normalize = (status: string) => {
            const value = status.toUpperCase();
            if (value === 'EN BSAS' || value === 'EN 🇦🇷' || value === 'RECIBIDO BSAS') return 'EN 🇦🇷';
            if (value === 'ENTREGADO' || value === 'FINALIZADO') return 'ENTREGADO';
            return value;
        };

        const fromAliases = (() => {
            const normalized = normalize(rawFrom);
            if (normalized === 'EN 🇦🇷') return ['EN BSAS', 'EN 🇦🇷', 'RECIBIDO BSAS'];
            if (normalized === 'ENTREGADO') return ['ENTREGADO', 'FINALIZADO'];
            return [rawFrom];
        })();

        const to = normalize(rawTo);
        const targetOrderStatus = to;

        const shipments = await (prisma as any).shipment.findMany({
            where: {
                status: { in: fromAliases },
                date_shipped: {
                    gte: date,
                    lt: nextDate,
                }
            },
            select: { id: true }
        });

        if (!shipments.length) {
            return { success: true, count: 0, message: 'No hay envíos para actualizar en esa fecha.' };
        }

        const shipmentIds = shipments.map((shipment: any) => shipment.id);

        await (prisma as any).shipment.updateMany({
            where: { id: { in: shipmentIds } },
            data: { status: to }
        });

        await prisma.order.updateMany({
            where: { shipmentId: { in: shipmentIds } },
            data: { status: targetOrderStatus }
        });

        await prisma.orderItem.updateMany({
            where: { shipmentId: { in: shipmentIds } },
            data: { status: targetOrderStatus }
        });

        revalidatePath('/shipments');
        revalidatePath('/orders');
        revalidatePath('/');

        return {
            success: true,
            count: shipmentIds.length,
            message: `Se actualizaron ${shipmentIds.length} envíos de ${rawFrom} a ${to}.`
        };
    } catch (error) {
        console.error('Error transitioning shipments by date:', error);
        return { success: false, message: 'No se pudo ejecutar la transición masiva.' };
    }
}

export async function deleteEntity(type: 'client' | 'supplier' | 'product' | 'order' | 'shipment', id: number) {
    await requireAdminUser();
    // ... existing deleteEntity code ...
    try {
        if (type === 'client') {
            const count = await prisma.order.count({ where: { clientId: id } });
            if (count > 0) return { success: false, message: `No se puede borrar: El cliente tiene ${count} pedidos.` };
            await prisma.client.delete({ where: { id } });
        } else if (type === 'supplier') {
            await (prisma as any).supplier.delete({ where: { id } });
        } else if (type === 'product') {
            const count = await prisma.orderItem.count({ where: { productId: id } });
            if (count > 0) return { success: false, message: `No se puede borrar: El producto está en ${count} pedidos.` };
            await prisma.product.delete({ where: { id } });
        } else if (type === 'order') {
            await prisma.order.delete({ where: { id } });
        } else if (type === 'shipment') {
            const count = await prisma.order.count({ where: { shipmentId: id } });
            if (count > 0) return { success: false, message: `No se puede borrar: El envío tiene ${count} pedidos.` };
            await prisma.shipment.delete({ where: { id } });
        }

        return { success: true, message: 'Registro eliminado correctamente' };
    } catch (error) {
        console.error('Error deleting entity:', error);
        return { success: false, message: 'Error al eliminar (posible restricción de clave foránea)' };
    }
}
