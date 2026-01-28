
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function debugShipment(shipmentNumber) {
    console.log(`--- Debugging Shipment #${shipmentNumber} ---`);

    const shipment = await prisma.shipment.findFirst({
        where: { shipment_number: shipmentNumber },
        include: { orders: true }
    });

    if (!shipment) {
        console.log("Shipment not found!");
        return;
    }

    console.log(`Shipment ID: ${shipment.id}`);
    console.log(`Current Item Count: ${shipment.item_count}`);
    console.log(`Orders directly linked to Shipment: ${shipment.orders.length}`);

    // Check OrderItems linked directly to Shipment
    const directItems = await prisma.orderItem.findMany({
        where: { shipmentId: shipment.id }
    });
    console.log(`OrderItems with shipmentId=${shipment.id}: ${directItems.length}`);
    const directQty = directItems.reduce((acc, i) => acc + i.quantity, 0);
    console.log(`Sum of Quantities (Direct Items): ${directQty}`);

    // Check OrderItems linked via Parent Order
    const linkedOrders = await prisma.order.findMany({
        where: { shipmentId: shipment.id },
        include: { items: true }
    });

    let parentLinkedItemsCount = 0;
    let parentLinkedQty = 0;

    for (const order of linkedOrders) {
        console.log(`  Order #${order.order_number} (ID: ${order.id}) has ${order.items.length} items`);
        parentLinkedItemsCount += order.items.length;
        parentLinkedQty += order.items.reduce((acc, i) => acc + i.quantity, 0);

        // Check if items have shipmentId matching
        const itemsWithShipmentId = order.items.filter(i => i.shipmentId === shipment.id).length;
        console.log(`    -> Items with shipmentId matching: ${itemsWithShipmentId} / ${order.items.length}`);
    }

    console.log(`Total Items via Parent Orders: ${parentLinkedItemsCount}`);
    console.log(`Total Quantity via Parent Orders: ${parentLinkedQty}`);

}

async function main() {
    await debugShipment(824); // The one in the screenshot
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
