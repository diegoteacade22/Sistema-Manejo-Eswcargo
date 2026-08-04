import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Plus, Plane, ChevronLeft, ChevronRight, House, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { SearchInput } from '@/components/search-input';
import { SortableColumn } from '@/components/ui/sortable-column';
import { ShipmentStatusDialog } from '@/components/shipment-status-dialog';
import { ShipmentChargeDialog } from '@/components/shipment-charge-dialog';
import { ShipmentsBulkStatusControls } from '@/components/shipments-bulk-status-controls';
import { getPackingSegments, projectShipmentForPacking } from '@/lib/packing-segments';
import { getAdminShipmentSearchWhere, getClientShipmentAccess, getClientShipmentVisibilityWhere } from '@/lib/shipment-visibility';

type SortOrder = 'asc' | 'desc';

async function getShipments(query: string, page: number = 1, pageSize: number = 20, sortField: string = 'shipment_number', sortOrder: SortOrder = 'desc') {
    const session = await auth();
    if (!session?.user) return { shipments: [], totalCount: 0, totalPages: 0 };

    const userRole = (session.user as any).role;
    const userId = (session.user as any).id;

    const skip = (page - 1) * pageSize;
    const filters: any[] = [];
    let viewerClientId: number | null = null;

    if (userRole === 'CLIENT') {
        const client = await (prisma.client as any).findFirst({
            where: { userId: userId },
            select: { id: true }
        });

        if (!client) return { shipments: [], totalCount: 0, totalPages: 0 }; // Security: show nothing if client not linked
        viewerClientId = client.id;
        filters.push(getClientShipmentVisibilityWhere(client.id));
    }

    if (query) {
        if (userRole === 'ADMIN') {
            filters.push(getAdminShipmentSearchWhere(query));
        } else if (Number.isInteger(Number.parseInt(query, 10))) {
            filters.push({ shipment_number: Number.parseInt(query, 10) });
        } else {
            filters.push({ forwarder: { contains: query, mode: 'insensitive' } });
        }
    }
    const where: any = filters.length > 0 ? { AND: filters } : {};

    const shipmentInclude = {
        client: true,
        items: { include: { order: { include: { client: true } } } },
        orders: { include: { client: true, items: true } },
    };

    const projectForViewer = (shipment: any) => {
        const segments = getPackingSegments(shipment);
        if (!viewerClientId) {
            if (segments.length > 1) {
                return {
                    ...shipment,
                    packingSegment: {
                        isSharedShipment: true,
                        itemCount: segments.reduce((total, segment) => total + segment.itemCount, 0),
                        clientNames: segments.map((segment) => segment.client.name),
                    },
                };
            }
            return segments.length === 1
                ? projectShipmentForPacking(shipment, segments[0], 1)
                : shipment;
        }
        const access = getClientShipmentAccess(shipment, viewerClientId);
        if (!access) return null;
        return access.segment
            ? projectShipmentForPacking(shipment, access.segment, access.segmentCount)
            : shipment;
    };

    const totalCount = await (prisma as any).shipment.count({ where });

    const shipments = await (prisma as any).shipment.findMany({
        where,
        orderBy: { [sortField === 'client' ? 'id' : sortField]: sortOrder },
        include: shipmentInclude,
        take: pageSize,
        skip: skip
    });

    return {
        shipments: shipments.map(projectForViewer).filter(Boolean),
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
    };
}

