
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Plus, History, ChevronLeft, ChevronRight } from 'lucide-react';
import { SearchInput } from '@/components/search-input';
import { Suspense } from 'react';
import { getProductColorClass } from '@/lib/utils';
import { EditProductDialog } from '@/components/edit-product-dialog';
import { ProductSortSelect } from '@/app/products/product-sort-select';
import { SortableColumn, SortOrder } from '@/components/ui/sortable-column';


async function getProducts(query: string, page: number = 1, pageSize: number = 20, sortField: string = 'popular', sortOrder: SortOrder = 'desc') {
    const skip = (page - 1) * pageSize;

    // 1. Where Clause
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
        AND: [
            { active: true },
            {
                OR: [
                    { name: { contains: query } },
                    { sku: { contains: query } }
                ]
            }
        ]
    };

    // 2. Count Total
    const totalCount = await prisma.product.count({ where });

    // 3. OrderBy Logic
    let orderBy: any = {};

    // Handle specific sort fields including 'popular' legacy/default
    if (sortField === 'popular') {
        orderBy = { orderItems: { _count: 'desc' } };
    } else {
        switch (sortField) {
            case 'sku': orderBy = { sku: sortOrder }; break;
            case 'name': orderBy = { name: sortOrder }; break;
            case 'color': orderBy = { color_grade: sortOrder }; break;
            case 'price': orderBy = { lp1: sortOrder }; break;
            default: orderBy = { orderItems: { _count: 'desc' } };
        }
    }

    // 4. Fetch Page with Last Price
    const rawProducts = await prisma.product.findMany({
        where,
        orderBy,
        take: pageSize,
        skip: skip,
        include: {
            orderItems: {
                take: 1,
                orderBy: { id: 'desc' },
                select: { unit_price: true }
            }
        }
    });

    const products = rawProducts.map(p => ({
        ...p,
        last_sale_price: p.orderItems[0]?.unit_price ?? null
    }));

    return { products, totalCount, totalPages: Math.ceil(totalCount / pageSize) };
}

export default async function ProductsPage(props: { searchParams: Promise<{ q?: string, page?: string, sort?: string, order?: string }> }) {
    const searchParams = await props.searchParams;
    const query = searchParams?.q || '';
    const page = parseInt(searchParams?.page || '1');
    const sort = searchParams?.sort || 'popular';
    // If order param is not present, default based on sort field
    let defaultOrder: SortOrder = 'desc';
    if (sort === 'name' || sort === 'sku' || sort === 'color') defaultOrder = 'asc';

    const order = (searchParams?.order as SortOrder) || defaultOrder;
    const pageSize = 20;

    const { products, totalCount, totalPages } = await getProducts(query, page, pageSize, sort, order);

    return (
        <div className="p-8 space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
                        Artículos
                    </h2>
                    <p className="text-muted-foreground mt-1">Catálogo de productos y control de stock</p>
                </div>
                <EditProductDialog
                    mode="create"
                    trigger={
                        <Button className="bg-cyan-600 hover:bg-cyan-700 text-white shadow-lg shadow-cyan-200">
                            <Plus className="mr-2 h-4 w-4" /> Nuevo Artículo
                        </Button>
                    }
                />
            </div>

            <Card className="border-t-4 border-t-cyan-500 shadow-lg">
                <CardHeader>
                    <div className="flex flex-col md:flex-row gap-4 justify-between items-center">
                        <div className="flex items-center gap-4 w-full md:w-auto">
                            <Suspense fallback={<div>Cargando buscador...</div>}>
                                <SearchInput placeholder="Buscar por SKU o Nombre..." />
                            </Suspense>

                            <form className="flex-shrink-0">
                                <ProductSortSelect currentSort={sort} />
                            </form>
                        </div>
                        <div className="text-sm text-muted-foreground whitespace-nowrap">
                            {products.length}+ artículos
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <SortableColumn field="sku" label="SKU" currentSort={sort} currentOrder={order} query={query} page={page} baseUrl="/products" />
                                <SortableColumn field="name" label="Descripción" currentSort={sort} currentOrder={order} query={query} page={page} baseUrl="/products" />
                                <SortableColumn field="color" label="Color/Grade" currentSort={sort} currentOrder={order} query={query} page={page} baseUrl="/products" />
                                <SortableColumn field="price" label="Precio Venta" currentSort={sort} currentOrder={order} query={query} page={page} baseUrl="/products" alignRight />
                                <TableHead className="w-[50px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {products.map((product: any) => (
                                <TableRow key={product.id} className="hover:bg-muted/50 dark:border-slate-800">
                                    <TableCell className="font-mono text-xs text-muted-foreground">{product.sku}</TableCell>
                                    <TableCell className="font-medium text-slate-700 dark:text-slate-200">{product.name}</TableCell>
                                    <TableCell className="text-sm">
                                        {product.color_grade && (
                                            <span className={getProductColorClass(product.color_grade)}>
                                                {product.color_grade}
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right font-bold text-slate-700 dark:text-slate-200">
                                        {/* Show Last Sale Price if available, else LP1 */}
                                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(product.last_sale_price ?? product.lp1 ?? 0)}
                                        {product.last_sale_price !== null && (
                                            <span className="block text-[10px] font-normal text-muted-foreground">Ult. Venta</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center justify-end gap-2">
                                            <EditProductDialog mode="edit" product={product} />
                                            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                                                <Link href={`/products/${product.id}`} title="Ver Historial">
                                                    <History className="h-4 w-4 text-slate-400 hover:text-blue-600" />
                                                </Link>
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {products.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                        No se encontraron artículos con "{query}".
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

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
                        <Link href={`/products?q=${query}&page=${page - 1}&sort=${sort}&order=${order}`} scroll={false}>
                            <ChevronLeft className="h-4 w-4 mr-2" /> Anterior
                        </Link>
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages}
                        asChild
                    >
                        <Link href={`/products?q=${query}&page=${page + 1}&sort=${sort}&order=${order}`} scroll={false}>
                            <ChevronLeft className="h-4 w-4 mr-2" /> Siguiente
                        </Link>
                    </Button>
                </div>
            </div>
        </div>
    );
}
