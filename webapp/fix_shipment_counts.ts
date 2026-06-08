
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixShipmentStats() {
    console.log("Starting Shipment Stats Repair...");

    // Get all shipments
    const shipments = await prisma.shipment.findMany({
        orderBy: { shipment_number: 'desc' }
    });

    console.log(`Found ${shipments.length} shipments.`);

    for (const shipment of shipments) {
        console.log(`\nProcessing Shipment #${shipment.shipment_number} (ID: ${shipment.id})...`);

        // Logic from recalculateShipmentStats
        const shipmentItems = await prisma.orderItem.findMany({
            where: {
                OR: [
                    { shipmentId: shipment.id },
                    { order: { shipmentId: shipment.id } }
                ]
            },
            include: { product: true, order: true }
        });

        let totalWeight = 0;
        let totalCost = 0;
        let totalPrice = 0;
        let itemCount = 0;
        let profit = 0;

        const uniqueClientIds = new Set<number>();

        for (const item of shipmentItems) {
            itemCount += item.quantity;
            totalCost += (item.unit_cost * item.quantity);
            totalPrice += (item.unit_price * item.quantity);
            profit += (item.profit);

            if (item.product?.weight) {
                totalWeight += (item.product.weight * item.quantity);
            }

            if (item.order?.clientId) uniqueClientIds.add(item.order.clientId);
        }

        console.log(`   -> Found ${shipmentItems.length} lines.`);
        console.log(`   -> Calculated Item Count: ${itemCount}`);
        console.log(`   -> Current DB Item Count: ${shipment.item_count}`);

        if (itemCount !== shipment.item_count) {
            console.log(`   !!! UPDATING DATABASE !!!`);
            await prisma.shipment.update({
                where: { id: shipment.id },
                data: {
                    item_count: itemCount,
                    cost_total: totalCost,
                    price_total: totalPrice,
                    profit: profit
                }
            });
        } else {
            console.log(`   -> OK (No change needed)`);
        }
    }

    console.log("\nDone!");
}

fixShipmentStats()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
