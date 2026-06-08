
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- USERS IN DATABASE ---');
    const users = await prisma.user.findMany({
        select: {
            id: true,
            username: true,
            email: true,
            role: true,
            password: true
        }
    });

    if (users.length === 0) {
        console.log('No users found in database ❌');
    } else {
        users.forEach(u => {
            console.log(`- ID: ${u.id} | User: ${u.username} | Role: ${u.role} | Pwd Set: ${!!u.password}`);
        });
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
