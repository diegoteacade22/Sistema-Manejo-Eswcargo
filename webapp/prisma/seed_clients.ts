
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
    const seedFile = path.join(process.cwd(), 'prisma', 'clients_seed.json');
    if (!fs.existsSync(seedFile)) {
        console.error(`No clients_seed.json found at ${seedFile}.`);
        return;
    }

    const clients = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
    console.log(`Seeding ${clients.length} clients...`);

    for (const c of clients) {
        try {
            // Find by old_id
            const existing = await prisma.client.findFirst({
                where: { old_id: c.old_id }
            });

            const data = {
                old_id: c.old_id,
                name: c.name,
                email: c.email,
                phone: c.phone,
                type: c.type,
                address: c.address
            };

            if (existing) {
                await prisma.client.update({
                    where: { id: existing.id },
                    data: data
                });
            } else {
                await prisma.client.create({
                    data: data
                });
            }
        } catch (e) {
            console.error(`Error seeding client ${c.name}:`, e);
        }
    }
    console.log("Client seeding completed.");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
