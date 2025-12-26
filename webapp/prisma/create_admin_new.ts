import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function createAdmin() {
    const password = 'ESWCargo2025!';
    const hashedPassword = await bcrypt.hash(password, 10);

    const admin = await (prisma as any).user.upsert({
        where: { username: 'admin' },
        update: { password: hashedPassword },
        create: {
            username: 'admin',
            email: 'admin@eswcargo.com',
            password: hashedPassword,
            role: 'ADMIN',
            name: 'Administrador'
        }
    });

    console.log('✅ Admin created successfully!');
    console.log('Username: admin');
    console.log('Password: ESWCargo2025!');
    console.log('Role:', admin.role);
    await prisma.$disconnect();
}

createAdmin().catch(console.error);
