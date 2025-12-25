import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Package, Plus, Eye } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { SearchInput } from '@/components/search-input';
import { SortableColumn } from '@/components/ui/sortable-column';
import { getStatusColorClass } from '@/lib/utils';

type SortOrder = 'asc' | 'desc';

async function getOrders(query: string, sortField: string = 'date', sortOrder: SortOrder = 'desc') {
    const session = await auth();
    if (!session?.user) return [];

    const userRole = (session.user as any).role;
    const userId = (session.user as any).id;

    let clientId: number | null = null;
    if (userRole === 'CLIENT') {
        const client = await (prisma.client as any).findFirst({
            where: { userId: userId },
            select: { id: true }
        });
        clientId = client?.id || null;
    }

    const whereClause: any = {
        ...(clientId ? { clientId } : {})
    };

    if (query) {
        const asNumber = parseInt(query);
        if (!isNaN(asNumber)) {
            whereClause.order_number = asNumber;
        } else if (!clientId) {
            whereClause.client = {
                name: { contains: query }
            };
        }
    }

    const orders = await prisma.order.findMany({
        where: whereClause,
        orderBy: { [sortField === 'number' ? 'order_number' : sortField]: sortOrder },
        take: 50,
        include: {
            client: true
        }
    });
    return orders;
}

export default async function OrdersPage(props: { searchParams: Promise<{ q?: string, sort?: string, order?: string }> }) {
    const session = await auth();
    const isAdmin = (session?.user as any)?.role === 'ADMIN';

    const searchParams = await props.searchParams;
    const query = searchParams?.q || '';
    const sortField = searchParams?.sort || 'date';
    const sortOrder = (searchParams?.order as SortOrder) || 'desc';

    const orders = await getOrders(query, sortField, sortOrder);

    return (
        <div className="p-8 space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-pink-600 to-rose-600 bg-clip-text text-transparent">
                        {isAdmin ? 'Pedidos Globales' : 'Mis Pedidos'}
                    </h2>
                    <p className="text-muted-foreground mt-1">Seguimiento de envíos e importaciones</p>
                </div>
                {isAdmin && (
                    <Button asChild className="bg-pink-600 hover:bg-pink-700 text-white shadow-lg shadow-pink-200">
                        <Link href="/orders/new"><Plus className="mr-2 h-4 w-4" /> Nueva Venta</Link>
                    </Button>
                )}
            </div>

            <Card className="border-t-4 border-t-pink-500 shadow-lg">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <Suspense fallback={<div>Cargando buscador...</div>}>
                            <SearchInput placeholder={isAdmin ? "Buscar por cliente o Nro..." : "Buscar por Nro pedido..."} />
                        </Suspense>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <SortableColumn field="number" label="Pedido" currentSort={sortField} currentOrder={sortOrder} query={query} baseUrl="/orders" />
                                <SortableColumn field="date" label="Fecha" currentSort={sortField} currentOrder={sortOrder} query={query} baseUrl="/orders" />
                                {isAdmin && <SortableColumn field="client" label="Cliente" currentSort={sortField} currentOrder={sortOrder} query={query} baseUrl="/orders" />}
                                <SortableColumn field="status" label="Estado" currentSort={sortField} currentOrder={sortOrder} query={query} baseUrl="/orders" />
                                <SortableColumn field="amount" label="Total" currentSort={sortField} currentOrder={sortOrder} query={query} baseUrl="/orders" alignRight />
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
                                            <span className="font-bold text-slate-800 dark:text-slate-100">#{order.order_number}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-slate-600 dark:text-slate-300">{new Date(order.date).toLocaleDateString()}</TableCell>
                                    <TableCell className="font-semibold text-slate-900 dark:text-slate-100">{order.client.name}</TableCell>
                                    <TableCell>
                                        <Badge
                                            variant="outline"
                                            className={`${getStatusColorClass(order.status)} font-medium`}
                                        >
                                            {order.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right font-bold text-slate-900 dark:text-slate-50 font-mono">
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
