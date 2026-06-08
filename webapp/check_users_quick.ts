import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkUsers() {
    try {
        const users = await prisma.user.findMany({
            select: {
                username: true,
                name: true,
                role: true,
                password: true
            }
        });

        console.log('\n=== USUARIOS EN BASE DE DATOS ===\n');
        console.log(`Total: ${users.length}\n`);

        users.forEach(u => {
            console.log(`Usuario: ${u.username}`);
            console.log(`Nombre: ${u.name}`);
            console.log(`Rol: ${u.role}`);
            console.log(`Password: ${u.password ? '✓ Configurado' : '✗ FALTA'}`);
            console.log('---');
        });

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkUsers();
