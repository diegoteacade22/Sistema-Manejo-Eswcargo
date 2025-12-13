
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Plus, Eye, Package } from 'lucide-react';
import { SearchInput } from '@/components/search-input';
import { Suspense } from 'react';

async function getOrders(query: string) {
    const whereClause: any = {};

    if (query) {
        // Try to parse as ID
        const asNumber = parseInt(query);
        if (!isNaN(asNumber)) {
            whereClause.order_number = asNumber;
        } else {
            // Search by client name
            whereClause.client = {
                name: { contains: query }
            };
        }
    }

    const orders = await prisma.order.findMany({
        where: whereClause,
        orderBy: { date: 'desc' },
        take: 50,
        include: {
            client: true
        }
    });
    return orders;
}

export default async function OrdersPage(props: { searchParams: Promise<{ q?: string }> }) {
    const searchParams = await props.searchParams;
    const query = searchParams?.q || '';
    const orders = await getOrders(query);

    return (
        <div className="p-8 space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-pink-600 to-rose-600 bg-clip-text text-transparent">
                        Pedidos
                    </h2>
                    <p className="text-muted-foreground mt-1">Seguimiento de envíos e importaciones</p>
                </div>
                <Button asChild className="bg-pink-600 hover:bg-pink-700 text-white shadow-lg shadow-pink-200">
                    <Link href="/orders/new"><Plus className="mr-2 h-4 w-4" /> Nueva Venta</Link>
                </Button>
            </div>

            <Card className="border-t-4 border-t-pink-500 shadow-lg">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <Suspense fallback={<div>Cargando buscador...</div>}>
                            <SearchInput placeholder="Buscar por cliente o Nro pedido..." />
                        </Suspense>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead>Pedido</TableHead>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Cliente</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead className="text-right">Total</TableHead>
                                <TableHead></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {orders.map((order: any) => (
                                <TableRow key={order.id} className="hover:bg-muted/50 dark:border-slate-800">
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <div className="p-2 rounded bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400">
                                                <Package className="h-4 w-4" />
                                            </div>
                                            <span className="font-semibold text-slate-700 dark:text-slate-200">#{order.order_number}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>{new Date(order.date).toLocaleDateString()}</TableCell>
                                    <TableCell className="font-medium text-muted-foreground">{order.client.name}</TableCell>
                                    <TableCell>
                                        <Badge
                                            variant="outline"
                                            className={
                                                order.status === 'ENTREGADO'
                                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800'
                                                    : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800'
                                            }
                                        >
                                            {order.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right font-bold text-slate-700 dark:text-slate-200">
                                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(order.total_amount)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-pink-600">
                                            <Link href={`/orders/${order.id}`}><Eye className="h-4 w-4" /></Link>
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {orders.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                        No se encontraron pedidos.
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
