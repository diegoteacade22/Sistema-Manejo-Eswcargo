import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Package, User, ShoppingCart, Truck } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

interface Props {
    params: Promise<{ id: string }>;
}

async function getProductDetails(id: string) {
    const product = await prisma.product.findUnique({
        where: { id: parseInt(id) },
        include: {
            orderItems: {
                include: {
                    order: {
                        include: {
                            client: true
                        }
                    },
                    supplier: true // Include Supplier
                },
                orderBy: {
                    order: {
                        date: 'desc'
                    }
                }
            }
        }
    });
    return product;
}

export default async function ProductDetailsPage(props: Props) {
    const params = await props.params;
    const product = await getProductDetails(params.id);

    if (!product) {
        notFound();
    }

    // Calculate aggregated stats
    const soldPrices = product.orderItems.map(item => item.unit_price).filter(p => p > 0);
    const maxSoldPrice = soldPrices.length > 0 ? Math.max(...soldPrices) : null;
    const minSoldPrice = soldPrices.length > 0 ? Math.min(...soldPrices) : null;

    // Supplier analysis
    // Find item with lowest cost (purchase price)
    // Avoid costs <= 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itemsWithCost = product.orderItems.filter((item: any) => item.unit_cost > 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let bestCostItem: any = null;
    if (itemsWithCost.length > 0) {
        bestCostItem = itemsWithCost.reduce((min, item) => item.unit_cost < min.unit_cost ? item : min, itemsWithCost[0]);
    }

    // Extract unique suppliers
    const supplierMap = new Map();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    product.orderItems.forEach((item: any) => {
        if (item.supplier) {
            supplierMap.set(item.supplier.id, item.supplier);
        }
    });
    const uniqueSuppliers = Array.from(supplierMap.values());


    return (
        <div className="p-8 space-y-8 max-w-6xl mx-auto">
            <div className="flex items-center space-x-4">
                <Button variant="ghost" size="sm" asChild>
                    <Link href="/products">
                        <ArrowLeft className="mr-2 h-4 w-4" /> Volver
                    </Link>
                </Button>
            </div>

            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center space-x-3">
                        <h2 className="text-3xl font-bold tracking-tight text-foreground">
                            {product.name}
                        </h2>
                        {!product.active && <Badge variant="destructive">Discontinuado</Badge>}
                    </div>
                    <p className="text-muted-foreground mt-1 font-mono">{product.sku}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Product Info Card */}
                <Card className="md:col-span-1 shadow-sm h-fit">
                    <CardHeader className="bg-muted/30 border-b">
                        <CardTitle className="text-lg">Detalles</CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 space-y-4">
                        <div className="flex justify-between py-2 border-b">
                            <span className="text-sm text-muted-foreground">Precio Lista (LP1)</span>
                            <span className="font-bold text-foreground">
                                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(product.lp1 || 0)}
                            </span>
                        </div>
                        <div className="flex justify-between py-2 border-b">
                            <span className="text-sm text-muted-foreground">Color/Grade</span>
                            <span className="text-sm font-medium">{product.color_grade || '-'}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b">
                            <span className="text-sm text-muted-foreground">Tipo</span>
                            <span className="text-sm font-medium">{product.type || '-'}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b">
                            <span className="text-sm text-muted-foreground">Marca/Modelo</span>
                            <span className="text-sm font-medium">{product.brand} {product.model}</span>
                        </div>

                        <div className="pt-2 mt-2 border-t space-y-2">
                            <div className="flex justify-between items-center">
                                <span className="text-sm font-medium text-emerald-600">Max. Vendido:</span>
                                <span className="font-bold text-emerald-700">
                                    {maxSoldPrice ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(maxSoldPrice) : '-'}
                                </span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-sm font-medium text-amber-600">Min. Vendido:</span>
                                <span className="font-bold text-amber-700">
                                    {minSoldPrice ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minSoldPrice) : '-'}
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Suppliers Insight Card */}
                <Card className="md:col-span-1 shadow-sm h-fit border-t-4 border-t-cyan-500">
                    <CardHeader className="bg-muted/10 border-b">
                        <CardTitle className="text-lg flex items-center gap-2">
                            <Truck className="h-5 w-5 text-cyan-600" />
                            Proveedores y Costos
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 space-y-6">
                        {/* Best Cost */}
                        <div className="bg-emerald-50 dark:bg-emerald-950/20 p-4 rounded-lg border border-emerald-100 dark:border-emerald-900">
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-emerald-600 mb-1">Mejor Precio de Compra</h4>
                            {bestCostItem ? (
                                <div>
                                    <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(bestCostItem.unit_cost)}
                                    </div>
                                    <div className="text-sm text-muted-foreground mt-1">
                                        Provisto por: <Link href={`/suppliers/${bestCostItem.supplier?.id}`} className="font-medium text-emerald-800 dark:text-emerald-300 hover:underline">{bestCostItem.supplier?.name || 'Desconocido'}</Link>
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-1">
                                        Fecha: {new Date(bestCostItem.order.date).toLocaleDateString()}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-sm text-muted-foreground italic">No hay información de costos disponible.</div>
                            )}
                        </div>

                        {/* Supplier List */}
                        <div>
                            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                                <ShoppingCart className="h-4 w-4 text-slate-500" />
                                Todos los Proveedores
                            </h4>
                            {uniqueSuppliers.length > 0 ? (
                                <ul className="space-y-2">
                                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                    {uniqueSuppliers.map((sup: any) => (
                                        <li key={sup.id} className="text-sm bg-slate-50 dark:bg-slate-900 px-3 py-2 rounded-md flex justify-between items-center group">
                                            <span className="font-medium text-slate-700 dark:text-slate-300">{sup.name}</span>
                                            <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" asChild>
                                                <Link href={`/suppliers/${sup.id}`}>
                                                    <ArrowLeft className="h-3 w-3 rotate-180" />
                                                </Link>
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-muted-foreground">No se han registrado proveedores para este producto.</p>
                            )}
                        </div>

                    </CardContent>
                </Card>


                {/* Sales History Card */}
                <Card className="md:col-span-3 shadow-md">
                    <CardHeader>
                        <CardTitle className="flex items-center">
                            <Package className="mr-2 h-5 w-5 text-cyan-600" />
                            Historial de Ventas
                        </CardTitle>
                        <CardDescription>
                            Registro de pedidos donde se incluyó este artículo.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Cliente</TableHead>
                                    <TableHead>Detalle Venta</TableHead>
                                    <TableHead className="text-right">Cant.</TableHead>
                                    <TableHead className="text-right">Precio Pagado</TableHead>
                                    <TableHead className="text-right">Proveedor</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                {product.orderItems.map((item: any) => (
                                    <TableRow key={item.id}>
                                        <TableCell className="text-sm text-slate-500">
                                            {item.order.date.toLocaleDateString()}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center space-x-2">
                                                <User className="h-3 w-3 text-slate-400" />
                                                <span className="font-medium text-slate-700">{item.order.client.name}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-xs text-slate-500 max-w-[200px] truncate" title={item.productName}>
                                            {item.productName}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-xs">
                                            {item.quantity}
                                        </TableCell>
                                        <TableCell className="text-right font-bold text-emerald-600">
                                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.unit_price)}
                                        </TableCell>
                                        <TableCell className="text-right text-xs">
                                            {item.supplier ? (
                                                <Link href={`/suppliers/${item.supplier.id}`} className="hover:underline text-blue-600">
                                                    {item.supplier.name}
                                                </Link>
                                            ) : <span className="text-slate-400">-</span>}
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {product.orderItems.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                            Sin ventas registradas.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
