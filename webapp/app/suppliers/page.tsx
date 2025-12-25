
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Plus, Truck } from 'lucide-react';
import { SearchInput } from '@/components/search-input';
import { Suspense } from 'react';
import Link from 'next/link';
import { EditSupplierDialog } from '@/components/edit-supplier-dialog';
import { SortableColumn, SortOrder } from '@/components/ui/sortable-column';

async function getSuppliers(query: string, sortField: string = 'operations', sortOrder: SortOrder = 'desc') {
    let orderBy: any = {};
    switch (sortField) {
        case 'name': orderBy = { name: sortOrder }; break;
        case 'contact': orderBy = { contact: sortOrder }; break;
        case 'email': orderBy = { email: sortOrder }; break;
        case 'operations': orderBy = { orderItems: { _count: sortOrder } }; break;
        default: orderBy = { orderItems: { _count: 'desc' } };
    }

    return await (prisma as any).supplier.findMany({
        where: {
            OR: [
                { name: { contains: query } },
                { contact: { contains: query } },
                { email: { contains: query } }
            ]
        },
        orderBy
    });
}

export default async function SuppliersPage(props: { searchParams: Promise<{ q?: string, sort?: string, order?: string }> }) {
    const searchParams = await props.searchParams;
    const query = searchParams?.q || '';
    const sort = searchParams?.sort || 'operations';
    const order = (searchParams?.order as SortOrder) || 'desc';

    const suppliers = await getSuppliers(query, sort, order);

    return (
        <div className="p-8 space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-orange-500 to-amber-600 bg-clip-text text-transparent">
                        Proveedores
                    </h2>
                    <p className="text-muted-foreground mt-1">Gestión de proveedores y compras</p>
                </div>
                <EditSupplierDialog
                    mode="create"
                    trigger={
                        <Button className="bg-orange-600 hover:bg-orange-700 text-white shadow-lg shadow-orange-200">
                            <Plus className="mr-2 h-4 w-4" /> Nuevo Proveedor
                        </Button>
                    }
                />
            </div>

            <Card className="border-t-4 border-t-orange-500 shadow-lg">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <Suspense fallback={<div>Cargando buscador...</div>}>
                            <SearchInput placeholder="Buscar proveedor..." />
                        </Suspense>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <SortableColumn field="name" label="Nombre" currentSort={sort} currentOrder={order} query={query} baseUrl="/suppliers" />
                                <SortableColumn field="contact" label="Contacto" currentSort={sort} currentOrder={order} query={query} baseUrl="/suppliers" />
                                <SortableColumn field="email" label="Email" currentSort={sort} currentOrder={order} query={query} baseUrl="/suppliers" />
                                <TableHead className="w-[50px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {suppliers.map((supplier: any) => (
                                <TableRow key={supplier.id} className="hover:bg-muted/50 dark:border-slate-800">
                                    <TableCell className="font-bold text-slate-900 dark:text-slate-50 text-base">
                                        <Link href={`/suppliers/${supplier.id}`} className="hover:underline hover:text-orange-600 block w-full h-full">
                                            {supplier.name}
                                        </Link>
                                    </TableCell>
                                    <TableCell className="text-slate-700 dark:text-slate-200 font-medium">
                                        <Link href={`/suppliers/${supplier.id}`} className="block w-full h-full">
                                            {supplier.contact || '-'}
                                        </Link>
                                    </TableCell>
                                    <TableCell className="text-slate-600 dark:text-slate-300 font-mono">{supplier.email || '-'}</TableCell>
                                    <TableCell>
                                        <div className="flex items-center justify-end gap-2">
                                            <EditSupplierDialog mode="edit" supplier={supplier} />
                                            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                                                <Link href={`/suppliers/${supplier.id}`}>
                                                    <Truck className="h-4 w-4 text-slate-400 hover:text-orange-500" />
                                                </Link>
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {suppliers.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                                        No se encontraron proveedores.
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
