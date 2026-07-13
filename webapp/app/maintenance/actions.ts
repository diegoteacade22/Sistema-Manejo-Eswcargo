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
    const startedAt = new Date().toISOString();

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

    let runId: number | null = null;
    let runUrl = actionsUrl;
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const runsResponse = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?branch=${encodeURIComponent(ref)}&event=workflow_dispatch&per_page=5`, {
        headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${token}`,
            'x-github-api-version': '2022-11-28',
        },
    });

    if (runsResponse.ok) {
        const runsData = await runsResponse.json();
        const matchingRun = runsData.workflow_runs?.find((run: any) => run.created_at >= startedAt);
        const run = matchingRun || runsData.workflow_runs?.[0];
        runId = run?.id || null;
        runUrl = run?.html_url || actionsUrl;
    }

    return {
        repo,
        runId,
        actionsUrl: runUrl,
        daysInput,
        token,
    };
}

export async function revalidateSystem() {
    await requireAdminUser();
    revalidatePath('/', 'layout');
    revalidateDataViews();
    return { success: true, message: 'Next.js cache revalidated.' };
}

export async function resetDatabase() {
    await requireAdminUser();
    return {
        success: false,
        message: 'El reinicio de base está bloqueado desde el sistema. La recuperación se realiza únicamente con respaldo y un procedimiento controlado.'
    };
}

function syncScopeLabel(days: number) {
    return days === 0 ? 'Completa' : `${days} días`;
}

export async function syncExcel(days: number = 0) {
    await requireAdminUser();
    try {
        const scriptPath = await findSyncScriptPath();
        const hookUrl = process.env.SYNC_HOOK_URL;
        const hookToken = process.env.SYNC_HOOK_TOKEN;
        const isVercelRuntime = process.env.VERCEL === '1';

        if (!isVercelRuntime && scriptPath) {
            console.log(`Starting local Excel Sync (${days} days) with script: ${scriptPath}`);
            const { stdout, stderr } = await execAsync(`bash "${scriptPath}" ${days}`);
            console.log("Sync Output:", stdout);
            if (stderr) console.error("Sync Errors:", stderr);

            revalidatePath('/', 'layout');
            revalidateDataViews();
            return { success: true, message: `OK: actualización rápida finalizada (${syncScopeLabel(days)}). Ya podés ver los cambios en el sistema.` };
        }

        if (hookUrl && hookUrl.trim().length > 0) {
            const startedAt = Date.now();
            const response = await fetch(hookUrl, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    ...(hookToken ? { 'x-sync-token': hookToken } : {})
                },
                body: JSON.stringify({ days })
            });

            const responseText = await response.text();
            const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
            if (!response.ok) {
                return {
                    success: false,
                    message: `Error al sincronizar: (${response.status}) ${responseText || 'sin detalle'}`
                };
            }

            revalidatePath('/', 'layout');
            revalidateDataViews();
            return {
                success: true,
                message: `OK: actualización rápida finalizada (${syncScopeLabel(days)}) en ${elapsedSeconds}s. Ya podés ver los cambios en el sistema.`,
                log: responseText || undefined
            };
        }

        if (isVercelRuntime) {
            const githubWorkflow = await triggerGitHubSyncWorkflow(days);
            if (!githubWorkflow) {
                return {
                    success: false,
                    message: 'Error al sincronizar: producción cloud requiere GITHUB_SYNC_TOKEN.'
                };
            }

            return {
                success: true,
                message: `Actualización cloud iniciada (${githubWorkflow.daysInput} días). Verificá su finalización antes de emitir documentos: ${githubWorkflow.actionsUrl}`
            };
        }

        return {
            success: false,
            message: `Error al sincronizar: no se encontró sync_excel.sh (cwd: ${process.cwd()}) y tampoco SYNC_HOOK_URL.`
        };
    } catch (error: any) {
        console.error("Sync Error:", error);
        return { success: false, message: `Error al sincronizar: ${error.message}` };
    }
}

export async function getGitHubSyncStatus() {
    await requireAdminUser();
    try {
        const token = process.env.GITHUB_SYNC_TOKEN;
        if (!token) {
            return { success: false, message: 'No está configurado el acceso para verificar la actualización cloud.' };
        }

        const repo = process.env.GITHUB_SYNC_REPO || 'diegoteacade22/Sistema-Manejo-Eswcargo';
        const workflow = process.env.GITHUB_SYNC_WORKFLOW || 'sync.yml';
        const ref = process.env.GITHUB_SYNC_REF || 'main';
        const response = await fetch(
            `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?branch=${encodeURIComponent(ref)}&per_page=1`,
            {
                headers: {
                    accept: 'application/vnd.github+json',
                    authorization: `Bearer ${token}`,
                    'x-github-api-version': '2022-11-28',
                },
                cache: 'no-store',
            }
        );

        if (!response.ok) {
            return { success: false, message: `No se pudo verificar la actualización cloud (${response.status}).` };
        }

        const data = await response.json();
        const run = data.workflow_runs?.[0];
        if (!run) {
            return { success: false, message: 'No hay actualizaciones cloud registradas todavía.' };
        }

        if (run.status !== 'completed') {
            return { success: true, message: `La actualización cloud sigue ${run.status === 'queued' ? 'en cola' : 'en ejecución'}.` };
        }

        if (run.conclusion !== 'success') {
            return { success: false, message: `La última actualización cloud terminó con estado ${run.conclusion || 'desconocido'}: ${run.html_url}` };
        }

        revalidatePath('/', 'layout');
        revalidateDataViews();
        return { success: true, message: 'OK: la última actualización cloud finalizó correctamente. Los datos ya están disponibles.' };
    } catch (error: any) {
        console.error('GitHub sync status error:', error);
        return { success: false, message: `No se pudo verificar la actualización cloud: ${error.message}` };
    }
}

