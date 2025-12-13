
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Plus, Package, History, ChevronLeft, ChevronRight } from 'lucide-react';
import { SearchInput } from '@/components/search-input';
import { Suspense } from 'react';
import { getProductColorClass } from '@/lib/utils';
import { EditProductDialog } from '@/components/edit-product-dialog';

async function getProducts(query: string, page: number = 1, pageSize: number = 20) {
    const skip = (page - 1) * pageSize;

    // 1. Where Clause
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
        AND: [
            { active: true }, // Filter out inactive (e.g. REPUESTO if marked as such)
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

    // 3. Fetch Page
    const products = await prisma.product.findMany({
        where,
        orderBy: { name: 'asc' },
        take: pageSize,
        skip: skip
    });

    return { products, totalCount, totalPages: Math.ceil(totalCount / pageSize) };
}

export default async function ProductsPage(props: { searchParams: Promise<{ q?: string, page?: string }> }) {
    const searchParams = await props.searchParams;
    const query = searchParams?.q || '';
    const page = parseInt(searchParams?.page || '1');
    const pageSize = 20;

    const { products, totalCount, totalPages } = await getProducts(query, page, pageSize);

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
                    <div className="flex items-center justify-between">
                        <Suspense fallback={<div>Cargando buscador...</div>}>
                            <SearchInput placeholder="Buscar por SKU o Nombre..." />
                        </Suspense>
                        <div className="text-sm text-muted-foreground">
                            {products.length}+ artículos disponibles
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[100px]">SKU</TableHead>
                                <TableHead>Descripción</TableHead>
                                <TableHead>Color/Grade</TableHead>
                                <TableHead className="text-right">Precio Venta</TableHead>
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
                                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(product.lp1 || 0)}
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
                        <Link href={`/products?q=${query}&page=${page - 1}`} scroll={false}>
                            <ChevronLeft className="h-4 w-4 mr-2" /> Anterior
                        </Link>
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages}
                        asChild
                    >
                        <Link href={`/products?q=${query}&page=${page + 1}`} scroll={false}>
                            Siguiente <ChevronRight className="h-4 w-4 ml-2" />
                        </Link>
                    </Button>
                </div>
            </div>
        </div>
    );
}
