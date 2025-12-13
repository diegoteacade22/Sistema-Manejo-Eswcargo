
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Plus, Plane } from 'lucide-react';
import { SearchInput } from '@/components/search-input';
import { Suspense } from 'react';
import { ChevronLeft, ChevronRight } from "lucide-react";

async function getShipments(query: string, page: number = 1, pageSize: number = 20) {
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (query) {
        where.OR = [
            { forwarder: { contains: query } },
            { client: { name: { contains: query } } }
        ];
        // If query is a number, try exact match on shipment_number
        if (!isNaN(parseInt(query))) {
            where.OR.push({ shipment_number: parseInt(query) });
        }
    }

    const totalCount = await (prisma as any).shipment.count({ where });

    const shipments = await (prisma as any).shipment.findMany({
        where,
        orderBy: { date_shipped: 'desc' },
        include: { client: true },
        take: pageSize,
        skip: skip
    });

    return { shipments, totalCount, totalPages: Math.ceil(totalCount / pageSize) };
}

export default async function ShipmentsPage(props: { searchParams: Promise<{ q?: string, page?: string }> }) {
    const searchParams = await props.searchParams;
    const query = searchParams?.q || '';
    const page = parseInt(searchParams?.page || '1');
    const pageSize = 20;

    const { shipments, totalCount, totalPages } = await getShipments(query, page, pageSize);

    return (
        <div className="p-8 space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-fuchsia-500 to-pink-600 bg-clip-text text-transparent">
                        Envíos
                    </h2>
                    <p className="text-muted-foreground mt-1">Gestión de logística y seguimiento de cargas</p>
                </div>
                <Button asChild className="bg-fuchsia-600 hover:bg-fuchsia-700 text-white shadow-lg shadow-fuchsia-200">
                    <Link href="/shipments/new">
                        <Plus className="mr-2 h-4 w-4" /> Nuevo Envío
                    </Link>
                </Button>
            </div>

            <Card className="border-t-4 border-t-fuchsia-500 shadow-lg">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <Suspense fallback={<div>Cargando buscador...</div>}>
                            <SearchInput placeholder="Buscar por Nro, Forwarder o Cliente..." />
                        </Suspense>
                        <div className="text-sm text-muted-foreground">
                            {totalCount} envíos registrados
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="w-[100px]">Nro Envío</TableHead>
                                <TableHead>Fecha Salida</TableHead>
                                <TableHead>Forwarder</TableHead>
                                <TableHead>Cliente</TableHead>
                                <TableHead className="text-right">Peso (Kg)</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead className="w-[50px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {shipments.map((shipment: any) => (
                                <TableRow key={shipment.id} className="hover:bg-muted/50 dark:border-slate-800">
                                    <TableCell className="font-mono font-bold">#{shipment.shipment_number}</TableCell>
                                    <TableCell>
                                        {shipment.date_shipped ? new Date(shipment.date_shipped).toLocaleDateString() : '-'}
                                    </TableCell>
                                    <TableCell className="font-medium text-slate-700 dark:text-slate-300">{shipment.forwarder || '-'}</TableCell>
                                    <TableCell>{shipment.client?.name || 'Varios/Stock'}</TableCell>
                                    <TableCell className="text-right">{shipment.weight_fw?.toFixed(2) || '-'}</TableCell>
                                    <TableCell>
                                        <Badge variant={shipment.status?.includes('SI') ? 'default' : 'secondary'}
                                            className={shipment.status?.includes('SI') ? 'bg-emerald-500 hover:bg-emerald-600 dark:text-white' : ''}>
                                            {shipment.status || 'En Tránsito'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                                            <Link href={`/shipments/${shipment.id}`}>
                                                <Plane className="h-4 w-4 text-slate-400 hover:text-fuchsia-500" />
                                            </Link>
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {shipments.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
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
                        <Link href={`/shipments?q=${query}&page=${page - 1}`} scroll={false}>
                            <ChevronLeft className="h-4 w-4 mr-2" /> Anterior
                        </Link>
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages}
                        asChild
                    >
                        <Link href={`/shipments?q=${query}&page=${page + 1}`} scroll={false}>
                            Siguiente <ChevronRight className="h-4 w-4 ml-2" />
                        </Link>
                    </Button>
                </div>
            </div>
        </div>
    );
}