type SyncHistoryItem = {
    id: number;
    scope: string;
    status: string;
    conclusion: string | null;
    createdAt: string;
    updatedAt: string;
    url: string;
};

function getSyncScope(run: any) {
    const title = String(run.display_title || run.name || '');
    const match = title.match(/(?:Sync ESWCARGO\s+)?(FULL|\d+)\s*d[ií]as?/i);
    if (match?.[1]) return match[1].toUpperCase() === 'FULL' ? 'Histórico' : `${match[1]} días`;
    return 'No informado';
}

export async function getSyncControlCenter() {
    await requireAdminUser();

    try {
        const token = process.env.GITHUB_SYNC_TOKEN;
        if (!token) {
            return {
                success: false,
                message: 'No está configurado el acceso para consultar el historial de sincronizaciones.',
                history: [],
                exceptions: [],
                lastSuccessAt: null,
            };
        }

        const repo = process.env.GITHUB_SYNC_REPO || 'diegoteacade22/Sistema-Manejo-Eswcargo';
        const workflow = process.env.GITHUB_SYNC_WORKFLOW || 'sync.yml';
        const ref = process.env.GITHUB_SYNC_REF || 'main';
        const response = await fetch(
            `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?branch=${encodeURIComponent(ref)}&per_page=12`,
            {
                headers: {
                    accept: 'application/vnd.github+json',
                    authorization: `Bearer ${token}`,
                    'x-github-api-version': '2022-11-28',
                },
                cache: 'no-store',
            }
        );

        if (!response.ok) {
            return {
                success: false,
                message: `No se pudo cargar el historial cloud (${response.status}).`,
                history: [],
                exceptions: [],
                lastSuccessAt: null,
            };
        }

        const data = await response.json();
        const history: SyncHistoryItem[] = (data.workflow_runs || []).map((run: any) => ({
            id: run.id,
            scope: getSyncScope(run),
            status: run.status || 'unknown',
            conclusion: run.conclusion || null,
            createdAt: run.created_at,
            updatedAt: run.updated_at,
            url: run.html_url,
        }));
        const now = Date.now();
        const exceptions: Array<{ level: 'error' | 'warning'; title: string; detail: string; url?: string }> = [];
        const latestSuccess = history.find((run) => run.status === 'completed' && run.conclusion === 'success');
        const latestSuccessMs = latestSuccess ? new Date(latestSuccess.updatedAt).getTime() : 0;

        for (const run of history) {
            const ageMs = now - new Date(run.createdAt).getTime();
            const finishedAfterLatestSuccess = new Date(run.updatedAt).getTime() > latestSuccessMs;
            if (run.status === 'completed' && run.conclusion && run.conclusion !== 'success' && finishedAfterLatestSuccess) {
                exceptions.push({
                    level: 'error',
                    title: `Actualización ${run.scope} con error`,
                    detail: `Terminó con estado ${run.conclusion}. Sus cambios no deben considerarse aplicados.`,
                    url: run.url,
                });
            }
            if (run.status !== 'completed' && ageMs > 20 * 60 * 1000) {
                exceptions.push({
                    level: 'warning',
                    title: `Actualización ${run.scope} demorada`,
                    detail: `Sigue ${run.status === 'queued' ? 'en cola' : 'en ejecución'} hace más de 20 minutos.`,
                    url: run.url,
                });
            }
        }

        if (!latestSuccess) {
            exceptions.push({
                level: 'error',
                title: 'No hay una actualización cloud validada',
                detail: 'No se encontró una ejecución exitosa entre los últimos procesos registrados.',
            });
        } else if (now - new Date(latestSuccess.updatedAt).getTime() > 30 * 60 * 60 * 1000) {
            exceptions.push({
                level: 'warning',
                title: 'Actualización desactualizada',
                detail: 'La última actualización validada tiene más de 30 horas.',
                url: latestSuccess.url,
            });
        }

        return {
            success: true,
            message: exceptions.length ? 'Hay excepciones para revisar.' : 'OK: no hay excepciones activas en las últimas sincronizaciones.',
            history,
            exceptions,
            lastSuccessAt: latestSuccess?.updatedAt || null,
        };
    } catch (error: any) {
        console.error('Sync control center error:', error);
        return {
            success: false,
            message: `No se pudo cargar el centro de control: ${error.message}`,
            history: [],
            exceptions: [],
            lastSuccessAt: null,
        };
    }
}

export async function syncExcelInGitHub(days: number = 7) {
    await requireAdminUser();

    try {
        const githubWorkflow = await triggerGitHubSyncWorkflow(days);
        if (!githubWorkflow) {
            return {
                success: false,
                message: 'Error: falta GITHUB_SYNC_TOKEN para ejecutar la sincronización opcional en GitHub.'
            };
        }

        return {
            success: true,
            message: `GitHub iniciado (${githubWorkflow.daysInput}). Seguimiento: ${githubWorkflow.actionsUrl}`
        };
    } catch (error: any) {
        console.error("GitHub Sync Error:", error);
        return { success: false, message: `Error al iniciar GitHub: ${error.message}` };
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
