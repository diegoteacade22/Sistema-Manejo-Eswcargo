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
import { OrderItemsEditor } from '@/components/order-items-editor';

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
                    product: true,
                    shipment: true // Include shipment for items
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

    // Determine effective shipment (Order level or Item level fallback)
    // We assume if items have different shipments, we show the first one or logic to indicate split?
    // For now, usually all items go together.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const effectiveShipment = (order as any).shipment || (order as any).items.find((i: any) => i.shipment)?.shipment;

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
                        <OrderItemsEditor
                            items={order.items as any[]}
                            totalAmount={order.total_amount}
                            isAdmin={isAdmin}
                        />
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
                                        currentShipmentId={effectiveShipment?.id}
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
                                {effectiveShipment ? (
                                    <Link href={`/shipments/${effectiveShipment.id}`} className="inline-flex items-center px-4 py-1.5 rounded-xl text-xs font-black bg-fuchsia-600 text-white hover:bg-fuchsia-700 transition-colors uppercase tracking-wider shadow-lg shadow-fuchsia-500/20">
                                        Envío #{effectiveShipment.shipment_number}
                                    </Link>
                                ) : order.status === 'ENTREGADO' ? (
                                    <span className="text-sm font-black text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30 px-3 py-1 rounded-full uppercase text-[10px] tracking-tight">
                                        Entrega Directa / Finalizado
                                    </span>
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
