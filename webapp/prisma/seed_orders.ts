
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
    let jsonPath = path.join(process.cwd(), 'prisma', 'orders_seed.json');
    if (!fs.existsSync(jsonPath)) {
        // Try webapp/prisma
        jsonPath = path.join(process.cwd(), 'webapp', 'prisma', 'orders_seed.json');
    }

    console.log(`Reading orders from ${jsonPath}...`);

    if (!fs.existsSync(jsonPath)) {
        console.error("orders_seed.json not found!");
        return;
    }

    const data = fs.readFileSync(jsonPath, 'utf-8');
    const orders = JSON.parse(data);

    console.log(`Found ${orders.length} orders to seed.`);

    // Pre-fetch clients map [old_id] -> [id] AND [name] -> [id]
    const clients = await prisma.client.findMany({ select: { id: true, old_id: true, name: true } });
    const clientMap = new Map<number, number>();
    const clientNameMap = new Map<string, number>();

    clients.forEach((c: { id: number; old_id: number | null; name: string }) => {
        if (c.old_id) clientMap.set(c.old_id, c.id);
        if (c.name) clientNameMap.set(c.name.trim().toUpperCase(), c.id);
    });

    // Pre-fetch shipments map [shipment_number] -> [id]
    const shipments = await (prisma as any).shipment.findMany({ select: { id: true, shipment_number: true } });
    const shipmentMap = new Map<number, number>();
    shipments.forEach((s: { id: number; shipment_number: number | null }) => {
        if (s.shipment_number) shipmentMap.set(s.shipment_number, s.id);
    });

    // Pre-fetch suppliers map [name] -> [id]
    const suppliers = await prisma.supplier.findMany({ select: { id: true, name: true } });
    const supplierMap = new Map<string, number>();
    suppliers.forEach((s: { id: number; name: string }) => {
        // Normalize name for matching
        if (s.name) supplierMap.set(s.name.trim().toUpperCase(), s.id);
    });

    // Ensure "CLIENTE DESCONOCIDO" exists
    let unknownClient = await prisma.client.findFirst({ where: { name: 'CLIENTE DESCONOCIDO' } });
    if (!unknownClient) {
        unknownClient = await prisma.client.create({
            data: {
                name: 'CLIENTE DESCONOCIDO',
                notes: 'Generado automáticamente para pedidos sin cliente identificado en Excel'
            }
        });
    }
    const unknownClientId = unknownClient.id;

    let created = 0;

    for (const o of orders) {
        if (!o.order_number) continue;

        let dbClientId = null;
        if (o.client_old_id) {
            dbClientId = clientMap.get(o.client_old_id);
        }

        // Fallback to name match
        if (!dbClientId && (o as any).client_name_match) {
            const nameKey = (o as any).client_name_match.trim().toUpperCase();

            // STRICT FILTER FOR INVALID NAMES
            if (['NAN', 'NULL', 'NONE', '', 'UNKNOWN'].includes(nameKey)) {
                console.warn(`Skipping invalid client name: ${nameKey} for order #${o.order_number}`);
                // Pass through to unknownClientId logic below
            } else if (clientNameMap.has(nameKey)) {
                dbClientId = clientNameMap.get(nameKey);
            } else {
                console.log(`Client not found by name: ${(o as any).client_name_match} (Order #${o.order_number})`);
                // Create it strictly if valid
                const newClient = await prisma.client.create({
                    data: { name: (o as any).client_name_match, type: 'GENERADO_AUTO' }
                });
                dbClientId = newClient.id;
                clientNameMap.set(nameKey, newClient.id); // Cache it
                console.log(`Created new client: ${(o as any).client_name_match}`);
            }
        }

        let dbShipmentId = null;
        if (o.shipment_number) {
            dbShipmentId = shipmentMap.get(o.shipment_number);
        }

        if (dbShipmentId && dbClientId) {
            // Ensure Shipment is linked to this Client if it has no client
            // We can try to update it blindly or check first.
            // Since this runs for every order, we should be careful.
            // Let's blindly update IF it's null? No, Prisma doesn't support conditional update easily in one go.
            // We will just update it. If multiple orders point to same shipment but different clients, the last one wins (which is acceptable edge case).
            // Actually, better to only update if currently null.
            const s = await (prisma as any).shipment.findUnique({ where: { id: dbShipmentId }, select: { clientId: true } });
            if (s && !s.clientId) {
                await (prisma as any).shipment.update({
                    where: { id: dbShipmentId },
                    data: { clientId: dbClientId }
                });
            }
        }

        // Parse date
        let orderDate = new Date(o.date);
        if (isNaN(orderDate.getTime())) {
            console.warn(`Invalid date for order ${o.order_number}: ${o.date}. Using current date fallback.`);
            orderDate = new Date();
        }

        // Create "CLIENTE DESCONOCIDO" if it doesn't exist (only once)
        // We do this check outside or just reuse a known ID if we could, 
        // but for safety let's do it cleanly strictly if needed.
        // Actually, let's do it outside the loop for performance.

        const order = await prisma.order.upsert({
            where: { order_number: o.order_number },
            update: {
                clientId: dbClientId || unknownClientId,
                date: orderDate,
                status: o.status,
                total_amount: o.total_amount,
                paymentMethod: (o as any).payment_method,
                shipmentId: dbShipmentId
            } as any,
            create: {
                order_number: o.order_number,
                clientId: dbClientId || unknownClientId,
                date: orderDate,
                status: o.status,
                total_amount: o.total_amount,
                paymentMethod: (o as any).payment_method,
                shipmentId: dbShipmentId
            } as any
        });

        // Items
        // We delete existing items to replace with new ones (simple sync)
        await prisma.orderItem.deleteMany({ where: { orderId: order.id } });

        for (const item of o.items) {
            let productId: number | null = null;
            if (item.sku) {
                // We use findFirst because SKU might not be strictly unique in dirty data, but schema says unique.
                const p = await prisma.product.findFirst({ where: { sku: String(item.sku) } });
                if (p) productId = p.id;
            }

            let supplierId = null;
            if (item.supplier_name && typeof item.supplier_name === 'string') {
                const sName = item.supplier_name.trim().toUpperCase();
                if (supplierMap.has(sName)) {
                    supplierId = supplierMap.get(sName);
                }
            }

            let itemShipmentId: number | null = null;
            if (item.shipment_number) {
                // Look up in map
                const mapped = shipmentMap.get(item.shipment_number);
                if (mapped) itemShipmentId = mapped;
            }

            // Fallback: If item has no shipment but order does, inherit it? 
            // Usually safest to stick to explicit item shipment if data says so.
            // But if data is loose, we might want fallback. 
            // User did not ask for fallback, but implied consistency.
            // If item.shipment_number is missing in JSON but present in Order, we might want to use Order's.
            // However, python script extracts it per item. So let's trust item data first.
            if (!itemShipmentId && dbShipmentId) {
                itemShipmentId = dbShipmentId;
            }

            await prisma.orderItem.create({
                data: {
                    orderId: order.id,
                    productId: productId,
                    supplierId: supplierId,
                    purchase_invoice: item.purchase_invoice,
                    productName: item.product_name || item.sku || 'Item',
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    unit_cost: item.unit_cost || 0,
                    subtotal: (item.unit_price * item.quantity),
                    profit: item.profit || 0, // Store explicit profit
                    shipmentId: itemShipmentId,
                    status: item.status
                }
            });
        }

        // --- TRANSACTIONS LOGIC (DEBT & PAYMENTS) ---
        const orderRef = `Order #${o.order_number}`;

        // Clean up old transactions for this order
        // We remove clientId filter to ensure we clean up even if client changed
        await prisma.transaction.deleteMany({
            where: {
                reference: { contains: `Order #${o.order_number}` }
            }
        });

        // Create Debt (Cargo)
        if (o.total_amount > 0) {
            await prisma.transaction.create({
                data: {
                    clientId: order.clientId,
                    date: orderDate,
                    type: 'CARGO',
                    amount: o.total_amount, // Positive = Debt
                    description: `Compra - Pedido #${o.order_number}`,
                    reference: orderRef
                }
            });
        }

        // Create Payment (Pago) if exists in Excel
        const paymentAmount = (o as any).payment_amount;
        const paymentMethod = (o as any).payment_method;

        if (paymentAmount && paymentAmount > 0) {
            await prisma.transaction.create({
                data: {
                    clientId: order.clientId,
                    date: orderDate,
                    type: 'PAGO',
                    amount: -Math.abs(paymentAmount),
                    description: `Pago ${paymentMethod || ''}`.trim(),
                    reference: `${orderRef} - Pago`
                }
            });
        }

        created++;
    }

    console.log(`Seeding complete. Processed ${created} orders.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
