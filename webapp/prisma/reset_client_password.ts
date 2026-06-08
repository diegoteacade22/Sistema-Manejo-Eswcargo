
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    // 1. Find the user for Marcos Roku (likely username '162' or similar)
    // We'll search by name or username
    const users = await prisma.user.findMany({
        where: {
            OR: [
                { username: '162' },
                { name: { contains: 'Marcos' } }
            ]
        }
    });

    console.log('Found users:', users);

    if (users.length > 0) {
        // Reset password for the first match found (assuming it's the right one)
        const targetUser = users[0];
        const newPassword = '123'; // Simple password for the client
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await prisma.user.update({
            where: { id: targetUser.id },
            data: { password: hashedPassword }
        });
        console.log(`Password for user ${targetUser.username} (${targetUser.name}) reset to: ${newPassword}`);
    } else {
        console.log('User Marcos Roku / 162 not found in User table.');

        // Check if he exists as a Client and maybe create a User for him?
        // But the user said he sees him in the User Management list, so he must exist.
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
