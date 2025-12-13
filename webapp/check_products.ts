
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const total = await prisma.product.count();
    const active = await prisma.product.count({ where: { active: true } });
    const inactive = await prisma.product.count({ where: { active: false } });

    console.log(`Total Products: ${total}`);
    console.log(`Active Products: ${active}`);
    console.log(`Inactive Products: ${inactive}`);

    if (total > 0) {
        const first = await prisma.product.findFirst();
        console.log('Sample Product:', first);
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
