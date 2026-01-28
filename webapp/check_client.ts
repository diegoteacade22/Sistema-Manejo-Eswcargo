
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const client = await prisma.client.findFirst({
        where: {
            OR: [
                { id: 162 },
                { old_id: 162 }
            ]
        }
    });
    console.log('CLIENT_DATA:', JSON.stringify(client, null, 2));
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
