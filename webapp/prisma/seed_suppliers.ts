
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
    const jsonPath = path.join(process.cwd(), 'prisma', 'suppliers_seed.json');
    console.log(`Reading suppliers from ${jsonPath}...`);

    if (!fs.existsSync(jsonPath)) {
        console.error("suppliers_seed.json not found!");
        return;
    }

    const data = fs.readFileSync(jsonPath, 'utf-8');
    const suppliers = JSON.parse(data);

    console.log(`Found ${suppliers.length} suppliers to seed.`);

    let created = 0;

    for (const s of suppliers) {
        if (!s.name) continue;

        const existing = await (prisma as any).supplier.findFirst({
            where: { name: s.name }
        });

        if (existing) {
            await (prisma as any).supplier.update({
                where: { id: existing.id },
                data: {
                    contact: s.contact,
                    email: s.email,
                    phone: s.phone,
                    address: s.address,
                }
            });
        } else {
            await (prisma as any).supplier.create({
                data: {
                    name: s.name,
                    contact: s.contact,
                    email: s.email,
                    phone: s.phone,
                    address: s.address,
                }
            });
        }
        created++;
    }

    console.log(`Seeding complete. Processed ${created} suppliers.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
