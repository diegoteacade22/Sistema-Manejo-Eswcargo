import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Package, Calendar, DollarSign, Mail, Phone, MapPin } from 'lucide-react';

interface Props {
    params: Promise<{ id: string }>;
}

async function getSupplierDetails(id: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supplier = await (prisma as any).supplier.findUnique({
        where: { id: parseInt(id) },
        include: {
            orderItems: {
                include: {
                    order: true,
                    product: true
                },
                orderBy: {
                    id: 'desc'
                }
            }
        }
    });

    return supplier;
}

export default async function SupplierDetailsPage(props: Props) {
    const params = await props.params;
    const supplier = await getSupplierDetails(params.id);

    if (!supplier) {
        notFound();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const totalItems = supplier.orderItems.reduce((acc: number, item: any) => acc + item.quantity, 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const totalSalesValue = supplier.orderItems.reduce((acc: number, item: any) => acc + (item.quantity * item.unit_price), 0);

    return (
        <div className="p-8 space-y-8 max-w-6xl mx-auto">
            <div className="flex items-center space-x-4">
                <Button variant="ghost" size="sm" asChild>
                    <Link href="/suppliers">
                        <ArrowLeft className="mr-2 h-4 w-4" /> Volver
                    </Link>
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Supplier Info */}
                <Card className="md:col-span-1 h-fit shadow-md border-t-4 border-t-fuchsia-600">
                    <CardHeader>
                        <CardTitle className="text-xl">{supplier.name}</CardTitle>
                        <CardDescription>Información del Proveedor</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {supplier.contact && (
                            <div className="flex items-center gap-2 text-sm">
                                <UserIcon className="h-4 w-4 text-muted-foreground" />
                                <span className="font-medium">{supplier.contact}</span>
                            </div>
                        )}
                        {supplier.email && (
                            <div className="flex items-center gap-2 text-sm">
                                <Mail className="h-4 w-4 text-muted-foreground" />
                                <a href={`mailto:${supplier.email}`} className="hover:underline text-blue-600">
                                    {supplier.email}
                                </a>
                            </div>
                        )}
                        {supplier.phone && (
                            <div className="flex items-center gap-2 text-sm">
                                <Phone className="h-4 w-4 text-muted-foreground" />
                                <span>{supplier.phone}</span>
                            </div>
                        )}
                        {supplier.address && (
                            <div className="flex items-center gap-2 text-sm">
                                <MapPin className="h-4 w-4 text-muted-foreground" />
                                <span>{supplier.address}</span>
                            </div>
                        )}

                        <div className="pt-4 border-t mt-4 space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Items Suministrados:</span>
                                <span className="font-bold">{totalItems}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Volumen Ventas:</span>
                                <span className="font-bold text-emerald-600">
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalSalesValue)}
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Movements History */}
                <Card className="md:col-span-2 shadow-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <HistoryIcon className="h-5 w-5 text-cyan-600" />
                            Historial de Movimientos
                        </CardTitle>
                        <CardDescription>Registro de artículos vendidos asociados a este proveedor.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Pedido</TableHead>
                                    <TableHead>Producto</TableHead>
                                    <TableHead className="text-right">Cant.</TableHead>
                                    <TableHead className="text-right">Venta Unit.</TableHead>
                                    <TableHead className="text-right">Factura Compra</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                {supplier.orderItems.map((item: any) => (
                                    <TableRow key={item.id}>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {item.order?.date ? new Date(item.order.date).toLocaleDateString() : '-'}
                                        </TableCell>
                                        <TableCell>
                                            {item.order ? (
                                                <Link href={`/orders/${item.order.order_number}`} className="text-blue-600 hover:underline font-mono text-xs">
                                                    #{item.order.order_number}
                                                </Link>
                                            ) : <span className="text-xs text-red-500">N/A</span>}
                                        </TableCell>
                                        <TableCell className="max-w-[200px] truncate text-sm" title={item.productName}>
                                            <div className="font-medium text-slate-700 dark:text-slate-300">
                                                {item.productName}
                                            </div>
                                            {item.product?.sku && (
                                                <div className="text-[10px] text-muted-foreground font-mono">
                                                    {item.product.sku}
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-sm">
                                            {item.quantity}
                                        </TableCell>
                                        <TableCell className="text-right font-medium text-emerald-600">
                                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.unit_price)}
                                        </TableCell>
                                        <TableCell className="text-right text-xs text-muted-foreground">
                                            {item.purchase_invoice || '-'}
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {supplier.orderItems.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                            No hay movimientos registrados.
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

function UserIcon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
        </svg>
    )
}

function HistoryIcon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 12" />
            <path d="M3 3v9h9" />
            <path d="M12 7v5l4 2" />
        </svg>
    )
}
