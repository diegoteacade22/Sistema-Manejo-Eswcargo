
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    const password = 'admin'; // Testing with simple 'admin' first or 'Admin123!'
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.upsert({
        where: { username: 'admin' },
        update: {
            password: hashedPassword,
            role: 'ADMIN'
        },
        create: {
            username: 'admin',
            password: hashedPassword,
            name: 'Administrador',
            email: 'info@eswcargo.com',
            role: 'ADMIN'
        }
    });

    console.log('Admin user reset/created with username: "admin" and password: "admin"');
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
