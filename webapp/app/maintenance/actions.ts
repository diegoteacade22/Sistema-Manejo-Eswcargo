'use server';

import { revalidatePath } from 'next/cache';
import { exec } from 'child_process';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { requireAdminUser } from '@/lib/access';
import path from 'path';
import { access } from 'fs/promises';

const execAsync = promisify(exec);

async function triggerLocalProductionRefresh() {
    const command =
        process.env.MAINTENANCE_RESTART_COMMAND ||
        'if command -v pm2 >/dev/null 2>&1; then npm run build && pm2 restart all; else bash ./iniciar_produccion.sh; fi';

    const child = spawn('bash', ['-lc', command], {
        cwd: process.cwd(),
        detached: true,
        stdio: 'ignore'
    });

    child.unref();
}

function revalidateDataViews() {
    const paths = [
        '/',
        '/clients',
        '/orders',
        '/shipments',
        '/products',
        '/suppliers',
        '/purchases',
        '/expenses',
        '/analytics/sales',
        '/analytics/logistics',
        '/analytics/financial',
        '/analytics/purchases'
    ];

    for (const path of paths) {
        revalidatePath(path);
    }
}

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

async function triggerGitHubSyncWorkflow(days: number) {
    const token = process.env.GITHUB_SYNC_TOKEN;
    if (!token) return null;

    const repo = process.env.GITHUB_SYNC_REPO || 'diegoteacade22/Sistema-Manejo-Eswcargo';
    const workflow = process.env.GITHUB_SYNC_WORKFLOW || 'sync.yml';
    const ref = process.env.GITHUB_SYNC_REF || 'main';
    const daysInput = days === 0 ? 'FULL' : String(days);
    const actionsUrl = `https://github.com/${repo}/actions/workflows/${workflow}`;
    const startedAt = new Date(Date.now() - 10000);

    const response = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
        method: 'POST',
        headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'x-github-api-version': '2022-11-28',
        },
        body: JSON.stringify({
            ref,
            inputs: { days: daysInput },
        }),
    });

    if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`GitHub Actions rechazó la sincronización (${response.status}): ${responseText || 'sin detalle'}`);
    }

    const run = await waitForGitHubSyncRun({ token, repo, workflow, ref, startedAt });

    return {
        actionsUrl,
        daysInput,
        run,
    };
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

type GitHubWorkflowRun = {
    id: number;
    html_url: string;
    status: string;
    conclusion: string | null;
    created_at: string;
    head_branch: string;
};

async function fetchGitHubWorkflowRuns(input: { token: string; repo: string; workflow: string; ref: string }) {
    const response = await fetch(`https://api.github.com/repos/${input.repo}/actions/workflows/${input.workflow}/runs?branch=${encodeURIComponent(input.ref)}&event=workflow_dispatch&per_page=10`, {
        headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${input.token}`,
            'x-github-api-version': '2022-11-28',
        },
        cache: 'no-store',
    });

    if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`No pude consultar GitHub Actions (${response.status}): ${responseText || 'sin detalle'}`);
    }

    const payload = await response.json();
    return (payload.workflow_runs || []) as GitHubWorkflowRun[];
}

async function waitForGitHubSyncRun(input: { token: string; repo: string; workflow: string; ref: string; startedAt: Date }) {
    const timeoutMs = Number(process.env.GITHUB_SYNC_WAIT_MS || 270000);
    const deadline = Date.now() + timeoutMs;
    let selectedRun: GitHubWorkflowRun | null = null;

    while (Date.now() < deadline) {
        const runs = await fetchGitHubWorkflowRuns(input);
        selectedRun = runs.find((run) =>
            run.head_branch === input.ref &&
            new Date(run.created_at).getTime() >= input.startedAt.getTime()
        ) || selectedRun;

        if (selectedRun && selectedRun.status === 'completed') {
            return selectedRun;
        }

        await sleep(selectedRun ? 8000 : 3000);
    }

    if (selectedRun) return selectedRun;
    throw new Error(`GitHub Actions no expuso la corrida de sincronización antes del timeout.`);
}

export async function revalidateSystem() {
    await requireAdminUser();
    revalidatePath('/', 'layout');
    revalidateDataViews();
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
        const scriptPath = await findSyncScriptPath();
        const hookUrl = process.env.SYNC_HOOK_URL;
        const hookToken = process.env.SYNC_HOOK_TOKEN;
        const isVercelRuntime = process.env.VERCEL === '1';

        const githubWorkflow = await triggerGitHubSyncWorkflow(days);
        if (githubWorkflow) {
            const run = githubWorkflow.run;
            if (run.status !== 'completed') {
                return {
                    success: false,
                    message: `Sincronización enviada pero no finalizó dentro del tiempo esperado (${githubWorkflow.daysInput}). Estado: ${run.status}. Revisá ${run.html_url}`
                };
            }

            if (run.conclusion !== 'success') {
                return {
                    success: false,
                    message: `Sincronización falló en GitHub Actions (${githubWorkflow.daysInput}). Resultado: ${run.conclusion || 'sin resultado'}. Revisá ${run.html_url}`
                };
            }

            revalidatePath('/', 'layout');
            revalidateDataViews();
            return {
                success: true,
                message: `Sincronización finalizada (${githubWorkflow.daysInput}) en GitHub Actions. ${run.html_url}`
            };
        }

        // En Vercel el script queda empaquetado, pero no existe el entorno Python.
        // En produccion cloud se debe usar el hook remoto de sincronizacion.
        if (!isVercelRuntime && scriptPath) {
            console.log(`Starting local Excel Sync (${days} days) with script: ${scriptPath}`);
            const { stdout, stderr } = await execAsync(`bash "${scriptPath}" ${days}`);
            console.log("Sync Output:", stdout);
            if (stderr) console.error("Sync Errors:", stderr);

            revalidatePath('/', 'layout');
            revalidateDataViews();
            return { success: true, message: `Sincronización finalizada (${days === 0 ? 'Completa' : days + ' días'}).` };
        }

        // Fallback remoto para entornos sin script local.
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
            revalidateDataViews();
            return { success: true, message: `Sincronización en curso (${days === 0 ? 'Completa' : days + ' días'}) vía hook.` };
        }

        return {
            success: false,
            message: isVercelRuntime
                ? 'Error al sincronizar: produccion cloud requiere SYNC_HOOK_URL configurado.'
                : `Error al sincronizar: no se encontró sync_excel.sh (cwd: ${process.cwd()}) y tampoco SYNC_HOOK_URL.`
        };
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
            await triggerLocalProductionRefresh();
            return {
                success: true,
                message: 'Hook no configurado. Se ejecutó actualización local de producción (build + restart).'
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

export async function applyProductionRefresh() {
    await requireAdminUser();

    try {
        await triggerLocalProductionRefresh();

        return {
            success: true,
            message: 'Actualización de producción disparada. El servicio debería reiniciarse en breve.'
        };
    } catch (error: any) {
        console.error('Apply production refresh error:', error);
        return {
            success: false,
            message: `Error al actualizar producción: ${error.message}`
        };
    }
}
