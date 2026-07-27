import { auth } from '@/lib/auth';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    ArrowLeft,
    Package,
    Truck,
    Plane,
    Calendar,
    DollarSign,
    User,
    Mail,
    Phone,
    MapPin,
    Instagram,
    Globe,
    Clock,
    CheckCircle2
} from 'lucide-react';
import Link from 'next/link';
import { ShipmentStatusDialog } from '@/components/shipment-status-dialog';
import { ShipmentNotesEditor } from '@/components/shipment-notes-editor';
import { ShipmentQuickTransitions } from '@/components/shipment-quick-transitions';
import { buildShipmentItems, getShipmentItemCount } from '@/lib/shipment-items';
import { getPackingSegments, projectShipmentForPacking } from '@/lib/packing-segments';
import { getClientShipmentAccess } from '@/lib/shipment-visibility';
import { PaymentDialog } from '@/components/payment-dialog';
import { paymentTargetPrefix } from '@/lib/payment-targets';

interface Props {
    params: Promise<{ id: string }>;
}

async function getShipment(id: string, userSession: any) {
    const shipmentId = parseInt(id);
    if (isNaN(shipmentId)) return null;

    const userRole = userSession.user.role;
    const userId = userSession.user.id;

    if (userRole === 'ADMIN') {
        // Automatically sync status before fetching full details (admin only)
        const { syncShipmentStatus } = await import('@/app/actions');
        await syncShipmentStatus(shipmentId);
    }

    let clientId: number | null = null;
    if (userRole === 'CLIENT') {
        const client = await (prisma.client as any).findFirst({
            where: { userId: userId },
            select: { id: true }
        });
        clientId = client?.id || null;
    }

    const shipment = await (prisma as any).shipment.findUnique({
        where: { id: shipmentId },
        include: {
            client: true,
            items: {
                include: {
                    product: true,
                    order: {
                        include: {
                            client: true,
                        }
                    },
                }
            },
            orders: {
                include: {
                    client: true,
                    items: {
                        include: {
                            product: true,
                        }
                    }
                }
            }
        }
    });

    if (shipment && userRole === 'CLIENT') {
        const access = getClientShipmentAccess(shipment, clientId || 0);
        if (access?.segment) {
            return projectShipmentForPacking(shipment, access.segment, access.segmentCount);
        }
        if (!access) {
            return null; // Unauthorized
        }
    }

    return shipment;
}

