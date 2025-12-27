
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

            if (existing) {
                // BIDIRECTIONAL SYNC: Only update fields that are empty in DB
                // Preserve manually edited data (email, phone, address, etc.)
                const updateData: any = {
                    name: c.name, // Always sync name from Excel
                    type: c.type || existing.type, // Update type if present in Excel
                };

                // Only update if field is empty/null in DB and has value in Excel
                if (!existing.email && c.email) updateData.email = c.email;
                if (!existing.phone && c.phone) updateData.phone = c.phone;
                if (!existing.address && c.address) updateData.address = c.address;
                if (!existing.document_id && c.document_id) updateData.document_id = c.document_id;

                // Preserve manually edited fields (city, state, country, zipCode, notes)
                // These are NOT updated from Excel to preserve manual edits

                await prisma.client.update({
                    where: { id: existing.id },
                    data: updateData
                });
                console.log(`✓ Updated client: ${c.name} (preserved manual edits)`);
            } else {
                // New client - create with all data from Excel
                await prisma.client.create({
                    data: {
                        old_id: c.old_id,
                        name: c.name,
                        email: c.email,
                        phone: c.phone,
                        type: c.type,
                        address: c.address
                    }
                });
                console.log(`✓ Created new client: ${c.name}`);
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
