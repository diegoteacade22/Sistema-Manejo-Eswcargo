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
}

export function ShipmentStatusDialog({ shipment }: ShipmentStatusDialogProps) {
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState(shipment.status || 'SALIENDO');
    const [isPending, startTransition] = useTransition();

    const handleSave = () => {
        startTransition(async () => {
            const result = await updateShipment({
                id: shipment.id,
                status: status,
                forwarder: shipment.forwarder || undefined,
                date_shipped: shipment.date_shipped ? new Date(shipment.date_shipped) : null,
                date_arrived: shipment.date_arrived ? new Date(shipment.date_arrived) : null,
                notes: shipment.notes || undefined
            });
            if (result.success) {
                setOpen(false);
            } else {
                alert('Error: ' + result.error);
            }
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
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                        Cancelar
                    </Button>
                    <Button onClick={handleSave} disabled={isPending}>
                        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Sincronizar Todo
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
