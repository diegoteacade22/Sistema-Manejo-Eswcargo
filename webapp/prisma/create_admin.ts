
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function createAdmin() {
    const password = 'admin'; // User should change this later
    const hashedPassword = await bcrypt.hash(password, 10);

    const admin = await (prisma as any).user.upsert({
        where: { username: 'admin' },
        update: {},
        create: {
            username: 'admin',
            email: 'admin@eswcargo.com',
            password: hashedPassword,
            role: 'ADMIN',
            name: 'Administrador'
        }
    });

    console.log('Admin user created/verified:', admin.username);
    await prisma.$disconnect();
}

createAdmin().catch(console.error);
