
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const orders = await prisma.order.count();
    // 1. Check if orders are linked
    const ordersWithShipment = await prisma.order.count({
        where: {
            shipmentId: {
                not: null
            }
        } as any
    });
    console.log(`Orders linked to shipments: ${ordersWithShipment}`);

    // 2. Check billing transactions
    const billingTx = await prisma.transaction.count({
        where: {
            type: 'CARGO',
            reference: { startsWith: 'ENVIO #' }
        }
    });

    console.log(`Total Orders: ${orders}`);
    console.log(`Orders linked to Shipments: ${ordersWithShipment}`);
    console.log(`Billing Transactions (ENVIO #...): ${billingTx}`);

    if (ordersWithShipment > 0 && billingTx > 0) {
        console.log("SUCCESS: Orders linked and Billing active.");
    } else {
        console.log("WARNING: Linkage or Billing might be incomplete.");
    }

}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
