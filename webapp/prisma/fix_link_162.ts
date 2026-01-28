
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const user = await prisma.user.findUnique({
        where: { username: '162' }
    });

    const client = await prisma.client.findFirst({
        where: { old_id: 162 }
    });

    if (user && client) {
        await prisma.client.update({
            where: { id: client.id },
            data: { userId: user.id }
        });
        console.log(`Linked User ${user.username} with Client ${client.name} (${client.id})`);
    } else {
        console.log('User or Client not found.');
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
