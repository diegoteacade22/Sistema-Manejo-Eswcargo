
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Printer, Mail } from 'lucide-react';
import Link from 'next/link';
import { PaymentDialog } from '@/components/payment-dialog';
import { auth } from '@/lib/auth';
import { notFound } from 'next/navigation';

interface Props {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ sort?: string, order?: 'asc' | 'desc' }>;
}

async function getClientDetails(id: string) {
    const clientId = parseInt(id);
    if (isNaN(clientId)) return null;

    const client = await prisma.client.findUnique({
        where: { id: clientId },
        include: {
            transactions: {
                orderBy: { date: 'asc' }, // ALWAYS fetch Ascending for perfect chronological ledger calculation
            },
            orders: {
                orderBy: { date: 'desc' },
                take: 10,
            }
        }
    });

    return client;
}

export default async function ClientPage(props: Props) {
    const params = await props.params;
    const searchParams = await props.searchParams;
    const session = await auth();

    if (!session?.user) {
        return notFound();
    }

    const userRole = (session.user as any).role;
    const userId = (session.user as any).id;

    if (userRole !== 'ADMIN') {
        const clientForUser = await prisma.client.findFirst({
            where: { userId },
            select: { id: true }
        });

        if (!clientForUser || clientForUser.id !== parseInt(params.id)) {
            return notFound();
        }
    }

    const client = await getClientDetails(params.id);

    if (!client) {
        return <div>Cliente no encontrado</div>;
    }

    const sortField = searchParams.sort || 'date';
    const sortOrder = searchParams.order || 'asc';

    // Calculate Balance and Running Balances (Always Chronologically first)
    let runningBalance = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let transactionsWithBalance = client.transactions.map((tx: any) => {
        runningBalance += tx.amount;
        return { ...tx, balance: runningBalance };
    });

    // Apply sorting to the pre-calculated list
    transactionsWithBalance.sort((a: any, b: any) => {
        let comparison = 0;
        if (sortField === 'date') {
            comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
        } else if (sortField === 'amount') {
            comparison = Math.abs(a.amount) - Math.abs(b.amount);
        }

        return sortOrder === 'asc' ? comparison : -comparison;
    });

    const finalBalance = runningBalance;

    return (
        <div className="p-8 space-y-8">
            <div className="flex items-center space-x-4">
                <Button variant="outline" size="icon" asChild>
                    <Link href="/clients"><ArrowLeft className="h-4 w-4" /></Link>
                </Button>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">{client.name}</h1>
                <Badge variant="outline" className="text-lg">{client.type || 'Cliente'}</Badge>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                {/* Contact Info */}
                <Card className="col-span-2">
                    <CardHeader>
                        <CardTitle>Información de Contacto</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <p className="text-sm font-medium text-muted-foreground">Email</p>
                                <p>{client.email || '-'}</p>
                            </div>
                            <div>
                                <p className="text-sm font-medium text-muted-foreground">Teléfono</p>
                                <p>{client.phone || '-'}</p>
                            </div>
                            <div>
                                <p className="text-sm font-medium text-muted-foreground">Dirección</p>
                                <p>{client.address || '-'}</p>
                            </div>
                            <div>
                                <p className="text-sm font-medium text-muted-foreground">ID (Old)</p>
                                <p>{client.old_id}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Balance Card */}
                <Card className={finalBalance < 0 ? "border-red-500 bg-red-50 dark:bg-red-900/10" : "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10"}>
                    <CardHeader>
                        <CardTitle>Saldo Actual (Cta Cte)</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className={`text-4xl font-bold ${finalBalance < 0 ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(finalBalance)}
                        </div>
                        <p className={`text-sm font-bold mt-2 ${finalBalance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                            {finalBalance < 0 ? '🔴 EL CLIENTE DEBE' : '🟢 SALDO A FAVOR (CRÉDITO)'}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                            <Button size="sm" variant="secondary"><Printer className="mr-2 h-4 w-4" /> Estado Cuenta</Button>
                            <PaymentDialog clientId={client.id} clientName={client.name} />
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Financial Breakdown Summary */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card className="bg-slate-50 dark:bg-slate-900/50">
                    <CardContent className="pt-6">
                        <p className="text-xs text-muted-foreground uppercase font-semibold">Total Compras</p>
                        <p className="text-xl font-bold text-red-600">
                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                                Math.abs(client.transactions.filter((t: any) => t.type === 'CARGO' && t.reference?.startsWith('Order')).reduce((acc: number, t: any) => acc + t.amount, 0))
                            )}
                        </p>
                    </CardContent>
                </Card>
                <Card className="bg-slate-50 dark:bg-slate-900/50">
                    <CardContent className="pt-6">
                        <p className="text-xs text-muted-foreground uppercase font-semibold">Total Pagos</p>
                        <p className="text-xl font-bold text-emerald-600">
                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                                client.transactions.filter((t: any) => t.type === 'PAGO').reduce((acc: number, t: any) => acc + t.amount, 0)
                            )}
                        </p>
                    </CardContent>
                </Card>
                <Card className="bg-slate-50 dark:bg-slate-900/50">
                    <CardContent className="pt-6">
                        <p className="text-xs text-muted-foreground uppercase font-semibold">Total Fletes</p>
                        <p className="text-xl font-bold text-amber-600">
                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                                Math.abs(client.transactions.filter((t: any) => t.type === 'CARGO' && t.reference?.startsWith('Envío')).reduce((acc: number, t: any) => acc + t.amount, 0))
                            )}
                        </p>
                    </CardContent>
                </Card>
                <Card className="bg-slate-50 dark:bg-slate-900/50">
                    <CardContent className="pt-6">
                        <p className="text-xs text-muted-foreground uppercase font-semibold">Saldo Final</p>
                        <p className={`text-xl font-bold ${finalBalance < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(finalBalance)}
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Transactions History */}
            <div className="grid gap-4 md:grid-cols-1">
                <Card className="shadow-md">
                    <CardHeader className="bg-slate-100 dark:bg-slate-800/50">
                        <CardTitle className="flex justify-between items-center">
                            <span>Cuenta Corriente</span>
                            <span className="text-sm font-normal text-muted-foreground">Movimientos Históricos</span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader className="bg-slate-200 dark:bg-slate-800">
                                    <TableRow>
                                        <TableHead className="w-[120px] font-bold text-slate-700 dark:text-slate-200">
                                            <Link href={`?sort=date&order=${sortField === 'date' && sortOrder === 'asc' ? 'desc' : 'asc'}`} className="flex items-center hover:text-indigo-600 transition-colors">
                                                FECHA {sortField === 'date' && (sortOrder === 'asc' ? '↑' : '↓')}
                                            </Link>
                                        </TableHead>
                                        <TableHead className="font-bold text-slate-700 dark:text-slate-200">CONCEPTO</TableHead>
                                        <TableHead className="font-bold text-slate-700 dark:text-slate-200">REF</TableHead>
                                        <TableHead className="text-right font-bold text-slate-700 dark:text-slate-200">
                                            <Link href={`?sort=amount&order=${sortField === 'amount' && sortOrder === 'asc' ? 'desc' : 'asc'}`} className="flex items-center justify-end hover:text-indigo-600 transition-colors">
                                                MONTO {sortField === 'amount' && (sortOrder === 'asc' ? '↑' : '↓')}
                                            </Link>
                                        </TableHead>
                                        <TableHead className="text-right font-bold text-slate-700 dark:text-slate-200">SALDO</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {transactionsWithBalance.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center h-24 text-muted-foreground">
                                                No hay movimientos registrados.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        transactionsWithBalance.map((tx: any) => (
                                            <TableRow key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                                <TableCell className="font-mono text-sm">
                                                    {new Date(tx.date).toLocaleDateString()}
                                                </TableCell>
                                                <TableCell className="font-medium text-slate-700 dark:text-slate-200">
                                                    {tx.description}
                                                </TableCell>
                                                <TableCell className="text-left text-xs text-muted-foreground">
                                                    {tx.reference || '-'}
                                                </TableCell>
                                                <TableCell className={`text-right font-bold font-mono ${tx.amount < 0
                                                    ? 'text-red-600 dark:text-red-400' // Charges (Inv/Carga) - Negative
                                                    : 'text-emerald-600 dark:text-emerald-400'   // Payments (Cobros) - Positive
                                                    }`}>
                                                    {tx.amount > 0 ? '+' : ''}{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(tx.amount)}
                                                </TableCell>
                                                <TableCell className={`text-right font-bold font-mono ${tx.balance < 0
                                                    ? 'text-red-600 dark:text-red-400'
                                                    : 'text-emerald-600 dark:text-emerald-400'
                                                    }`}>
                                                    {tx.balance > 0 ? '+' : ''}{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(tx.balance)}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Recent Orders */}
            <div className="grid gap-4 md:grid-cols-1">
                <Card>
                    <CardHeader>
                        <CardTitle>Últimos Pedidos</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Nro Pedido</TableHead>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                {client.orders.map((order: any) => (
                                    <TableRow key={order.id}>
                                        <TableCell>#{order.order_number}</TableCell>
                                        <TableCell>{new Date(order.date).toLocaleDateString()}</TableCell>
                                        <TableCell>{order.status}</TableCell>
                                        <TableCell className="text-right">
                                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(order.total_amount)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>

        </div>
    );
}
