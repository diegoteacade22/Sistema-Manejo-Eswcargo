'use client';

import { useState, useTransition } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { updateOrderStatus } from '@/app/actions';
import { Edit2, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface OrderStatusDialogProps {
    orderId: number;
    currentStatus: string;
    currentShipmentId: number | null;
    shipments: { id: number; shipment_number: number | null; status: string | null }[];
}

export function OrderStatusDialog({ orderId, currentStatus, currentShipmentId, shipments }: OrderStatusDialogProps) {
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState(currentStatus);
    const [shipmentId, setShipmentId] = useState<string>(currentShipmentId ? currentShipmentId.toString() : '');
    const [isPending, startTransition] = useTransition();

    const handleSave = () => {
        startTransition(async () => {
            const shipId = shipmentId ? parseInt(shipmentId) : null;

            // Validation: specifically, if status implies shipping, we might warn but for now we trust input

            const result = await updateOrderStatus(orderId, status, shipId);
            if (result.success) {
                setOpen(false);
            }
        });
    };

    const showShipmentSelect = status === 'EN_TRANSITO' || status === 'SALIENDO' || status === 'ENTREGADO';

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <div className="cursor-pointer hover:opacity-80 transition-opacity">
                    <Badge className="text-md py-1 pr-3 gap-2">
                        {currentStatus}
                        <Edit2 className="h-3 w-3" />
                    </Badge>
                </div>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Actualizar Estado del Pedido</DialogTitle>
                    <DialogDescription>
                        Cambie el estado y asigne un envío si corresponde.
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
                                <SelectItem value="PENDIENTE">PENDIENTE</SelectItem>
                                <SelectItem value="SALIENDO">SALIENDO</SelectItem>
                                <SelectItem value="EN_TRANSITO">EN TRANSITO</SelectItem>
                                <SelectItem value="ENTREGADO">ENTREGADO</SelectItem>
                                <SelectItem value="CANCELADO">CANCELADO</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {showShipmentSelect && (
                        <div className="grid gap-2 animate-in fade-in zoom-in-95 duration-200">
                            <Label htmlFor="shipment">Asignar a Envío (Shipment)</Label>
                            <Select value={shipmentId} onValueChange={setShipmentId}>
                                <SelectTrigger id="shipment">
                                    <SelectValue placeholder="Seleccione Nro de Envío..." />
                                </SelectTrigger>
                                <SelectContent className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                                    <SelectItem value="0">-- Sin Asignar --</SelectItem>
                                    {shipments.map((ship) => (
                                        <SelectItem key={ship.id} value={ship.id.toString()}>
                                            Envío #{ship.shipment_number} ({ship.status || 'Activo'})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-[0.8rem] text-muted-foreground">
                                Seleccione el contenedor/envío en el que viaja esta mercadería.
                            </p>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                        Cancelar
                    </Button>
                    <Button onClick={handleSave} disabled={isPending}>
                        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Guardar Cambios
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
