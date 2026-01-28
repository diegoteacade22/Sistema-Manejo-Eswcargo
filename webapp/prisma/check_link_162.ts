
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const user = await prisma.user.findUnique({
        where: { username: '162' },
        include: { client: true }
    });

    console.log('User 162 details:', JSON.stringify(user, null, 2));

    const allClients = await prisma.client.findMany({
        where: { old_id: 162 }
    });
    console.log('Clients with old_id 162:', JSON.stringify(allClients, null, 2));
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
