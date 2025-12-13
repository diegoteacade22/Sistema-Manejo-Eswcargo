
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Package, User, Calendar, DollarSign, Weight, Truck } from 'lucide-react';
import Link from 'next/link';

interface Props {
    params: Promise<{ id: string }>;
}

async function getShipment(id: string) {
    const shipment = await (prisma as any).shipment.findUnique({
        where: { id: parseInt(id) },
        include: {
            client: true,
            orders: true
        }
    });
    return shipment;
}

export default async function ShipmentPage(props: Props) {
    const params = await props.params;
    const shipment = await getShipment(params.id);

    if (!shipment) {
        return <div className="p-8 text-center text-muted-foreground">Envío no encontrado</div>;
    }

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
                            <Badge variant="outline">{shipment.status || 'Estado Desconocido'}</Badge>
                            <span className="text-muted-foreground text-sm">
                                {shipment.date_shipped ? new Date(shipment.date_shipped).toLocaleDateString() : 'Fecha Pendiente'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
                {/* Main Info */}
                <Card className="col-span-2 md:col-span-2 border-l-4 border-l-fuchsia-500 shadow-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Package className="h-5 w-5 text-fuchsia-500" /> Detalles de Carga
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-6 sm:grid-cols-2">
                        <div className="space-y-1">
                            <span className="text-sm font-medium text-muted-foreground">Forwarder</span>
                            <div className="flex items-center gap-2 font-medium">
                                <Truck className="h-4 w-4 text-slate-400" />
                                {shipment.forwarder || '-'}
                            </div>
                        </div>
                        <div className="space-y-1">
                            <span className="text-sm font-medium text-muted-foreground">Tipo de Carga</span>
                            <div className="font-medium">{shipment.type_load || '-'}</div>
                        </div>
                        <div className="space-y-1">
                            <span className="text-sm font-medium text-muted-foreground">Cantidad Artículos</span>
                            <div className="text-2xl font-bold text-slate-700 dark:text-slate-200">
                                {shipment.item_count || 0}
                            </div>
                        </div>
                        <div className="space-y-1">
                            <span className="text-sm font-medium text-muted-foreground">Pesos (Kg)</span>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <div className="bg-slate-100 dark:bg-slate-800 p-2 rounded">
                                    <span className="block text-xs text-muted-foreground">Peso FW</span>
                                    <span className="font-mono font-bold">{shipment.weight_fw?.toFixed(2)}</span>
                                </div>
                                <div className="bg-slate-100 dark:bg-slate-800 p-2 rounded">
                                    <span className="block text-xs text-muted-foreground">Peso Cliente</span>
                                    <span className="font-mono font-bold text-fuchsia-600">{shipment.weight_cli?.toFixed(2)}</span>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Client Info */}
                <Card className="shadow-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <User className="h-5 w-5 text-indigo-500" /> Cliente
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {shipment.client ? (
                            <div className="space-y-4">
                                <div>
                                    <Link href={`/clients/${shipment.client.id}`} className="text-lg font-bold text-indigo-600 hover:underline">
                                        {shipment.client.name}
                                    </Link>
                                    <p className="text-sm text-muted-foreground">{shipment.client.email}</p>
                                </div>
                                <div className="text-sm border-t pt-2 mt-2">
                                    <span className="text-muted-foreground">Tel:</span> {shipment.client.phone || '-'}
                                </div>
                            </div>
                        ) : (
                            <div className="text-muted-foreground italic">Sin cliente asignado</div>
                        )}
                    </CardContent>
                </Card>

                {/* Financial Info */}
                <Card className="col-span-3 border-t-4 border-t-emerald-500 shadow-lg bg-emerald-50/30 dark:bg-emerald-950/20">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <DollarSign className="h-5 w-5 text-emerald-600" /> Información Financiera
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            <div>
                                <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Costo Total</span>
                                <div className="text-2xl font-bold text-slate-700 dark:text-slate-200 mt-1">
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(shipment.cost_total || 0)}
                                </div>
                            </div>
                            <div>
                                <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Precio Venta (Cobro)</span>
                                <div className="text-3xl font-bold text-emerald-600 mt-1">
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(shipment.price_total || 0)}
                                </div>
                            </div>
                            <div>
                                <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Ganancia Estimada</span>
                                <div className={`text-2xl font-bold mt-1 ${(shipment.profit || 0) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(shipment.profit || 0)}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Dates & Logistics */}
                <Card className="col-span-3">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Calendar className="h-5 w-5 text-orange-500" /> Logística
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-4 md:grid-cols-2">
                        <div>
                            <span className="text-sm font-medium text-muted-foreground">Fecha Salida</span>
                            <p className="text-lg">{shipment.date_shipped ? new Date(shipment.date_shipped).toLocaleDateString() : '-'}</p>
                        </div>
                        <div>
                            <span className="text-sm font-medium text-muted-foreground">Fecha Llegada</span>
                            <p className="text-lg">{shipment.date_arrived ? new Date(shipment.date_arrived).toLocaleDateString() : '-'}</p>
                        </div>
                        {shipment.notes && (
                            <div className="col-span-2 mt-2">
                                <span className="text-sm font-medium text-muted-foreground">Observaciones</span>
                                <p className="text-sm bg-slate-100 dark:bg-slate-800 p-3 rounded mt-1 border border-slate-200 dark:border-slate-700">
                                    {shipment.notes}
                                </p>
                            </div>
                        )}
                        {shipment.invoice && (
                            <div className="col-span-2">
                                <span className="text-sm font-medium text-muted-foreground">Invoice ID</span>
                                <p className="font-mono text-sm">{shipment.invoice}</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
