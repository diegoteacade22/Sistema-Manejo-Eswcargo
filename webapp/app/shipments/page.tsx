import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Plus, Plane, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { SearchInput } from '@/components/search-input';
import { SortableColumn } from '@/components/ui/sortable-column';
import { ShipmentStatusDialog } from '@/components/shipment-status-dialog';

type SortOrder = 'asc' | 'desc';

async function getShipments(query: string, page: number = 1, pageSize: number = 20, sortField: string = 'date_shipped', sortOrder: SortOrder = 'desc') {
    const session = await auth();
    if (!session?.user) return { shipments: [], totalCount: 0, totalPages: 0 };

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

    const skip = (page - 1) * pageSize;

    const where: any = {
        ...(clientId ? { clientId } : {})
    };

    if (query) {
        where.OR = [
            { forwarder: { contains: query } },
        ];
        if (!clientId) {
            where.OR.push({ client: { name: { contains: query } } });
        }
        // If query is a number, try exact match on shipment_number
        if (!isNaN(parseInt(query))) {
            where.OR.push({ shipment_number: parseInt(query) });
        }
    }

    const totalCount = await (prisma as any).shipment.count({ where });

    const shipments = await (prisma as any).shipment.findMany({
        where,
        orderBy: { [sortField === 'client' ? 'id' : sortField]: sortOrder },
        include: { client: true },
        take: pageSize,
        skip: skip
    });

    // Automatically sync statuses based on dates/rules
    // Import syncShipmentStatus from actions
    const { syncShipmentStatus } = await import('@/app/actions');
    await Promise.all(shipments.map((s: any) => syncShipmentStatus(s.id)));

    // Re-fetch to get updated statuses (or just map them if updateShipment didn't change too much)
    // Actually, syncShipmentStatus returns the new status, but it's cleaner to re-fetch or just update local objects
    const updatedShipments = await (prisma as any).shipment.findMany({
        where,
        orderBy: { [sortField === 'client' ? 'id' : sortField]: sortOrder },
        include: { client: true },
        take: pageSize,
        skip: skip
    });

    return { shipments: updatedShipments, totalCount, totalPages: Math.ceil(totalCount / pageSize) };
}

export default async function ShipmentsPage(props: { searchParams: Promise<{ q?: string, page?: string, sort?: string, order?: string }> }) {
    const session = await auth();
    const isAdmin = (session?.user as any)?.role === 'ADMIN';

    const searchParams = await props.searchParams;
    const query = searchParams?.q || '';
    const page = parseInt(searchParams?.page || '1');
    const sort = searchParams?.sort || 'date_shipped';
    const order = (searchParams?.order as SortOrder) || 'desc';
    const pageSize = 20;

    const { shipments, totalCount, totalPages } = await getShipments(query, page, pageSize, sort, order);

    return (
        <div className="p-8 space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-fuchsia-500 to-pink-600 bg-clip-text text-transparent">
                        {isAdmin ? 'Gestión de Envíos' : 'Mis Envíos'}
                    </h2>
                    <p className="text-muted-foreground mt-1">Gestión de logística y seguimiento de cargas</p>
                </div>
                {isAdmin && (
                    <Button asChild className="bg-fuchsia-600 hover:bg-fuchsia-700 text-white shadow-lg shadow-fuchsia-200">
                        <Link href="/shipments/new">
                            <Plus className="mr-2 h-4 w-4" /> Nuevo Envío
                        </Link>
                    </Button>
                )}
            </div>

            <Card className="border-t-4 border-t-fuchsia-500 shadow-lg">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <Suspense fallback={<div>Cargando buscador...</div>}>
                            <SearchInput placeholder={isAdmin ? "Buscar por Nro, Forwarder o Cliente..." : "Buscar por Nro Envío..."} />
                        </Suspense>
                        <div className="text-sm text-muted-foreground">
                            {totalCount} envíos encontrados
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <SortableColumn field="shipment_number" label="Nro Envío" currentSort={sort} currentOrder={order} query={query} page={page} baseUrl="/shipments" />
                                <SortableColumn field="date_shipped" label="Fecha Salida" currentSort={sort} currentOrder={order} query={query} page={page} baseUrl="/shipments" />
                                <SortableColumn field="date_arrived" label="Fecha Llegada" currentSort={sort} currentOrder={order} query={query} page={page} baseUrl="/shipments" />
                                {isAdmin && <SortableColumn field="forwarder" label="Forwarder" currentSort={sort} currentOrder={order} query={query} page={page} baseUrl="/shipments" />}
                                <SortableColumn field="client" label="Cliente" currentSort={sort} currentOrder={order} query={query} page={page} baseUrl="/shipments" />
                                <SortableColumn field="weight" label="Peso (Kg)" currentSort={sort} currentOrder={order} query={query} page={page} baseUrl="/shipments" alignRight />
                                <SortableColumn field="status" label="Estado" currentSort={sort} currentOrder={order} query={query} page={page} baseUrl="/shipments" />
                                <TableHead className="w-[50px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {shipments.map((shipment: any) => (
                                <TableRow key={shipment.id} className="hover:bg-muted/50 dark:border-slate-800 h-16 transition-colors">
                                    <TableCell className="font-mono font-black text-slate-400 dark:text-slate-500 text-xs">#{shipment.shipment_number}</TableCell>
                                    <TableCell className="text-slate-900 dark:text-white font-black text-sm">
                                        {shipment.date_shipped ? new Date(shipment.date_shipped).toLocaleDateString() : '-'}
                                    </TableCell>
                                    <TableCell className="text-slate-900 dark:text-slate-200 font-bold text-sm">
                                        {shipment.date_arrived ? new Date(shipment.date_arrived).toLocaleDateString() : '-'}
                                    </TableCell>
                                    <TableCell className="font-black text-slate-950 dark:text-white text-base tracking-tight">{shipment.forwarder || '-'}</TableCell>
                                    <TableCell className="text-slate-800 dark:text-slate-100 font-bold text-sm">{shipment.client?.name || 'Varios/Stock'}</TableCell>
                                    <TableCell className="text-right font-mono font-black text-slate-950 dark:text-white text-base">
                                        {shipment.weight_fw > 0 ? shipment.weight_fw.toFixed(2) : '-'}
                                    </TableCell>
                                    <TableCell>
                                        <ShipmentStatusDialog shipment={shipment} />
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" className="h-9 w-9 hover:bg-fuchsia-100 dark:hover:bg-fuchsia-900/40" asChild>
                                            <Link href={`/shipments/${shipment.id}`}>
                                                <Plane className="h-5 w-5 text-slate-400 hover:text-fuchsia-600 dark:text-slate-500" />
                                            </Link>
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {shipments.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                                        No se encontraron envíos con "{query}".
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                    Página {page} de {totalPages} ({totalCount} items)
                </div>
                <div className="flex items-center space-x-2">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        asChild
                    >
                        <Link href={`/shipments?q=${query}&page=${page - 1}&sort=${sort}&order=${order}`} scroll={false}>
                            <ChevronLeft className="h-4 w-4 mr-2" /> Anterior
                        </Link>
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages}
                        asChild
                    >
                        <Link href={`/shipments?q=${query}&page=${page + 1}&sort=${sort}&order=${order}`} scroll={false}>
                            Siguiente <ChevronRight className="h-4 w-4 ml-2" />
                        </Link>
                    </Button>
                </div>
            </div>
        </div >
    );
}
