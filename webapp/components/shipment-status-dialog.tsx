'use client';

import { useState, useTransition } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { updateShipment } from '@/app/actions';
import { Edit2, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getStatusColorClass } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { registerPaymentFromForm } from '@/app/actions';

interface ShipmentStatusDialogProps {
    shipment: {
        id: number;
        shipment_number: number | null;
        status: string;
        forwarder?: string | null;
        date_shipped?: Date | null;
        date_arrived?: Date | null;
        notes?: string | null;
    };
    paymentTarget?: {
        clientId: number;
        clientName: string;
        pendingAmount: number;
    } | null;
}

export function ShipmentStatusDialog({ shipment, paymentTarget }: ShipmentStatusDialogProps) {
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState(shipment.status || 'SALIENDO');
    const [registerPayment, setRegisterPayment] = useState(false);
    const [amount, setAmount] = useState(paymentTarget?.pendingAmount ? paymentTarget.pendingAmount.toFixed(2) : '');
    const [method, setMethod] = useState('');
    const [reference, setReference] = useState('');
    const [isPending, startTransition] = useTransition();

    const handleSave = () => {
        startTransition(async () => {
            const isDelivery = status.toUpperCase() === 'ENTREGADO';
            const result = await updateShipment({
                id: shipment.id,
                status: status,
                forwarder: shipment.forwarder || undefined,
                date_shipped: shipment.date_shipped ? new Date(shipment.date_shipped) : null,
                date_arrived: shipment.date_arrived ? new Date(shipment.date_arrived) : null,
                notes: shipment.notes || undefined,
                deliveryPaymentReviewed: isDelivery,
            });
            if (!result.success) {
                alert('Error: ' + result.error);
                return;
            }

            if (isDelivery && registerPayment) {
                if (!paymentTarget) {
                    alert('El envío tiene más de un cliente o no tiene importe. Registrá los cobros desde cada pedido.');
                    return;
                }
                const formData = new FormData();
                formData.set('clientId', String(paymentTarget.clientId));
                formData.set('amount', amount);
                formData.set('paymentMethod', method);
                formData.set('reference', reference);
                formData.set('targetKind', 'SHIPMENT');
                formData.set('targetId', String(shipment.id));
                formData.set('description', `Cobranza al entregar envío #${shipment.shipment_number || shipment.id}`);
                const payment = await registerPaymentFromForm(formData);
                if (!payment.success) {
                    alert(`El envío quedó entregado, pero no se registró el cobro: ${payment.error || 'revisá los datos.'}`);
                    return;
                }
            }
            setOpen(false);
        });
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <div className="cursor-pointer hover:opacity-80 transition-opacity">
                    <Badge variant="outline" className={`gap-2 py-1 px-3 text-xs font-black tracking-wide shadow-sm transition-all ${getStatusColorClass(shipment.status)}`}>
                        {!shipment.status || shipment.status.toLowerCase() === 'nan' ? 'SIN ESTADO' : shipment.status}
                        <Edit2 className="h-3 w-3 opacity-60" />
                    </Badge>
                </div>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Actualizar Estado del Envío #{shipment.shipment_number}</DialogTitle>
                    <DialogDescription>
                        Al cambiar el estado del envío, se actualizarán todos los pedidos e ítems asociados.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="status">Estado</Label>
                        <Select value={status} onValueChange={setStatus}>
                            <SelectTrigger id="status">
                                <SelectValue placeholder="Seleccione estado" />
                            </SelectTrigger>
                            <SelectContent className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                                <SelectItem value="MIAMI">MIAMI</SelectItem>
                                <SelectItem value="SALIENDO">SALIENDO</SelectItem>
                                <SelectItem value="LLEGANDO">LLEGANDO</SelectItem>
                                <SelectItem value="EN BSAS">EN BSAS</SelectItem>
                                <SelectItem value="ENTREGADO">ENTREGADO</SelectItem>
                                <SelectItem value="FINALIZADO">FINALIZADO</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {status.toUpperCase() === 'ENTREGADO' && (
                        <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                            <p className="text-sm font-bold text-amber-800 dark:text-amber-200">Antes de entregar: ¿este envío ya está cobrado?</p>
                            {paymentTarget ? (
                                <label className="flex items-center gap-2 text-sm font-medium">
                                    <input
                                        type="checkbox"
                                        checked={registerPayment}
                                        onChange={(event) => setRegisterPayment(event.target.checked)}
                                    />
                                    Registrar cobro ahora ({new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(paymentTarget.pendingAmount)} pendiente)
                                </label>
                            ) : (
                                <p className="text-xs text-muted-foreground">Envío compartido o sin importe: los cobros se registran desde cada pedido.</p>
                            )}
                            {registerPayment && paymentTarget && (
                                <div className="grid gap-2">
                                    <Input type="number" min="0.01" max={paymentTarget.pendingAmount} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Importe cobrado" required />
                                    <Select value={method} onValueChange={setMethod}>
                                        <SelectTrigger><SelectValue placeholder="Método de pago" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="USDT">USDT</SelectItem>
                                            <SelectItem value="WIRE">Transferencia</SelectItem>
                                            <SelectItem value="EFECTIVO">Efectivo</SelectItem>
                                            <SelectItem value="TARJETA">Tarjeta</SelectItem>
                                            <SelectItem value="OTRO">Otro</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Referencia o comprobante (opcional)" />
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                        Cancelar
                    </Button>
                    <Button onClick={handleSave} disabled={isPending || (status.toUpperCase() === 'ENTREGADO' && registerPayment && (!amount || !method))}>
                        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {status.toUpperCase() === 'ENTREGADO' ? 'Confirmar entrega' : 'Guardar estado'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
