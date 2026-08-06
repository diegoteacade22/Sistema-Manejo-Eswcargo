'use server';

import { revalidatePath } from 'next/cache';
import { exec } from 'child_process';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { requireAdminUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import path from 'path';
import { access } from 'fs/promises';
import clientBalanceControls from '@/scripts/client-balance-controls.json';
import { randomUUID } from 'node:crypto';
import { runDirectSheetSync } from '@/lib/direct-sheet-sync';

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
    const requestId = randomUUID();
    const actionsUrl = `https://github.com/${repo}/actions/workflows/${workflow}`;

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
            inputs: { days: daysInput, request_id: requestId },
        }),
    });

    if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`GitHub Actions rechazó la sincronización (${response.status}): ${responseText || 'sin detalle'}`);
    }

    let runId: number | null = null;
    let runUrl = actionsUrl;
    for (let attempt = 0; attempt < 8 && !runId; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        const runsResponse = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?branch=${encodeURIComponent(ref)}&event=workflow_dispatch&per_page=20`, {
            headers: {
                accept: 'application/vnd.github+json',
                authorization: `Bearer ${token}`,
                'x-github-api-version': '2022-11-28',
            },
            cache: 'no-store',
        });

        if (!runsResponse.ok) continue;
        const runsData = await runsResponse.json();
        const matchingRun = runsData.workflow_runs?.find((run: any) =>
            String(run.display_title || run.name || '').includes(requestId)
        );
        runId = matchingRun?.id || null;
        runUrl = matchingRun?.html_url || actionsUrl;
    }

    return {
        repo,
        runId,
        requestId,
        actionsUrl: runUrl,
        daysInput,
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

function getRequestedSyncScope(days: number) {
    return days === 0 ? 'completa' : `ultimos ${days} dias`;
}

export async function syncExcel(requestedDays: number = 7) {
    await requireAdminUser();
    const days = [0, 7, 30].includes(requestedDays) ? requestedDays : 7;
    const syncScope = getRequestedSyncScope(days);
    try {
        const scriptPath = await findSyncScriptPath();
        const hookUrl = process.env.SYNC_HOOK_URL;
        const hookToken = process.env.SYNC_HOOK_TOKEN;
        const isVercelRuntime = process.env.VERCEL === '1';
        const directSyncEnabled = process.env.DIRECT_SHEETS_SYNC_ENABLED === 'true';

        if (!isVercelRuntime && scriptPath) {
            console.log(`Starting local Excel Sync (${days} days) with script: ${scriptPath}`);
            const { stdout, stderr } = await execAsync(`bash "${scriptPath}" ${days}`);
            console.log("Sync Output:", stdout);
            if (stderr) console.error("Sync Errors:", stderr);

            revalidatePath('/', 'layout');
            revalidateDataViews();
            return { success: true, message: `OK: actualizacion ${syncScope} finalizada. Ya podes ver los cambios en el sistema.` };
        }

        if (isVercelRuntime && days !== 0 && directSyncEnabled) {
            let result;
            try {
                result = await runDirectSheetSync({ days });
            } catch (error) {
                console.error('Direct Sheets sync failed:', error);
                return {
                    success: false,
                    message: 'La actualización directa se detuvo sin aplicar cambios. Revisá el control de sincronización o usá la reconciliación completa.',
                };
            }
            const changed = result.summary.created.shipments
                + result.summary.created.orders
                + result.summary.updated.shipments
                + result.summary.updated.orders
                + result.summary.replaced.orderItems;
            revalidatePath('/', 'layout');
            revalidateDataViews();
            return {
                success: true,
                completed: true,
                message: `OK: actualizacion directa finalizada en ${Math.max(1, Math.round(result.durationMs / 1000))}s. ${changed} cambios aplicados y verificados.`,
                summary: result.summary,
            };
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
                message: `OK: actualizacion ${syncScope} finalizada en ${elapsedSeconds}s. Ya podes ver los cambios en el sistema.`,
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
                completed: false,
                runId: githubWorkflow.runId,
                requestId: githubWorkflow.requestId,
                url: githubWorkflow.actionsUrl,
                message: `Actualizacion cloud ${syncScope} en cola. El panel seguira esta corrida hasta que finalice.`
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

export async function getGitHubSyncStatus(runId?: number | null, requestId?: string | null) {
    await requireAdminUser();
    try {
        const token = process.env.GITHUB_SYNC_TOKEN;
        if (!token) {
            return { success: false, message: 'No está configurado el acceso para verificar la actualización cloud.' };
        }

        const repo = process.env.GITHUB_SYNC_REPO || 'diegoteacade22/Sistema-Manejo-Eswcargo';
        const workflow = process.env.GITHUB_SYNC_WORKFLOW || 'sync.yml';
        const ref = process.env.GITHUB_SYNC_REF || 'main';
        const endpoint = runId
            ? `https://api.github.com/repos/${repo}/actions/runs/${runId}`
            : `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?branch=${encodeURIComponent(ref)}&event=workflow_dispatch&per_page=${requestId ? 20 : 1}`;
        const response = await fetch(
            endpoint,
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
        const run = runId
            ? data
            : requestId
                ? data.workflow_runs?.find((candidate: any) =>
                    String(candidate.display_title || candidate.name || '').includes(requestId)
                )
                : data.workflow_runs?.[0];
        if (!run) {
            return {
                success: true,
                completed: false,
                runId: runId || null,
                requestId: requestId || null,
                message: 'La actualización fue solicitada y todavía está ingresando en la cola de GitHub.'
            };
        }

        if (run.status !== 'completed') {
            return {
                success: true,
                completed: false,
                runId: run.id,
                requestId: requestId || null,
                url: run.html_url,
                message: `La actualización cloud sigue ${run.status === 'queued' ? 'en cola' : 'en ejecución'}.`
            };
        }

        if (run.conclusion !== 'success') {
            return {
                success: false,
                completed: true,
                runId: run.id,
                requestId: requestId || null,
                url: run.html_url,
                message: `La actualización cloud terminó con estado ${run.conclusion || 'desconocido'}: ${run.html_url}`
            };
        }

        revalidatePath('/', 'layout');
        revalidateDataViews();
        return {
            success: true,
            completed: true,
            runId: run.id,
            requestId: requestId || null,
            url: run.html_url,
            message: 'OK: la actualización cloud finalizó correctamente. Los datos ya están disponibles.'
        };
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
    durationSeconds: number | null;
    url: string;
};

type SyncException = {
    level: 'error' | 'warning';
    title: string;
    detail: string;
    url?: string;
};

type PersistedSyncChange = {
    createdAt: Date;
    entity: string;
    entityKey: string;
    action: string;
    reason: string;
    syncRun: { id: number; status: string; finishedAt: Date | null };
};

function money(value: number) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2,
    }).format(value);
}