export default async function ShipmentPage(props: Props) {
    const session = await auth();
    if (!session?.user) return null;

    const params = await props.params;
    const shipment = await getShipment(params.id, session);

    if (!shipment) {
        return notFound();
    }

    const isAdmin = (session.user as any).role === 'ADMIN';
    const shipmentItems = buildShipmentItems(shipment);
    const realItemCount = getShipmentItemCount(shipment);
    const effectiveItemCount = realItemCount > 0 ? realItemCount : (shipment.item_count || 0);
    const packingSegments = getPackingSegments(shipment);
    const isSharedShipment = Boolean((shipment as any).packingSegment?.isSharedShipment) || packingSegments.length > 1;
    const shipmentOwners = new Map<number, { id: number; name: string }>();
    if (shipment.client) shipmentOwners.set(shipment.client.id, shipment.client);
    shipment.items.forEach((item: any) => {
        if (item.order?.client) shipmentOwners.set(item.order.client.id, item.order.client);
    });
    shipment.orders.forEach((order: any) => {
        if (order.client) shipmentOwners.set(order.client.id, order.client);
    });
    const paymentClient = shipmentOwners.size === 1 ? [...shipmentOwners.values()][0] : null;
    const shipmentTotal = Math.abs(shipment.price_total || 0);
    const shipmentPaymentTotal = paymentClient && shipmentTotal > 0
        ? await prisma.transaction.aggregate({
            where: {
                clientId: paymentClient.id,
                type: 'PAGO',
                amount: { gt: 0 },
                reference: { startsWith: `${paymentTargetPrefix({ kind: 'SHIPMENT', id: shipment.id })}:` },
            },
            _sum: { amount: true },
        })
        : null;
    const shipmentPaidAmount = shipmentPaymentTotal?._sum.amount || 0;
    const shipmentPendingAmount = Math.max(0, shipmentTotal - shipmentPaidAmount);

    const productSummaryMap = new Map<string, number>();
    shipmentItems.forEach((item: any) => {
        let productLabel = item.product?.model || item.productName || 'Item';
        if (item.product?.color_grade) {
            productLabel += ` - ${item.product.color_grade}`;
        }
        productSummaryMap.set(productLabel, (productSummaryMap.get(productLabel) || 0) + (item.quantity || 0));
    });
    const productSummary = Array.from(productSummaryMap.entries());

    return (
        <div className="p-8 space-y-8">
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                    <Button variant="ghost" size="icon" asChild>
                        <Link href="/shipments"><ArrowLeft className="h-4 w-4" /></Link>
                    </Button>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-fuchsia-500 to-pink-500 bg-clip-text text-transparent">
                            Envío #{shipment.shipment_number}
                        </h1>
                        <div className="flex items-center gap-2 mt-1">
                            {isAdmin ? (
                                <ShipmentStatusDialog
                                    shipment={shipment as any}
                                    paymentTarget={paymentClient && shipmentTotal > 0 ? {
                                        clientId: paymentClient.id,
                                        clientName: paymentClient.name,
                                        pendingAmount: shipmentPendingAmount,
                                    } : null}
                                />
                            ) : (
                                <Badge className="font-black text-xs uppercase px-4 py-1.5 bg-fuchsia-600 text-white border-none shadow-fuchsia-500/20 shadow-lg">
                                    {shipment.status}
                                </Badge>
                            )}
                            <span className="text-muted-foreground text-sm font-medium">
                                {shipment.date_shipped ? new Date(shipment.date_shipped).toLocaleDateString() : 'Fecha Pendiente'}
                            </span>
                            {isSharedShipment && (
                                <Badge variant="outline" className="border-indigo-400 text-indigo-600 dark:text-indigo-300 font-bold">
                                    Envío compartido
                                </Badge>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" asChild className="rounded-xl border-slate-300 dark:border-slate-700 font-bold">
                        <Link href={`/shipments/${shipment.id}/packing-list`} target="_blank">
                            <span className="mr-2">🖨️</span> Remito de Envío
                        </Link>
                    </Button>
                    {isAdmin && (
                        <Button variant="outline" asChild className="rounded-xl border-slate-300 dark:border-slate-700 font-bold">
                            <Link href={`/shipments/${shipment.id}/edit`}>Editar Envío</Link>
                        </Button>
                    )}
                </div>
            </div>

            {isAdmin && (
                <ShipmentQuickTransitions
                    shipment={{
                        id: shipment.id,
                        shipment_number: shipment.shipment_number,
                        status: shipment.status,
                        forwarder: shipment.forwarder,
                        date_shipped: shipment.date_shipped,
                        date_arrived: shipment.date_arrived,
                        notes: shipment.notes
                    }}
                />
            )}

            <div className="grid gap-6 md:grid-cols-3">
                {/* Main Info */}
                <Card className="col-span-2 md:col-span-2 border-l-4 border-l-fuchsia-500 shadow-xl bg-white dark:bg-slate-950">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Package className="h-5 w-5 text-fuchsia-500" /> Detalles de Carga
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-6 sm:grid-cols-2">
                        {isAdmin && (
                            <div className="space-y-1">
                                <span className="text-sm font-medium text-muted-foreground uppercase tracking-widest text-[10px]">Forwarder</span>
                                <div className="flex items-center gap-2 font-black text-lg text-slate-800 dark:text-slate-200">
                                    <Truck className="h-5 w-5 text-fuchsia-500" />
                                    {shipment.forwarder || '-'}
                                </div>
                            </div>
                        )}
                        <div className="space-y-1">
                            <span className="text-sm font-medium text-muted-foreground uppercase tracking-widest text-[10px]">Tipo de Carga</span>
                            <div className="font-black text-lg uppercase text-slate-800 dark:text-slate-200">{shipment.type_load || '-'}</div>
                        </div>
                        <div className="space-y-1">
                            <span className="text-sm font-medium text-muted-foreground uppercase tracking-widest text-[10px]">Cantidad Artículos</span>
                            <div className="text-3xl font-black text-slate-900 dark:text-white">
                                {effectiveItemCount}
                            </div>
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                            <span className="text-sm font-medium text-muted-foreground uppercase tracking-widest text-[10px]">Detalle Productos Enviados</span>
                            {productSummary.length > 0 ? (
                                <div className="text-xs md:text-sm text-slate-700 dark:text-slate-300 leading-relaxed space-y-1">
                                    {productSummary.slice(0, 5).map(([name, qty]) => (
                                        <div key={name} className="font-semibold">
                                            {qty}x {name}
                                        </div>
                                    ))}
                                    {productSummary.length > 5 && (
                                        <div className="text-slate-500 dark:text-slate-400 italic">
                                            +{productSummary.length - 5} producto(s) más
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="text-xs md:text-sm text-muted-foreground italic">Sin productos vinculados al envío.</div>
                            )}
                        </div>
                        <div className="space-y-2">
                            <span className="text-sm font-medium text-muted-foreground uppercase tracking-widest text-[10px] font-black">Pesos Declarados (Kg)</span>
                            <div className="grid grid-cols-2 gap-3">
                                {isAdmin && (
                                    <div className="bg-slate-100 dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-inner">
                                        <span className="block text-[10px] font-black text-slate-500 uppercase tracking-tighter">Peso FW</span>
                                        <span className="font-mono font-black text-xl text-slate-900 dark:text-slate-100">{shipment.weight_fw?.toFixed(2)}</span>
                                    </div>
                                )}
                                <div className={`${isAdmin ? '' : 'col-span-2'} bg-fuchsia-100 dark:bg-fuchsia-900/30 p-3 rounded-xl border border-fuchsia-300 dark:border-fuchsia-700 shadow-sm`}>
                                    <span className="block text-[10px] font-black text-fuchsia-600 dark:text-fuchsia-400 uppercase tracking-tighter">Peso Liquidado</span>
                                    <span className="font-mono font-black text-2xl text-fuchsia-700 dark:text-fuchsia-300">{shipment.weight_cli?.toFixed(2)}</span>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Client Info */}
                <Card className="shadow-xl border-t-4 border-t-indigo-500 bg-white dark:bg-slate-950">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <User className="h-5 w-5 text-indigo-500" /> {isSharedShipment ? 'Clientes del Envío' : 'Información del Cliente'}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {isSharedShipment ? (
                            <div className="space-y-4">
                                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm font-semibold text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-200">
                                    Este envío contiene artículos de distintos clientes. El Packing List se emite por cliente.
                                </div>
                                {isAdmin ? (
                                    <div className="space-y-2">
                                        {packingSegments.map((segment) => (
                                            <div key={segment.clientId} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
                                                <div className="min-w-0">
                                                    <div className="truncate font-bold text-slate-900 dark:text-slate-100">{segment.client.name}</div>
                                                    <div className="text-xs text-muted-foreground">PL #{segment.documentNumber} · ID: {segment.client.old_id || segment.client.id}</div>
                                                </div>
                                                <Badge variant="secondary" className="shrink-0 font-bold">{segment.itemCount} pcs</Badge>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-sm text-muted-foreground">Consultá el Packing List para ver el detalle asignado.</div>
                                )}
                            </div>
                        ) : shipment.client ? (
                            <div className="space-y-5">
                                <div>
                                    <div className="text-2xl font-black text-indigo-700 dark:text-indigo-400 leading-tight">
                                        {shipment.client.name}
                                    </div>
                                    <div className="flex items-center gap-2 mt-1 py-1 px-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-100 dark:border-indigo-800 w-fit">
                                        <span className="text-xs font-bold text-indigo-600 dark:text-indigo-300">ID: {shipment.client.old_id || shipment.client.id}</span>
                                    </div>
                                </div>
                                <div className="space-y-4 border-t border-slate-100 dark:border-slate-800 pt-5">
                                    <div className="flex flex-col space-y-2 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.2em]">Teléfono / WA</span>
                                            <span className="font-bold text-slate-800 dark:text-slate-100">
                                                {shipment.client.phone || shipment.client.whatsapp || 'No cargado'}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 pt-2">
                                            <span className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.2em]">Email</span>
                                            <span className="font-bold text-slate-800 dark:text-slate-200">
                                                {shipment.client.email || 'No cargado'}
                                            </span>
                                        </div>
                                    </div>
                                    {(shipment.client.city || shipment.client.state) && (
                                        <div className="flex items-center justify-between px-2">
                                            <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Ubicación</span>
                                            <span className="font-bold text-slate-600 dark:text-slate-400 text-sm">
                                                {shipment.client.city}{shipment.client.state ? `, ${shipment.client.state}` : ''}
                                            </span>
                                        </div>
                                    )}
                                    {shipmentTotal > 0 && paymentClient && (
                                        <div className={`rounded-xl border p-3 ${shipmentPendingAmount <= 0.005 ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
                                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Cobranza del envío</span>
                                            <p className={`mt-1 font-black ${shipmentPendingAmount <= 0.005 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                                {shipmentPendingAmount <= 0.005 ? 'COBRADO' : `PENDIENTE ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(shipmentPendingAmount)}`}
                                            </p>
                                            {isAdmin && shipmentPendingAmount > 0.005 && (
                                                <div className="mt-2">
                                                    <PaymentDialog
                                                        clientId={paymentClient.id}
                                                        clientName={paymentClient.name}
                                                        buttonLabel="Registrar cobro"
                                                        buttonSize="sm"
                                                        buttonClassName="bg-emerald-600 hover:bg-emerald-700 text-white"
                                                        target={{ kind: 'SHIPMENT', id: shipment.id, label: `Envío #${shipment.shipment_number || shipment.id}`, pendingAmount: shipmentPendingAmount }}
                                                        defaultAmount={shipmentPendingAmount}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="text-muted-foreground italic bg-slate-100 dark:bg-slate-800 p-8 rounded-2xl text-center border-2 border-dashed border-slate-200 dark:border-slate-700">
                                Sin cliente vinculado
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Financial Info */}
                <Card className="col-span-3 border-t-4 border-t-emerald-500 shadow-2xl bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/40 dark:to-slate-950 overflow-hidden">
                    <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 uppercase tracking-[0.2em] text-[10px] font-black text-emerald-700 dark:text-emerald-400">
                            <DollarSign className="h-4 w-4" /> Resumen de Liquidación
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {!isAdmin && isSharedShipment ? (
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center text-sm font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
                                El valor del servicio se liquida por separado para cada cliente del envío compartido.
                            </div>
                        ) : (
                        <div className={`grid grid-cols-1 ${isAdmin ? 'md:grid-cols-3' : 'md:grid-cols-1'} gap-4 md:gap-0`}>
                            {isAdmin && (
                                <div className="md:border-r border-emerald-100 dark:border-emerald-900/50 px-8 py-2">
                                    <span className="text-[10px] font-black text-emerald-800/60 dark:text-emerald-400/60 uppercase tracking-widest">Costo Operativo</span>
                                    <div className="text-3xl font-mono font-black text-slate-400 mt-1">
                                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(shipment.cost_total || 0)}
                                    </div>
                                </div>
                            )}
                            <div className={`${isAdmin ? 'px-8' : 'text-center'} py-2`}>
                                <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${isAdmin ? 'text-emerald-800/60' : 'text-emerald-600'}`}>
                                    Total a Cobrar Servicio
                                </span>
                                <div className={`${isAdmin ? 'text-5xl' : 'text-6xl'} font-mono font-black text-emerald-600 dark:text-emerald-400 mt-2 drop-shadow-sm`}>
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(shipment.price_total || 0)}
                                </div>
                                {!isAdmin && <p className="text-sm text-emerald-500 font-bold mt-4 italic bg-emerald-100/50 dark:bg-emerald-900/30 py-1 px-6 rounded-full inline-block">Valor fijado por peso y categoría de carga.</p>}
                            </div>
                            {isAdmin && (
                                <div className="md:border-l border-emerald-100 dark:border-emerald-900/50 px-8 py-2 md:text-right">
                                    <span className="text-[10px] font-black text-emerald-800/60 dark:text-emerald-400/60 uppercase tracking-widest">Rentabilidad</span>
                                    <div className={`text-4xl font-mono font-black mt-1 ${(shipment.profit || 0) >= 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-red-500'}`}>
                                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(shipment.profit || 0)}
                                    </div>
                                </div>
                            )}
                        </div>
                        )}
                    </CardContent>
                </Card>

                {/* Dates & Logistics */}
                <Card className="col-span-3 border-l-4 border-l-orange-500 shadow-xl bg-white dark:bg-slate-950">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Calendar className="h-5 w-5 text-orange-500" /> Logística y Seguimiento
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-8 md:grid-cols-2">
                        <div className="bg-slate-50 dark:bg-slate-900 p-6 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-inner">
                            <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Fecha Salida de Origen</span>
                            <p className="text-3xl font-black text-slate-800 dark:text-slate-200 mt-2">
                                {shipment.date_shipped ? new Date(shipment.date_shipped).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Pendiente de Salida'}
                            </p>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-900 p-6 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-inner">
                            <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Fecha Arribo Estimada</span>
                            <p className="text-3xl font-black text-slate-800 dark:text-slate-200 mt-2">
                                {shipment.date_arrived ? new Date(shipment.date_arrived).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : 'En proceso de tránsito'}
                            </p>
                        </div>
                        {isAdmin && (
                            <div className="col-span-2">
                                <ShipmentNotesEditor
                                    shipmentId={shipment.id}
                                    initialNotes={shipment.notes}
                                    currentStatus={shipment.status}
                                />
                            </div>
                        )}
                        {!isAdmin && shipment.notes && shipment.notes !== 'nan' && (
                            <div className="col-span-2">
                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Observaciones</span>
                                <p className="text-sm bg-amber-50/30 dark:bg-slate-900 p-5 rounded-2xl mt-1 border border-amber-100/50 dark:border-slate-800 italic text-slate-600 dark:text-slate-400 shadow-sm leading-relaxed">
                                    "{shipment.notes}"
                                </p>
                            </div>
                        )}
                        <div className="col-span-2 flex flex-col md:flex-row items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-4 gap-4">
                            <div className="flex flex-col">
                                <span className="text-xs font-black text-slate-500 uppercase tracking-[0.3em]">Referencia Interna de Pago (Invoice ID)</span>
                                <div className="text-5xl font-black text-emerald-600 dark:text-emerald-500 mt-2 tracking-tighter drop-shadow-sm">
                                    {shipment.invoice ? Math.floor(parseFloat(shipment.invoice.replace(/[^0-9.]/g, ''))) : '---'}
                                </div>
                            </div>
                            {isAdmin && (
                                <div className="text-right">
                                    <span className="text-[10px] font-black text-slate-400 uppercase block">Data Reference</span>
                                    <code className="text-sm bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-lg text-slate-500">REF_{shipment.shipment_number || shipment.id}</code>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div >
    );
}
