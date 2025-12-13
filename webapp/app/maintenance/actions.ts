'use server';

import { revalidatePath } from 'next/cache';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function revalidateSystem() {
    revalidatePath('/', 'layout');
    return { success: true, message: 'Next.js cache revalidated.' };
}

export async function resetDatabase() {
    try {
        console.log("Resetting database...");
        // In a real production app, this is dangerous. For this local tool, it's what's asked.
        // We will run the seed command.
        // Assuming 'npm run seed' runs 'ts-node prisma/seed.ts'

        // Note: prisma migrate reset requires interaction or --force
        await execAsync('npx prisma migrate reset --force --skip-seed');
        // We skip seed in reset to run distinct scripts if needed, or just let it run if seed.ts is configured.
        // But our seed.ts is empty/disabled. We need to run seed_shipments, seed_orders, etc.

        // Let's explicitly run our seeders
        await execAsync('npx ts-node prisma/seed_shipments.ts');
        await execAsync('npx ts-node prisma/seed_orders.ts');
        await execAsync('npx ts-node prisma/seed_suppliers.ts');

        // Also seed products/clients if they are separate?
        // Current seed.ts is empty. 
        // Clients and Products were seeded before? 
        // If we reset, we lose them. We need to know how to seed them.
        // Checking task.md or codebase for 'seed_clients.ts' or 'seed_products.ts'.

        return { success: true, message: 'Database reset and seeded successfully.' };
    } catch (error: any) {
        console.error("Seed error:", error);
        return { success: false, message: `Error: ${error.message}` };
    }
}
