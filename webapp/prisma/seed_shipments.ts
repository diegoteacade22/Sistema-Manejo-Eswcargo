
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
    const jsonPath = path.join(process.cwd(), 'prisma', 'shipments_seed.json');
    console.log(`Reading shipments from ${jsonPath}...`);

    if (!fs.existsSync(jsonPath)) {
        console.error("shipments_seed.json not found!");
        return;
    }

    const data = fs.readFileSync(jsonPath, 'utf-8');
    const shipments = JSON.parse(data);

    console.log(`Found ${shipments.length} shipments to seed.`);

    // Pre-fetch clients map [old_id] -> [id]
    const clients = await prisma.client.findMany({ select: { id: true, old_id: true } });
    const clientMap = new Map<number, number>();
    clients.forEach((c: { id: number; old_id: number | null }) => {
        if (c.old_id) clientMap.set(c.old_id, c.id);
    });

    let created = 0;

    // Clear existing Shipment transactions to avoid double-billing (assuming Orders cover the cost)
    console.log("Clearing shipment financial transactions...");
    await prisma.transaction.deleteMany({
        where: { reference: { startsWith: 'ENVIO #' } }
    });

    for (const s of shipments) {
        if (!s.shipment_number) continue;

        let dbClientId = null;
        if (s.old_client_id) {
            dbClientId = clientMap.get(s.old_client_id);
        }

        // Parse dates correctly
        const shipDate = s.date_shipped ? new Date(s.date_shipped) : null;
        const arriveDate = s.date_arrived ? new Date(s.date_arrived) : null;

        await (prisma as any).shipment.upsert({
            where: { shipment_number: s.shipment_number },
            update: {
                clientId: dbClientId,
                forwarder: s.forwarder,
                date_shipped: shipDate,
                date_arrived: arriveDate,
                weight_fw: s.weight_fw,
                weight_cli: s.weight_cli,
                type_load: s.type_load,
                item_count: s.item_count,
                cost_total: s.cost_total,
                price_total: s.price_total,
                profit: s.profit,
                invoice: s.invoice,
                status: s.status,
                notes: s.notes
            },
            create: {
                shipment_number: s.shipment_number,
                clientId: dbClientId,
                forwarder: s.forwarder,
                date_shipped: shipDate,
                date_arrived: arriveDate,
                weight_fw: s.weight_fw,
                weight_cli: s.weight_cli,
                type_load: s.type_load,
                item_count: s.item_count,
                cost_total: s.cost_total,
                price_total: s.price_total,
                profit: s.profit,
                invoice: s.invoice,
                status: s.status,
                notes: s.notes
            }
        });

        // NOTE: We do NOT create Transactions for Shipments anymore.
        // The financial tracking is assumed to be handled in the Orders (CABE_VENTAS).
        // If specific shipment billing is needed, it should be added here carefully to avoid duplicates.

        created++;
    }

    console.log(`Seeding complete. Processed ${created} shipments.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
