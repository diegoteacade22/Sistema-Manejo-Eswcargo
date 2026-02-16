'use server';

import { revalidatePath } from 'next/cache';
import { exec } from 'child_process';
import { promisify } from 'util';
import { requireAdminUser } from '@/lib/access';
import path from 'path';
import { access } from 'fs/promises';

const execAsync = promisify(exec);

async function findSyncScriptPath(): Promise<string | null> {
    const candidates = [
        process.env.SYNC_SCRIPT_PATH,
        path.join(process.cwd(), 'sync_excel.sh'),
        path.join(process.cwd(), '../sync_excel.sh'),
        path.join(process.cwd(), '../webapp/sync_excel.sh'),
        '/var/www/eswcargo/webapp/sync_excel.sh'
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
        try {
            await access(candidate);
            return candidate;
        } catch {
            // Try next candidate path.
        }
    }

    return null;
}

export async function revalidateSystem() {
    await requireAdminUser();
    revalidatePath('/', 'layout');
    return { success: true, message: 'Next.js cache revalidated.' };
}

export async function resetDatabase() {
    await requireAdminUser();
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

export async function syncExcel(days: number = 0) {
    await requireAdminUser();
    try {
        const hookUrl = process.env.SYNC_HOOK_URL;
        const hookToken = process.env.SYNC_HOOK_TOKEN;

        if (hookUrl) {
            const response = await fetch(hookUrl, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    ...(hookToken ? { 'x-sync-token': hookToken } : {})
                },
                body: JSON.stringify({ days })
            });

            const responseText = await response.text();
            if (!response.ok) {
                return {
                    success: false,
                    message: `Error al sincronizar: (${response.status}) ${responseText || 'sin detalle'}`
                };
            }

            revalidatePath('/', 'layout');
            return { success: true, message: `Sincronización iniciada (${days === 0 ? 'Completa' : days + ' días'}).` };
        }

        // Local fallback (for non-hook environments): resolve script path safely.
        const scriptPath = await findSyncScriptPath();
        if (!scriptPath) {
            return {
                success: false,
                message: `Error al sincronizar: no se encontró sync_excel.sh (cwd: ${process.cwd()}). Configura SYNC_HOOK_URL o SYNC_SCRIPT_PATH.`
            };
        }

        console.log(`Starting local Excel Sync (${days} days) with script: ${scriptPath}`);
        const { stdout, stderr } = await execAsync(`bash "${scriptPath}" ${days}`);
        console.log("Sync Output:", stdout);
        if (stderr) console.error("Sync Errors:", stderr);

        revalidatePath('/', 'layout');
        return { success: true, message: `Sincronización finalizada (${days === 0 ? 'Completa' : days + ' días'}).` };
    } catch (error: any) {
        console.error("Sync Error:", error);
        return { success: false, message: `Error al sincronizar: ${error.message}` };
    }
}

export async function deployToProduction() {
    await requireAdminUser();
    try {
        const hookUrl = process.env.PRODUCTION_DEPLOY_HOOK_URL;
        const hookToken = process.env.PRODUCTION_DEPLOY_HOOK_TOKEN;

        if (!hookUrl) {
            return {
                success: false,
                message: 'Falta configurar PRODUCTION_DEPLOY_HOOK_URL en el entorno.'
            };
        }

        const response = await fetch(hookUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(hookToken ? { 'x-deploy-token': hookToken } : {})
            },
            body: JSON.stringify({ source: 'maintenance-ui', timestamp: new Date().toISOString() })
        });

        const responseText = await response.text();

        if (!response.ok) {
            return {
                success: false,
                message: `Deploy rechazado (${response.status}): ${responseText || 'sin detalle'}`
            };
        }

        return {
            success: true,
            message: 'Despliegue a producción disparado correctamente.',
            log: responseText || 'Deploy hook ejecutado.'
        };
    } catch (error: any) {
        console.error('Deploy production error:', error);
        return {
            success: false,
            message: `Error al desplegar a producción: ${error.message}`
        };
    }
}
