import Link from 'next/link';
import { ArrowLeft, BadgeCheck, CircleAlert, FileCheck2, Landmark, TriangleAlert } from 'lucide-react';
import { requireAdminUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import clientBalanceControls from '@/scripts/client-balance-controls.json';

const cashFlowClientIds = new Set(clientBalanceControls.cashFlowAccounts.map((account) => account.oldId));
const lockedZeroClientIds = new Set(clientBalanceControls.lockedBalances.map((account) => account.oldId));

const statusMeta = {
    operational_without_cashflow_source: { label: 'Sin fuente financiera', tone: 'text-red-700 bg-red-50 border-red-200 dark:text-red-300 dark:bg-red-950/30 dark:border-red-900', rank: 0 },
    cashflow_adjustment_requires_detail: { label: 'Ajuste Cash Flow', tone: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/30 dark:border-amber-900', rank: 1 },
    locked_zero_adjustment_requires_evidence: { label: 'Cero con ajuste', tone: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/30 dark:border-amber-900', rank: 2 },
    baseline_mixed_requires_evidence: { label: 'Histórico mezclado', tone: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/30 dark:border-amber-900', rank: 3 },
    baseline_only_requires_evidence: { label: 'Saldo histórico', tone: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/30 dark:border-amber-900', rank: 4 },
    shipment_source_reconciled: { label: 'Envío conciliado', tone: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-900', rank: 5 },
    cashflow_source: { label: 'Fuente Cash Flow', tone: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-900', rank: 6 },
    confirmed_zero: { label: 'Cero confirmado', tone: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-900', rank: 7 },
} as const;

type AccountStatus = keyof typeof statusMeta;

function money(value: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function statusFor(transactions: { amount: number; reference: string | null }[], oldId: number | null, clientId: number, shipmentReconciledClientIds: Set<number>): AccountStatus {
    const hasBaseline = transactions.some((transaction) => String(transaction.reference || '').startsWith('CC-ZERO-BASELINE-2026:'));
    const onlyBaseline = hasBaseline && transactions.every((transaction) => String(transaction.reference || '').startsWith('CC-ZERO-BASELINE-2026:'));
    const hasReconciliationAdjustment = transactions.some((transaction) => String(transaction.reference || '').startsWith('CASHFLOW-RECONCILIATION-2026:'));
    const balance = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);

    if (hasReconciliationAdjustment && oldId !== null && cashFlowClientIds.has(oldId)) return 'cashflow_adjustment_requires_detail';
    if (hasReconciliationAdjustment && oldId !== null && lockedZeroClientIds.has(oldId)) return 'locked_zero_adjustment_requires_evidence';
    if (oldId !== null && cashFlowClientIds.has(oldId)) return 'cashflow_source';
    if (shipmentReconciledClientIds.has(clientId) && Math.abs(balance) <= 0.01) return 'shipment_source_reconciled';
    if (oldId !== null && lockedZeroClientIds.has(oldId)) return 'confirmed_zero';
    if (onlyBaseline) return 'baseline_only_requires_evidence';
    if (hasBaseline) return 'baseline_mixed_requires_evidence';
    return 'operational_without_cashflow_source';
}

export default async function AccountsReviewPage() {
    await requireAdminUser();

    const [transactions, reconciliations] = await Promise.all([
        prisma.transaction.findMany({
            where: { clientId: { not: null } },
            select: {
                clientId: true,
                amount: true,
                reference: true,
                client: {
                    select: {
                        id: true,
                        old_id: true,
                        name: true,
                        accountEvidence: { select: { id: true } },
                    },
                },
            },
            orderBy: [{ clientId: 'asc' }, { date: 'asc' }, { id: 'asc' }],
        }),
        prisma.accountEvidence.findMany({
            where: { category: 'SHIPMENT_CHARGE_RECONCILIATION' },
            select: { clientId: true },
        }),
    ]);

    const shipmentReconciledClientIds = new Set(reconciliations.map((entry) => entry.clientId));
    const grouped = new Map<number, typeof transactions>();
    for (const transaction of transactions) {
        if (transaction.clientId === null) continue;
        grouped.set(transaction.clientId, [...(grouped.get(transaction.clientId) || []), transaction]);
    }

    const accounts = [...grouped.values()].map((group) => {
        const client = group[0]?.client;
        if (!client) return null;
        const status = statusFor(group, client.old_id, client.id, shipmentReconciledClientIds);
        return {
            client,
            status,
            balance: group.reduce((sum, transaction) => sum + transaction.amount, 0),
            movements: group.length,
            evidenceCount: client.accountEvidence.length,
        };
    }).filter((account): account is NonNullable<typeof account> => account !== null)
        .sort((left, right) => statusMeta[left.status].rank - statusMeta[right.status].rank || Math.abs(right.balance) - Math.abs(left.balance));

    const reviewCount = accounts.filter((account) => statusMeta[account.status].rank < 5).length;
    const reconciledCount = accounts.length - reviewCount;
    const evidenceCount = accounts.reduce((sum, account) => sum + account.evidenceCount, 0);

    return (
        <div className="p-8 space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/maintenance"><Button variant="ghost" size="icon" aria-label="Volver a Mantenimiento"><ArrowLeft className="h-5 w-5" /></Button></Link>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Revisión de cuentas</h1>
                        <p className="mt-1 text-muted-foreground">Saldos y respaldo disponible en producción.</p>
                    </div>
                </div>
                <Link href="/maintenance/evidence"><Button><FileCheck2 className="mr-2 h-4 w-4" /> Registrar respaldo</Button></Link>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><CircleAlert className="h-4 w-4 text-amber-500" /> Requieren revisión</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold">{reviewCount}</p></CardContent></Card>
                <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><BadgeCheck className="h-4 w-4 text-emerald-500" /> Conciliadas o bloqueadas</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold">{reconciledCount}</p></CardContent></Card>
                <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Landmark className="h-4 w-4 text-blue-500" /> Respaldos registrados</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold">{evidenceCount}</p></CardContent></Card>
            </div>

            <Card>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px] text-left text-sm">
                            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                                <tr><th className="px-4 py-3">Cuenta</th><th className="px-4 py-3 text-right">Saldo</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3 text-right">Movimientos</th><th className="px-4 py-3 text-right">Respaldos</th><th className="px-4 py-3"></th></tr>
                            </thead>
                            <tbody>
                                {accounts.map((account) => {
                                    const meta = statusMeta[account.status];
                                    return <tr key={account.client.id} className="border-b last:border-0 hover:bg-slate-50/70 dark:hover:bg-slate-900/50">
                                        <td className="px-4 py-3"><Link className="font-medium hover:underline" href={`/clients/${account.client.id}`}>{account.client.name}</Link><p className="text-xs text-muted-foreground">Legajo {account.client.old_id ?? 'sin ID'}</p></td>
                                        <td className={`px-4 py-3 text-right font-mono font-semibold ${Math.abs(account.balance) <= 0.01 ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>{money(account.balance)}</td>
                                        <td className="px-4 py-3"><span className={`inline-flex rounded border px-2 py-1 text-xs font-medium ${meta.tone}`}>{meta.label}</span></td>
                                        <td className="px-4 py-3 text-right">{account.movements}</td>
                                        <td className="px-4 py-3 text-right">{account.evidenceCount}</td>
                                        <td className="px-4 py-3 text-right"><Link href="/maintenance/evidence" aria-label={`Registrar evidencia para ${account.client.name}`}><Button variant="ghost" size="icon"><TriangleAlert className="h-4 w-4" /></Button></Link></td>
                                    </tr>;
                                })}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
