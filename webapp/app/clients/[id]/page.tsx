
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Printer, Mail } from 'lucide-react';
import Link from 'next/link';
import { PaymentDialog } from '@/components/payment-dialog';

interface Props {
    params: Promise<{ id: string }>;
}

async function getClientDetails(id: string) {
    const clientId = parseInt(id);
    if (isNaN(clientId)) return null;

    const client = await prisma.client.findUnique({
        where: { id: clientId },
        include: {
            transactions: {
                orderBy: { date: 'desc' },
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
    const client = await getClientDetails(params.id);

    if (!client) {
        return <div>Cliente no encontrado</div>;
    }

    // Calculate Balance
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const balance = client.transactions.reduce((acc: any, t: any) => acc + t.amount, 0);

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
                <Card className={balance > 0 ? "border-red-500 bg-red-50 dark:bg-red-900/10" : "border-green-500 bg-green-50 dark:bg-green-900/10"}>
                    <CardHeader>
                        <CardTitle>Saldo Actual (Cta Cte)</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className={`text-4xl font-bold ${balance > 0 ? 'text-red-700 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(balance)}
                        </div>
                        <p className="text-sm text-muted-foreground mt-2">
                            {balance > 0 ? 'El cliente DEBE este monto' : 'El cliente tiene saldo A FAVOR'}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                            <Button size="sm" variant="secondary"><Printer className="mr-2 h-4 w-4" /> Estado Cuenta</Button>
                            <Button size="sm" variant="secondary"><Mail className="mr-2 h-4 w-4" /> Enviar Email</Button>
                            <PaymentDialog clientId={client.id} clientName={client.name} />
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Transactions History */}
            <div className="grid gap-4 md:grid-cols-1">
                <Card>
                    <CardHeader>
                        <CardTitle>Movimientos de Cuenta Corriente</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Descripción</TableHead>
                                    <TableHead>Tipo</TableHead>
                                    <TableHead className="text-right">Monto</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                {client.transactions.map((tx: any) => (
                                    <TableRow key={tx.id}>
                                        <TableCell>{new Date(tx.date).toLocaleDateString()}</TableCell>
                                        <TableCell>{tx.description}</TableCell>
                                        <TableCell>
                                            <Badge variant={tx.type === 'CARGO' ? 'destructive' : 'default'}>
                                                {tx.type}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className={`text-right font-medium ${tx.amount > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                                            {tx.amount > 0 ? '+' : ''}
                                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(tx.amount)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
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
