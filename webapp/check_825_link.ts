
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const ship = await prisma.shipment.findFirst({
        where: { shipment_number: 825 },
        include: { items: true }
    });

    if (!ship) {
        console.log("❌ Shipment 825 NOT FOUND in DB");
    } else {
        console.log(`✅ Shipment 825 Found (ID: ${ship.id})`);
        console.log(`📊 Items Linked: ${ship.items.length}`);

        if (ship.items.length > 0) {
            console.log("Sample Item:", ship.items[0].productName);
        } else {
            console.log("⚠️ WARNING: 0 Items linked to this shipment.");
        }
    }
}
main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
