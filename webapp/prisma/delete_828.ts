
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log("Searching for shipment 828...");
    const shipment = await (prisma as any).shipment.findUnique({
        where: { shipment_number: 828 }
    });

    if (shipment) {
        console.log("Found shipment 828. Cleaning relations before deletion...");

        // Clear shipment references in Order and OrderItem
        await prisma.order.updateMany({
            where: { shipmentId: shipment.id },
            data: { shipmentId: null }
        });

        await prisma.orderItem.updateMany({
            where: { shipmentId: shipment.id },
            data: { shipmentId: null }
        });

        await (prisma as any).shipment.delete({
            where: { id: shipment.id }
        });

        console.log("Shipment 828 deleted successfully.");
    } else {
        console.log("Shipment 828 not found in database.");
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
