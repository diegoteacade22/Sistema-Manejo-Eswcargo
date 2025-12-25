import { auth } from '@/lib/auth';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Package, Clock, CreditCard, ArrowLeft, Eye, Printer } from 'lucide-react';
import Link from 'next/link';
import { getProductColorClass } from '@/lib/utils';
import { OrderStatusDialog } from '@/components/order-status-dialog';

interface Props {
    params: Promise<{ id: string }>;
}

async function getOrderDetails(id: string, userSession: any) {
    const orderId = parseInt(id);
    if (isNaN(orderId)) return null;

    const userRole = userSession.user.role;
    const userId = userSession.user.id;

    let clientId: number | null = null;
    if (userRole === 'CLIENT') {
        const client = await (prisma.client as any).findFirst({
            where: { userId: userId },
            select: { id: true }
        });
        clientId = client?.id || null;
    }

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
            client: true,
            shipment: true,
            items: {
                include: {
                    product: true
                }
            }
        }
    });

    if (order && userRole === 'CLIENT' && order.clientId !== clientId) {
        return null; // Unauthorized
    }

    return order;
}

export default async function OrderPage(props: Props) {
    const session = await auth();
    if (!session?.user) return null;

    const params = await props.params;
    const order = await getOrderDetails(params.id, session);

    if (!order) {
        return notFound();
    }

    const isAdmin = (session.user as any).role === 'ADMIN';

    // Fetch active shipments for the dropdown (Admin only)
    let shipments: any[] = [];
    if (isAdmin) {
        shipments = await (prisma as any).shipment.findMany({
            where: { NOT: { status: 'FINALIZADO' } },
            select: { id: true, shipment_number: true, status: true },
            orderBy: { shipment_number: 'desc' }
        });
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
                {isAdmin && (
                    <Button variant="secondary" asChild>
                        <Link href={`/orders/${order.id}/invoice`} target="_blank">
                            <Printer className="mr-2 h-4 w-4" /> Imprimir Invoice
                        </Link>
                    </Button>
                )}
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
                                <TableRow className="bg-slate-50 dark:bg-slate-900/50">
                                    <TableCell colSpan={3} className="text-right font-black text-lg">TOTAL PAGADO / A PAGAR</TableCell>
                                    <TableCell className="text-right font-black text-xl text-indigo-600 dark:text-indigo-400">
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
                        <CardTitle>Estado y Seguimiento</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <span className="text-sm font-medium text-muted-foreground">Estado Actual</span>
                            <div className="mt-1">
                                {isAdmin ? (
                                    <OrderStatusDialog
                                        orderId={order.id}
                                        currentStatus={order.status}
                                        currentShipmentId={order.shipmentId}
                                        shipments={shipments}
                                    />
                                ) : (
                                    <Badge className="font-black text-sm uppercase px-4 py-1">
                                        {order.status}
                                    </Badge>
                                )}
                            </div>
                        </div>
                        <div>
                            <span className="text-sm font-medium text-muted-foreground">Envío Asignado</span>
                            <div className="mt-1">
                                {(order as any).shipment ? (
                                    <Link href={`/shipments/${(order as any).shipment.id}`} className="inline-flex items-center px-4 py-1.5 rounded-xl text-xs font-black bg-fuchsia-600 text-white hover:bg-fuchsia-700 transition-colors uppercase tracking-wider shadow-lg shadow-fuchsia-500/20">
                                        Envío #{(order as any).shipment.shipment_number}
                                    </Link>
                                ) : (
                                    <span className="text-sm text-muted-foreground italic bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full">Sin asignar aún</span>
                                )}
                            </div>
                        </div>
                        {order.tracking_number && (
                            <div>
                                <span className="text-sm font-medium text-muted-foreground">Número de Tracking</span>
                                <p className="font-mono font-bold text-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 p-2 rounded-lg mt-1">{order.tracking_number}</p>
                            </div>
                        )}
                        {order.notes && (
                            <div>
                                <span className="text-sm font-medium text-muted-foreground">Observaciones Relevantes</span>
                                <p className="text-sm border border-slate-200 dark:border-slate-800 p-3 rounded-xl bg-muted/30 italic text-slate-600 dark:text-slate-400 mt-1">{order.notes}</p>
                            </div>
                        )}
                        <div>
                            <span className="text-sm font-medium text-muted-foreground">Cliente</span>
                            <p className="font-black text-lg">
                                {isAdmin ? (
                                    <Link href={`/clients/${order.clientId}`} className="hover:underline text-blue-600">
                                        {order.client.name}
                                    </Link>
                                ) : (
                                    <span>{order.client.name}</span>
                                )}
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div >
    );
}