export default async function ShipmentsPage(props: { searchParams: Promise<{ q?: string, page?: string, sort?: string, order?: string }> }) {
    const session = await auth();
    const isAdmin = (session?.user as any)?.role === 'ADMIN';

    const searchParams = await props.searchParams;
    const query = searchParams?.q || '';
    const page = parseInt(searchParams?.page || '1');
    const sort = searchParams?.sort || 'shipment_number';
    const order = (searchParams?.order as SortOrder) || 'desc';
    const pageSize = 20;

    const { shipments, totalCount, totalPages } = await getShipments(query, page, pageSize, sort, order);

    return (
        <div className="p-8 space-y-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-fuchsia-500 to-pink-600 bg-clip-text text-transparent">
                        {isAdmin ? 'Gestión de Envíos' : 'Mis Envíos'}
                    </h2>
                    <p className="text-muted-foreground mt-1">Gestión de logística y seguimiento de cargas</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button asChild variant="outline">
                        <Link href="/">
                            <House className="mr-2 h-4 w-4" /> Inicio
                        </Link>
                    </Button>
                    {isAdmin && (
                        <Button asChild className="bg-fuchsia-600 hover:bg-fuchsia-700 text-white shadow-lg shadow-fuchsia-200">
                            <Link href="/shipments/new">
                                <Plus className="mr-2 h-4 w-4" /> Nuevo Envío
                            </Link>
                        </Button>
                    )}
                </div>
            </div>

            {isAdmin && <ShipmentsBulkStatusControls />}

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
                                    <TableCell className="font-bold text-sm">
                                        <Link
                                            href={`/shipments/${shipment.id}`}
                                            className="inline-flex items-center gap-1 text-violet-600 underline decoration-violet-500/40 underline-offset-4 transition-colors hover:text-fuchsia-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500 dark:text-violet-400"
                                            aria-label={`Ver envío ${shipment.shipment_number}`}
                                        >
                                            #{shipment.shipment_number}
                                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                        </Link>
                                    </TableCell>
                                    <TableCell className="text-slate-900 dark:text-white font-black text-sm">
                                        {shipment.date_shipped ? new Date(shipment.date_shipped).toLocaleDateString() : '-'}
                                    </TableCell>
                                    <TableCell className="text-slate-900 dark:text-slate-200 font-bold text-sm">
                                        {shipment.date_arrived ? new Date(shipment.date_arrived).toLocaleDateString() : '-'}
                                    </TableCell>
                                    <TableCell className="font-black text-slate-950 dark:text-white text-base tracking-tight">
                                        {shipment.forwarder === 'UNLIMITED' ? '' : (shipment.forwarder || '-')}
                                    </TableCell>
                                    <TableCell className="max-w-[28rem] whitespace-normal break-words text-slate-800 dark:text-slate-100 font-bold text-sm">
                                        {shipment.packingSegment?.isSharedShipment
                                            ? shipment.packingSegment.clientNames.join(' / ')
                                            : (shipment.client?.name || 'Varios/Stock')}
                                    </TableCell>
                                    <TableCell className="text-right font-mono font-black text-slate-950 dark:text-white text-base">
                                        {shipment.weight_fw > 0 ? shipment.weight_fw.toFixed(2) : '-'}
                                    </TableCell>
                                    <TableCell>
                                        {isAdmin ? (
                                            <ShipmentStatusDialog shipment={shipment} />
                                        ) : (
                                            <span className="inline-flex items-center rounded-full bg-fuchsia-600 px-3 py-1 text-xs font-black uppercase tracking-wide text-white">
                                                {shipment.status || 'SIN ESTADO'}
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right flex items-center justify-end gap-1">
                                        {isAdmin && !shipment.packingSegment?.isSharedShipment && (
                                            <ShipmentChargeDialog
                                                shipmentId={shipment.id}
                                                shipmentNumber={shipment.shipment_number || 0}
                                                clientId={shipment.clientId}
                                                clientName={shipment.client?.name}
                                                currentCost={shipment.price_total || undefined}
                                            />
                                        )}
                                        <Button variant="ghost" size="icon" className="h-9 w-9 hover:bg-fuchsia-100 dark:hover:bg-fuchsia-900/40" asChild title="Ver detalle del envío">
                                            <Link href={`/shipments/${shipment.id}`}>
                                                <Plane className="h-5 w-5 text-slate-400 hover:text-fuchsia-600 dark:text-slate-500" />
                                                <span className="sr-only">Ver detalle del envío #{shipment.shipment_number}</span>
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
