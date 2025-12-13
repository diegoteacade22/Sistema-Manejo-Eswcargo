
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Printer } from 'lucide-react';
import { getProductColorClass } from '@/lib/utils';
import Link from 'next/link';
import { OrderStatusDialog } from '@/components/order-status-dialog';

interface Props {
    params: Promise<{ id: string }>;
}

async function getOrderDetails(id: string) {
    const orderId = parseInt(id);
    if (isNaN(orderId)) return null;

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
            client: true,
            items: {
                include: {
                    product: true
                }
            }
        }
    });

    return order;
}

export default async function OrderPage(props: Props) {
    const params = await props.params;
    const order = await getOrderDetails(params.id);

    // Fetch active shipments for the dropdown
    const shipments = await (prisma as any).shipment.findMany({
        where: { NOT: { status: 'FINALIZADO' } },
        select: { id: true, shipment_number: true, status: true },
        orderBy: { shipment_number: 'desc' }
    });

    if (!order) {
        return <div>Pedido no encontrado</div>;
    }

    return (
        <div className="p-8 space-y-8">

            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                    <Button variant="outline" size="icon" asChild>
                        <Link href="/orders"><ArrowLeft className="h-4 w-4" /></Link>
                    </Button>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground">Pedido #{order.order_number}</h1>
                        <p className="text-muted-foreground">{new Date(order.date).toLocaleDateString()} - {order.client.name}</p>
                    </div>
                </div>
                <Button variant="secondary">
                    <Printer className="mr-2 h-4 w-4" /> Imprimir Invoice
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                {/* Order Info */}
                <Card className="col-span-2">
                    <CardHeader>
                        <CardTitle>Detalle de Items</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Producto / Detalle</TableHead>
                                    <TableHead className="text-center">Cant</TableHead>
                                    <TableHead className="text-right">Precio Unit.</TableHead>
                                    <TableHead className="text-right">Subtotal</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {order.items.map((item: any) => (
                                    <TableRow key={item.id}>
                                        <TableCell className="font-medium">
                                            {item.productName}
                                            {item.product?.color_grade && (
                                                <span className={`ml-2 text-sm ${getProductColorClass(item.product.color_grade)}`}>
                                                    ({item.product.color_grade})
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-center">{item.quantity}</TableCell>
                                        <TableCell className="text-right">
                                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.unit_price)}
                                        </TableCell>
                                        <TableCell className="text-right font-bold">
                                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.subtotal)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {/* Totals Row */}
                                <TableRow>
                                    <TableCell colSpan={3} className="text-right font-bold text-lg">TOTAL</TableCell>
                                    <TableCell className="text-right font-bold text-lg">
                                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(order.total_amount)}
                                    </TableCell>
                                </TableRow>
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                {/* Sidebar Info */}
                <Card>
                    <CardHeader>
                        <CardTitle>Estado y Notas</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <span className="text-sm font-medium text-muted-foreground">Estado</span>
                            <div className="mt-1">
                                <OrderStatusDialog
                                    orderId={order.id}
                                    currentStatus={order.status}
                                    currentShipmentId={order.shipmentId}
                                    shipments={shipments}
                                />
                            </div>
                        </div>
                        {order.tracking_number && (
                            <div>
                                <span className="text-sm font-medium text-muted-foreground">Tracking</span>
                                <p className="font-mono">{order.tracking_number}</p>
                            </div>
                        )}
                        {order.notes && (
                            <div>
                                <span className="text-sm font-medium text-muted-foreground">Observaciones</span>
                                <p className="text-sm border p-2 rounded bg-muted/50">{order.notes}</p>
                            </div>
                        )}
                        <div>
                            <span className="text-sm font-medium text-muted-foreground">Cliente</span>
                            <p className="font-medium">
                                <Link href={`/clients/${order.clientId}`} className="hover:underline text-blue-600">
                                    {order.client.name}
                                </Link>
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
