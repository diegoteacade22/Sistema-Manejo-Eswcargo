
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
    const jsonPath = path.join(process.cwd(), 'prisma', 'orders_seed.json');
    console.log(`Reading orders from ${jsonPath}...`);

    if (!fs.existsSync(jsonPath)) {
        console.error("orders_seed.json not found!");
        return;
    }

    const data = fs.readFileSync(jsonPath, 'utf-8');
    const orders = JSON.parse(data);

    console.log(`Found ${orders.length} orders to seed.`);

    // Pre-fetch clients map [old_id] -> [id]
    const clients = await prisma.client.findMany({ select: { id: true, old_id: true } });
    const clientMap = new Map<number, number>();
    clients.forEach((c: { id: number; old_id: number | null }) => {
        if (c.old_id) clientMap.set(c.old_id, c.id);
    });

    // Pre-fetch shipments map [shipment_number] -> [id]
    const shipments = await (prisma as any).shipment.findMany({ select: { id: true, shipment_number: true } });
    const shipmentMap = new Map<number, number>();
    shipments.forEach((s: { id: number; shipment_number: number | null }) => {
        if (s.shipment_number) shipmentMap.set(s.shipment_number, s.id);
    });

    let created = 0;

    for (const o of orders) {
        if (!o.order_number) continue;

        let dbClientId = null;
        if (o.client_old_id) {
            dbClientId = clientMap.get(o.client_old_id);
        }

        let dbShipmentId = null;
        if (o.shipment_number) {
            dbShipmentId = shipmentMap.get(o.shipment_number);
        }

        // Parse date
        let orderDate = new Date(o.date);
        if (isNaN(orderDate.getTime())) {
            console.warn(`Invalid date for order ${o.order_number}: ${o.date}. Using current date fallback.`);
            orderDate = new Date();
        }

        const order = await prisma.order.upsert({
            where: { order_number: o.order_number },
            update: {
                clientId: dbClientId || 1,
                date: orderDate,
                status: o.status,
                total_amount: o.total_amount,
                shipmentId: dbShipmentId
            } as any,
            create: {
                order_number: o.order_number,
                clientId: dbClientId || 1,
                date: orderDate,
                status: o.status,
                total_amount: o.total_amount,
                shipmentId: dbShipmentId
            } as any
        });

        // Items
        // We delete existing items to replace with new ones (simple sync)
        await prisma.orderItem.deleteMany({ where: { orderId: order.id } });

        for (const item of o.items) {
            await prisma.orderItem.create({
                data: {
                    orderId: order.id,
                    productName: item.product_name || item.sku,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    unit_cost: 0, // Not in sales data
                    subtotal: item.unit_price * item.quantity
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
