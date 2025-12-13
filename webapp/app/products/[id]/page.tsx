import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Package, User } from 'lucide-react';
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
                    }
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
                    </CardContent>
                </Card>

                {/* Sales History Card */}
                <Card className="md:col-span-2 shadow-md">
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
                                </TableRow>
                            </TableHeader>
                            <TableBody>
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
                                    </TableRow>
                                ))}
                                {product.orderItems.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
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
