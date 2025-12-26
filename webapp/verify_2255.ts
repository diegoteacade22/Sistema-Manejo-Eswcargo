
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check_2255() {
    const order = await prisma.order.findUnique({
        where: { order_number: 2255 },
        include: { shipment: true }
    });

    if (order) {
        console.log(`Order 2255: Status=${order.status}`);
        console.log(`Associated Shipment: ${order.shipment ? order.shipment.shipment_number : 'NONE'}`);
    } else {
        console.log("Order 2255 NOT FOUND in DB");
    }
    await prisma.$disconnect();
}

check_2255();
