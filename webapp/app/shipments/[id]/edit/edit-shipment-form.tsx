
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { updateShipment } from '@/app/actions';
import { Loader2 } from 'lucide-react';
import { Shipment } from '@prisma/client';

export default function EditShipmentForm({ shipment }: { shipment: Shipment }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const [formData, setFormData] = useState({
        status: shipment.status || 'SALIENDO',
        forwarder: shipment.forwarder || '',
        date_shipped: shipment.date_shipped ? new Date(shipment.date_shipped).toISOString().split('T')[0] : '',
        date_arrived: shipment.date_arrived ? new Date(shipment.date_arrived).toISOString().split('T')[0] : '',
        notes: shipment.notes || ''
    });

    const handleChange = (field: string, value: string) => {
        setFormData(prev => {
            const updates: any = { [field]: value };

            // Auto-calculate dates based on Status Logic if status changes
            if (field === 'status') {
                const today = new Date();

                // If changing tO default SALIENDO and no date exists, set today
                if (value === 'SALIENDO' && !prev.date_shipped) {
                    updates.date_shipped = today.toISOString().split('T')[0];
                }

                // LLEGANDO: 2 days after shipped date (if shipped date exists)
                if (value === 'LLEGANDO' && prev.date_shipped) {
                    const shipped = new Date(prev.date_shipped);
                    shipped.setDate(shipped.getDate() + 2);
                    updates.date_arrived = shipped.toISOString().split('T')[0]; // Estimated arrival
                }

                // EN BSAS / ARRIBA: if Arrival Date matches Today? 
                // Logic requested: "en BsAs: si la fecha de llegada coincide con la fecha del dia"
                // That's a display logic or auto-status update logic usually.
                // Here we are editing manually. 

                // ENTREGADO: 2 days after arrival
                if (value === 'ENTREGADO' && prev.date_arrived) {
                    // Actually Entregado means delivered TO client? Or to warehouse?
                    // "Entregado: 2 dias despues de llegada"
                }
            }

            // If changing dates, maybe suggest status?
            return { ...prev, ...updates };
        });
    };

    const handleSubmit = async () => {
        startTransition(async () => {
            const res = await updateShipment({
                id: shipment.id,
                ...formData,
                date_shipped: formData.date_shipped ? new Date(formData.date_shipped) : null,
                date_arrived: formData.date_arrived ? new Date(formData.date_arrived) : null,
            });

            if (res.success) {
                router.push(`/shipments/${shipment.id}`);
                router.refresh();
            } else {
                alert('Error al actualizar: ' + res.error);
            }
        });
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Editar Envío #{shipment.shipment_number}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid gap-2">
                    <Label>Estado</Label>
                    <Select value={formData.status} onValueChange={(val) => handleChange('status', val)}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="MIAMI">MIAMI</SelectItem>
                            <SelectItem value="SALIENDO">SALIENDO</SelectItem>
                            <SelectItem value="LLEGANDO">LLEGANDO</SelectItem>
                            <SelectItem value="EN BSAS">EN BSAS</SelectItem>
                            <SelectItem value="ENTREGADO">ENTREGADO</SelectItem>
                            <SelectItem value="FINALIZADO">FINALIZADO</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Fecha Salida</Label>
                        <Input
                            type="date"
                            value={formData.date_shipped}
                            onChange={(e) => handleChange('date_shipped', e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Fecha Llegada (Estimada/Real)</Label>
                        <Input
                            type="date"
                            value={formData.date_arrived}
                            onChange={(e) => handleChange('date_arrived', e.target.value)}
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <Label>Forwarder</Label>
                    <Input
                        value={formData.forwarder}
                        onChange={(e) => handleChange('forwarder', e.target.value)}
                    />
                </div>

                <div className="space-y-2">
                    <Label>Observaciones</Label>
                    <Textarea
                        value={formData.notes}
                        onChange={(e) => handleChange('notes', e.target.value)}
                    />
                </div>

                <div className="pt-4 flex justify-end space-x-2">
                    <Button variant="outline" onClick={() => router.back()} disabled={isPending}>Cancelar</Button>
                    <Button onClick={handleSubmit} disabled={isPending}>
                        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Guardar Cambios
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
