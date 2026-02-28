
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { CreditCard, History, Plus } from 'lucide-react';
import { Suspense } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PaymentDialog } from '@/components/payment-dialog';

async function getPayments(sortField: string = 'date', sortOrder: 'asc' | 'desc' = 'desc') {
    const session = await auth();
    if (!session?.user) return [];

    const userRole = (session.user as any).role;
    const userId = (session.user as any).id;

    if (userRole !== 'CLIENT') return [];

    const client = await (prisma.client as any).findFirst({
        where: { userId: userId },
        select: { id: true }
    });

    if (!client) return [];

    const payments = await prisma.transaction.findMany({
        where: {
            clientId: client.id,
            type: 'PAGO'
        },
        orderBy: sortField === 'amount'
            ? { amount: sortOrder }
            : { date: sortOrder }
    });

    return payments;
}

export default async function PaymentsPage(props: { searchParams: Promise<{ sort?: string, order?: 'asc' | 'desc' }> }) {
    const searchParams = await props.searchParams;
    const session = await auth();
    if (!session?.user) return null;

    const userRole = (session.user as any).role;
    const userId = (session.user as any).id;

    // Get current user's client info if is CLIENT, or admin context
    let clientId: number | null = null;
    let clientName: string = '';

    if (userRole === 'CLIENT') {
        const client = await prisma.client.findFirst({
            where: { userId },
            select: { id: true, name: true }
        });
        if (client) {
            clientId = client.id;
            clientName = client.name;
        }
    }

    const sortField = searchParams.sort || 'date';
    const sortOrder = searchParams.order || 'desc';

    const payments = await getPayments(sortField, sortOrder as any);

    return (
        <div className="p-8 space-y-8 animate-in fade-in duration-500">
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
                        Finanzas & Pagos
                    </h2>
                    <p className="text-muted-foreground mt-1">Historial de pagos y operaciones financieras</p>
                </div>
                {clientId && clientName && (
                    <PaymentDialog
                        clientId={clientId}
                        clientName={clientName}
                        buttonLabel="Registrar Pago"
                        buttonVariant="default"
                        buttonSize="lg"
                        buttonClassName="bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg"
                    />
                )}
            </div>

            <Card className="border-t-4 border-t-emerald-500 shadow-xl overflow-hidden dark:bg-slate-950/50">
                <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                        <History className="h-5 w-5 text-emerald-500" />
                        <span className="font-bold text-slate-700 dark:text-slate-300Caps">Registro Histórico</span>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent border-b border-slate-100 dark:border-slate-800">
                                <TableHead className="pl-6 py-4 font-bold text-slate-900 dark:text-slate-100">
                                    <Link href={`?sort=date&order=${sortField === 'date' && sortOrder === 'asc' ? 'desc' : 'asc'}`} className="flex items-center hover:text-emerald-600 transition-colors">
                                        Fecha {sortField === 'date' && (sortOrder === 'asc' ? '↑' : '↓')}
                                    </Link>
                                </TableHead>
                                <TableHead className="font-bold text-slate-900 dark:text-slate-100">Descripción / Referencia</TableHead>
                                <TableHead className="font-bold text-slate-900 dark:text-slate-100">Método</TableHead>
                                <TableHead className="text-right pr-6 font-bold text-slate-900 dark:text-slate-100">
                                    <Link href={`?sort=amount&order=${sortField === 'amount' && sortOrder === 'asc' ? 'desc' : 'asc'}`} className="flex items-center justify-end hover:text-emerald-600 transition-colors">
                                        Monto {sortField === 'amount' && (sortOrder === 'asc' ? '↑' : '↓')}
                                    </Link>
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {payments.map((payment) => (
                                <TableRow key={payment.id} className="hover:bg-emerald-50/30 dark:hover:bg-emerald-900/10 transition-colors border-b border-slate-100 dark:border-slate-800 h-16">
                                    <TableCell className="pl-6 font-medium text-slate-600 dark:text-slate-400">
                                        {new Date(payment.date).toLocaleDateString()}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span className="font-bold text-slate-900 dark:text-slate-100">{payment.description}</span>
                                            {payment.reference && (
                                                <span className="text-[10px] text-slate-400 font-mono uppercase tracking-tighter">REF: {payment.reference}</span>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {payment.paymentMethod ? (
                                            <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800">
                                                {payment.paymentMethod}
                                            </Badge>
                                        ) : (
                                            <span className="text-slate-400">-</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right pr-6">
                                        <div className="flex items-center justify-end gap-2">
                                            <span className="text-lg font-black text-emerald-600 dark:text-emerald-400 font-mono">
                                                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(payment.amount))}
                                            </span>
                                            <div className="p-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                                                <CreditCard className="h-3 w-3 text-emerald-600" />
                                            </div>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {payments.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center py-20">
                                        <div className="flex flex-col items-center justify-center space-y-3 opacity-40">
                                            <CreditCard className="h-10 w-10 text-slate-400" />
                                            <p className="text-slate-500 font-medium">Aún no se han registrado pagos en tu cuenta.</p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