function purchaseIdFromDescription(description: string | null) {
    const match = String(description || '').match(/\bcompra\s*#\s*(\d+)\b/i);
    return match ? Number(match[1]) : null;
}

function orderNumberFromTransaction(reference: string | null, description: string | null) {
    const directReference = String(reference || '').trim();
    if (/^\d+$/.test(directReference)) return Number(directReference);

    const match = `${description || ''} ${reference || ''}`.match(/(?:PEDIDO|ORDER)\s*#?\s*(\d+)/i);
    return match ? Number(match[1]) : null;
}

async function getLedgerIntegrityExceptions(): Promise<SyncException[]> {
    const exceptions: SyncException[] = [];
    const cashFlowClientOldIds = new Set(clientBalanceControls.cashFlowAccounts.map((account) => account.oldId));
    const confirmedZeroClientOldIds = new Set(clientBalanceControls.lockedBalances.map((account) => account.oldId));
    const orderChargeTransactions = await prisma.transaction.findMany({
        where: {
            clientId: { not: null },
            type: 'CARGO',
            amount: { lt: 0 },
            NOT: { reference: { startsWith: 'CC-Import-' } },
        },
        select: {
            id: true,
            clientId: true,
            amount: true,
            description: true,
            reference: true,
            client: { select: { old_id: true, name: true } },
        },
    });
    const referencedOrderNumbers = [...new Set(orderChargeTransactions
        .map((transaction) => orderNumberFromTransaction(transaction.reference, transaction.description))
        .filter((value): value is number => value !== null))];
    const sourceOrders = referencedOrderNumbers.length
        ? await prisma.order.findMany({
            where: { order_number: { in: referencedOrderNumbers } },
            select: { order_number: true, clientId: true, client: { select: { old_id: true, name: true } } },
        })
        : [];
    const sourceOrderByNumber = new Map(sourceOrders.map((order) => [order.order_number, order]));
    const wrongClientOrderCharges = orderChargeTransactions.flatMap((transaction) => {
        const orderNumber = orderNumberFromTransaction(transaction.reference, transaction.description);
        const order = orderNumber ? sourceOrderByNumber.get(orderNumber) : null;
        if (!order || order.clientId === transaction.clientId) return [];
        return [{ transaction, orderNumber, order }];
    });
    if (wrongClientOrderCharges.length) {
        const examples = wrongClientOrderCharges
            .slice(0, 3)
            .map(({ transaction, orderNumber, order }) => `pedido #${orderNumber}: CC ${transaction.client?.name || '-'} #${transaction.client?.old_id ?? '-'}, fuente ${order.client?.name || '-'} #${order.client?.old_id ?? '-'}`)
            .join('; ');
        exceptions.push({
            level: 'error',
            title: `${wrongClientOrderCharges.length} cargo(s) asignado(s) a un cliente distinto del pedido`,
            detail: `${examples}. No se modificaron automáticamente: requiere revisar el pedido y el comprobante antes de cobrar o emitir.`,
            url: '/analytics/financial',
        });
    }

    const wrongSignTransactions = await prisma.transaction.findMany({
        where: {
            clientId: { not: null },
            OR: [
                { type: 'PAGO', amount: { lt: 0 } },
                { type: 'CARGO', amount: { gt: 0 } },
            ],
            NOT: { reference: { startsWith: 'CC-Import-' } },
        },
        select: {
            id: true,
            type: true,
            amount: true,
            description: true,
            client: { select: { old_id: true, name: true } },
        },
        take: 10,
    });
    if (wrongSignTransactions.length) {
        const examples = wrongSignTransactions
            .map((transaction) => `${transaction.client?.name || 'Cliente'} #${transaction.client?.old_id ?? '-'} (${transaction.type} ${money(transaction.amount)})`)
            .join('; ');
        exceptions.push({
            level: 'warning',
            title: `${wrongSignTransactions.length} movimiento(s) de cliente con signo a revisar`,
            detail: `${examples}. No se modificaron porque requieren respaldo contable.`,
            url: '/analytics/financial',
        });
    }

    const baselineTransactions = await prisma.transaction.findMany({
        where: { reference: { startsWith: 'CC-ZERO-BASELINE-2026:' } },
        select: {
            clientId: true,
            amount: true,
            client: { select: { old_id: true, name: true } },
        },
    });
    const baselineClientIds = [...new Set(baselineTransactions.map((transaction) => transaction.clientId).filter((id): id is number => id !== null))];
    const baselineBalances = baselineClientIds.length
        ? await prisma.transaction.groupBy({
            by: ['clientId'],
            where: {
                clientId: { in: baselineClientIds },
                NOT: { reference: { startsWith: 'CC-Import-' } },
            },
            _sum: { amount: true },
            _count: { _all: true },
        })
        : [];
    const baselineBalanceByClientId = new Map(baselineBalances.map((balance) => [balance.clientId, balance]));
    const baselineOnlyAccounts = baselineTransactions.filter((baseline) => {
        if (baseline.clientId === null) return false;
        return (baselineBalanceByClientId.get(baseline.clientId)?._count._all || 0) === 1;
    });
    if (baselineOnlyAccounts.length) {
        const examples = baselineOnlyAccounts
            .slice(0, 4)
            .map((baseline) => `${baseline.client?.name || 'Cliente'} #${baseline.client?.old_id ?? '-'} (${money(baseline.amount)})`)
            .join('; ');
        exceptions.push({
            level: 'warning',
            title: `${baselineOnlyAccounts.length} cuenta(s) con solo un ajuste histórico`,
            detail: `${examples}. No existe movimiento operativo asociado en el sistema; conservar hasta contrastar el saldo con respaldo externo.`,
            url: '/analytics/financial',
        });
    }

    const baselineMixedAccounts = [...new Map(
        baselineTransactions
            .filter((baseline) => {
                if (baseline.clientId === null || cashFlowClientOldIds.has(baseline.client?.old_id ?? -1)) return false;
                return (baselineBalanceByClientId.get(baseline.clientId)?._count._all || 0) > 1;
            })
            .map((baseline) => [baseline.clientId, baseline]),
    ).values()];
    if (baselineMixedAccounts.length) {
        const examples = baselineMixedAccounts
            .slice(0, 4)
            .map((baseline) => `${baseline.client?.name || 'Cliente'} #${baseline.client?.old_id ?? '-'} (${money(baselineBalanceByClientId.get(baseline.clientId!)?._sum.amount || 0)})`)
            .join('; ');
        exceptions.push({
            level: 'warning',
            title: `${baselineMixedAccounts.length} cuenta(s) con ajuste histórico y movimientos mezclados`,
            detail: `${examples}. No se separan ni recalculan automáticamente: requiere respaldos para distinguir el saldo inicial de los movimientos operativos.`,
            url: '/analytics/financial',
        });
    }

    const reconciliationAdjustments = await prisma.transaction.findMany({
        where: { reference: { startsWith: 'CASHFLOW-RECONCILIATION-2026:' } },
        select: {
            clientId: true,
            amount: true,
            client: { select: { old_id: true, name: true } },
        },
    });
    if (reconciliationAdjustments.length) {
        const examples = reconciliationAdjustments
            .slice(0, 4)
            .map((transaction) => `${transaction.client?.name || 'Cliente'} #${transaction.client?.old_id ?? '-'} (${money(transaction.amount)})`)
            .join('; ');
        exceptions.push({
            level: 'error',
            title: `${reconciliationAdjustments.length} cuenta(s) con ajuste global de conciliación`,
            detail: `${examples}. El saldo final coincide con la fuente, pero no se considera conciliado hasta respaldar o sustituir cada diferencia por movimiento.`,
            url: '/maintenance/evidence',
        });
    }

    const accountTransactions = await prisma.transaction.findMany({
        where: { clientId: { not: null } },
        select: {
            clientId: true,
            reference: true,
            client: { select: { old_id: true, name: true } },
        },
    });
    const accountTransactionsByClient = new Map<number, typeof accountTransactions>();
    for (const transaction of accountTransactions) {
        if (transaction.clientId === null) continue;
        accountTransactionsByClient.set(transaction.clientId, [...(accountTransactionsByClient.get(transaction.clientId) || []), transaction]);
    }
    const operationalAccountsWithoutFinancialSource = [...accountTransactionsByClient.values()]
        .filter((transactions) => {
            const client = transactions[0]?.client;
            const oldId = client?.old_id;
            const hasBaseline = transactions.some((transaction) => String(transaction.reference || '').startsWith('CC-ZERO-BASELINE-2026:'));
            return !hasBaseline && !cashFlowClientOldIds.has(oldId ?? -1) && !confirmedZeroClientOldIds.has(oldId ?? -1);
        });
    if (operationalAccountsWithoutFinancialSource.length) {
        const examples = operationalAccountsWithoutFinancialSource
            .slice(0, 4)
            .map((transactions) => {
                const client = transactions[0]?.client;
                return `${client?.name || 'Cliente'} #${client?.old_id ?? '-'}`;
            })
            .join('; ');
        exceptions.push({
            level: 'warning',
            title: `${operationalAccountsWithoutFinancialSource.length} cuenta(s) operativa(s) sin fuente financiera vigente`,
            detail: `${examples}. No se consideran conciliadas hasta contar con Cash Flow, Invoice o comprobantes verificables.`,
            url: '/analytics/financial',
        });
    }

    const artificialBaselines = baselineTransactions.filter((baseline) => {
        if (baseline.clientId === null) return false;
        const balance = baselineBalanceByClientId.get(baseline.clientId);
        const currentBalance = balance?._sum.amount || 0;
        const txCount = balance?._count._all || 0;
        return (txCount === 1 && Math.abs(baseline.amount) > 5000)
            || (Math.abs(baseline.amount) > 100000 && Math.abs(currentBalance) > 1000);
    });
    if (artificialBaselines.length) {
        const examples = artificialBaselines
            .slice(0, 4)
            .map((baseline) => `${baseline.client?.name || 'Cliente'} #${baseline.client?.old_id ?? '-'} (${money(baseline.amount)})`)
            .join('; ');
        exceptions.push({
            level: 'warning',
            title: `${artificialBaselines.length} ajuste(s) histórico(s) de saldo a validar`,
            detail: `${examples}. Se mantienen sin cambios hasta contrastarlos con respaldo contable o Cash Flow.`,
            url: '/analytics/financial',
        });
    }

    const clientPayments = await prisma.transaction.findMany({
        where: {
            clientId: { not: null },
            type: 'PAGO',
            amount: { gt: 0 },
            reference: { not: null },
            NOT: { reference: { startsWith: 'CC-Import-' } },
        },
        select: {
            id: true,
            clientId: true,
            date: true,
            amount: true,
            reference: true,
            client: { select: { old_id: true, name: true } },
        },
        orderBy: [{ clientId: 'asc' }, { date: 'asc' }, { id: 'asc' }],
    });
    const paymentGroups = new Map<string, typeof clientPayments>();
    for (const payment of clientPayments) {
        const reference = String(payment.reference || '').trim().toUpperCase();
        if (!reference) continue;
        const key = [
            payment.clientId,
            payment.date.toISOString().slice(0, 10),
            Math.round(payment.amount * 100),
            reference,
        ].join('|');
        paymentGroups.set(key, [...(paymentGroups.get(key) || []), payment]);
    }
    const repeatedPayments = [...paymentGroups.values()].filter((group) => group.length > 1);
    if (repeatedPayments.length) {
        const examples = repeatedPayments
            .slice(0, 3)
            .map((group) => {
                const payment = group[0];
                return `${payment.client?.name || 'Cliente'} #${payment.client?.old_id ?? '-'} ${payment.date.toISOString().slice(0, 10)} ${money(payment.amount)} (${payment.reference}, tx ${group.map((item) => item.id).join('/')})`;
            })
            .join('; ');
        exceptions.push({
            level: 'warning',
            title: `${repeatedPayments.length} posible(s) pago(s) duplicado(s)`,
            detail: `${examples}. Se conserva la cuenta hasta verificar comprobantes; los nuevos pagos con esa misma referencia ya se bloquean.`,
            url: '/collections',
        });
    }

    const supplierTransactions = await prisma.transaction.findMany({
        where: { supplierId: { not: null } },
        select: {
            supplierId: true,
            type: true,
            amount: true,
            reference: true,
            description: true,
            supplier: { select: { name: true } },
        },
    });
    const settlementGroups = new Map<string, typeof supplierTransactions>();
    const referencedPurchaseIds = new Set<number>();
    for (const transaction of supplierTransactions) {
        const reference = String(transaction.reference || '').trim().toUpperCase();
        if (reference) {
            const key = `${transaction.supplierId}|${reference}`;
            settlementGroups.set(key, [...(settlementGroups.get(key) || []), transaction]);
        }
        const purchaseId = purchaseIdFromDescription(transaction.description);
        if (purchaseId) referencedPurchaseIds.add(purchaseId);
    }

    const mismatches = [...settlementGroups.values()].flatMap((group) => {
        const charged = group
            .filter((transaction) => transaction.type === 'CARGO' && transaction.amount < 0)
            .reduce((total, transaction) => total + Math.abs(transaction.amount), 0);
        const paid = group
            .filter((transaction) => transaction.type === 'PAGO' && transaction.amount > 0)
            .reduce((total, transaction) => total + transaction.amount, 0);
        if (!charged || !paid || Math.abs(charged - paid) <= 0.01) return [];
        return [{ supplier: group[0].supplier?.name || 'Proveedor', reference: group[0].reference || '-', charged, paid }];
    });
    if (mismatches.length) {
        const examples = mismatches
            .slice(0, 3)
            .map((item) => `${item.supplier} ${item.reference}: cargo ${money(item.charged)}, pago ${money(item.paid)}`)
            .join('; ');
        exceptions.push({
            level: 'warning',
            title: `${mismatches.length} diferencia(s) entre cargo y pago de proveedor`,
            detail: `${examples}. Se mantienen sin cambios hasta contar con comprobante.`,
            url: '/purchases',
        });
    }

    const purchases = referencedPurchaseIds.size
        ? await prisma.purchase.findMany({ where: { id: { in: [...referencedPurchaseIds] } }, select: { id: true } })
        : [];
    const existingPurchaseIds = new Set(purchases.map((purchase) => purchase.id));
    const unlinkedPurchaseReferences = supplierTransactions.filter((transaction) => {
        const purchaseId = purchaseIdFromDescription(transaction.description);
        return transaction.type === 'CARGO' && transaction.amount < 0 && purchaseId && !existingPurchaseIds.has(purchaseId);
    });
    if (unlinkedPurchaseReferences.length) {
        exceptions.push({
            level: 'warning',
            title: `${unlinkedPurchaseReferences.length} cargo(s) de proveedor sin compra interna vinculada`,
            detail: 'Se detectaron referencias históricas sin registro de compra. La auditoría las conserva visibles y no crea compras retrospectivas.',
            url: '/purchases',
        });
    }

    return exceptions;
}

async function getPackingContentExceptions(): Promise<SyncException[]> {
    const shipments = await prisma.shipment.findMany({
        select: {
            id: true,
            shipment_number: true,
            status: true,
            item_count: true,
            cargo_description: true,
            items: { select: { id: true } },
            orders: { select: { items: { select: { id: true, shipmentId: true } } } },
        },
    });

    return shipments
        .filter((shipment) => !['', 'COMPRAR', '100', '200', '#REF!'].includes(String(shipment.status || '').trim().toUpperCase()))
        .filter((shipment) => {
            if (!shipment.item_count || shipment.cargo_description?.trim()) return false;

            const itemIds = new Set(shipment.items.map((item) => item.id));
            for (const order of shipment.orders) {
                const hasExplicitShipmentItems = order.items.some((item) => item.shipmentId);
                for (const item of order.items) {
                    if (item.shipmentId === shipment.id || (!hasExplicitShipmentItems && !item.shipmentId)) {
                        itemIds.add(item.id);
                    }
                }
            }
            return itemIds.size === 0;
        })
        .map((shipment) => ({
            level: 'error' as const,
            title: `Packing #${shipment.shipment_number ?? shipment.id} sin contenido confirmado`,
            detail: 'No se puede emitir hasta cargar artículos o una descripción operativa verificada.',
            url: `/shipments/${shipment.id}/packing-list`,
        }));
}

function getSyncScope(run: any) {
    const title = String(run.display_title || run.name || '');
    const match = title.match(/(?:Sync ESWCARGO\s+)?(FULL|\d+)\s*d[ií]as?/i);
    if (match?.[1]) return match[1].toUpperCase() === 'FULL' ? 'Histórico' : `${match[1]} días`;
    return 'No informado';
}

function getRunDurationSeconds(run: any) {
    const startedAt = run.run_started_at || run.created_at;
    const endedAt = run.updated_at;
    const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
    return Number.isFinite(durationMs) && durationMs >= 0 ? Math.round(durationMs / 1000) : null;
}

export async function getSyncControlCenter() {
    await requireAdminUser();

    try {
        const token = process.env.GITHUB_SYNC_TOKEN;
        if (!token) {
            const exceptions = [
                ...await getPackingContentExceptions(),
                ...await getLedgerIntegrityExceptions(),
            ];
            return {
                success: true,
                message: 'No está configurado el historial cloud. Se muestran los controles locales disponibles.',
                history: [],
                exceptions,
                changes: [],
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
                changes: [],
                lastSuccessAt: null,
            };
        }

        const data = await response.json();
        const changes = await prisma.syncChange.findMany({
            orderBy: { createdAt: 'desc' },
            // Se conserva una bitacora reciente acotada, pero debe incluir todas
            // las excepciones de una corrida completa (hoy hay 14 de la fuente).
            take: 50,
            select: {
                createdAt: true,
                entity: true,
                entityKey: true,
                action: true,
                reason: true,
                syncRun: { select: { id: true, status: true, finishedAt: true } },
            },
        }) as PersistedSyncChange[];
        const history: SyncHistoryItem[] = (data.workflow_runs || []).map((run: any) => ({
            id: run.id,
            scope: getSyncScope(run),
            status: run.status || 'unknown',
            conclusion: run.conclusion || null,
            createdAt: run.created_at,
            updatedAt: run.updated_at,
            durationSeconds: getRunDurationSeconds(run),
            url: run.html_url,
        }));
        const now = Date.now();
        const exceptions: SyncException[] = [];
        const durationThresholdSeconds = Number(process.env.SYNC_ALERT_THRESHOLD_SECONDS || 120);
        const latestSuccess = history.find((run) => run.status === 'completed' && run.conclusion === 'success');
        const latestSuccessMs = latestSuccess ? new Date(latestSuccess.updatedAt).getTime() : 0;

        for (const change of changes.filter((change) => change.action === 'REJECTED')) {
            exceptions.push({
                level: 'warning',
                title: `${change.entity} ${change.entityKey} requiere revisión manual`,
                detail: change.reason,
            });
        }

        for (const run of history) {
            const ageMs = now - new Date(run.createdAt).getTime();
            const finishedAfterLatestSuccess = new Date(run.updatedAt).getTime() > latestSuccessMs;
            if (run.status === 'completed' && run.conclusion && run.conclusion !== 'success' && finishedAfterLatestSuccess) {
                exceptions.push({
                    level: 'warning',
                    title: `Actualización ${run.scope} con error`,
                    detail: `Terminó con estado ${run.conclusion}. Se mantiene como válida la actualización exitosa anterior hasta que corra una nueva correctamente.`,
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
            if (run.status === 'completed' && run.conclusion === 'success' && run.durationSeconds !== null && run.durationSeconds > durationThresholdSeconds) {
                exceptions.push({
                    level: 'warning',
                    title: `Actualización ${run.scope} más lenta de lo esperado`,
                    detail: `Duró ${run.durationSeconds}s y superó el umbral operativo de ${durationThresholdSeconds}s. Revisá el detalle de la ejecución.`,
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

        exceptions.push(...await getPackingContentExceptions());
        exceptions.push(...await getLedgerIntegrityExceptions());

        return {
            success: true,
            message: exceptions.length ? 'Hay excepciones para revisar.' : 'OK: no hay excepciones activas en las últimas sincronizaciones.',
            history,
            exceptions,
            changes: changes.map((change) => ({
                ...change,
                createdAt: change.createdAt.toISOString(),
                syncRun: {
                    ...change.syncRun,
                    finishedAt: change.syncRun.finishedAt?.toISOString() || null,
                },
            })),
            lastSuccessAt: latestSuccess?.updatedAt || null,
        };
    } catch (error: any) {
        console.error('Sync control center error:', error);
        return {
            success: false,
            message: `No se pudo cargar el centro de control: ${error.message}`,
            history: [],
            exceptions: [],
            changes: [],
            lastSuccessAt: null,
        };
    }
}

export async function syncExcelInGitHub(days: number = 7) {
    await requireAdminUser();

    try {
        const requestedDays = [0, 7, 30].includes(days) ? days : 7;
        const githubWorkflow = await triggerGitHubSyncWorkflow(requestedDays);
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
