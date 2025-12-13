'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createShipment } from '@/app/actions';
import { Loader2 } from 'lucide-react';

export default function NewShipmentForm({ clients }: { clients: { id: number; name: string }[] }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    // State
    const [forwarder, setForwarder] = useState('');
    const [clientId, setClientId] = useState<string>('0'); // 0 = Varios/Stock
    const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [notes, setNotes] = useState('');

    const handleSubmit = async () => {
        if (!forwarder) {
            alert('Ingrese el Forwarder');
            return;
        }

        startTransition(async () => {
            const result = await createShipment({
                forwarder,
                clientId: clientId !== '0' ? parseInt(clientId) : null,
                date_shipped: new Date(date),
                notes
            });

            if (result.success) {
                router.push('/shipments');
            } else {
                alert('Error: ' + result.message);
            }
        });
    };

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <Card>
                <CardContent className="pt-6 grid gap-4 grid-cols-1 md:grid-cols-2">
                    <div className="space-y-2">
                        <Label>Forwarder / Transportista</Label>
                        <Input
                            value={forwarder}
                            onChange={e => setForwarder(e.target.value)}
                            placeholder="Ej: DHL, UPS, CargoEx..."
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Cliente Principal (Opcional)</Label>
                        <Select value={clientId} onValueChange={setClientId}>
                            <SelectTrigger>
                                <SelectValue placeholder="Seleccionar Cliente" />
                            </SelectTrigger>
                            <SelectContent className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                                <SelectItem value="0">-- Varios / Stock Propio --</SelectItem>
                                {clients.map(c => (
                                    <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label>Fecha de Salida</Label>
                        <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
                    </div>

                    <div className="space-y-2">
                        <Label>Tipo de Carga</Label>
                        <Input placeholder="Ej: Aereo, Maritimo..." />
                    </div>

                    <div className="space-y-2">
                        <Label>Invoice ID</Label>
                        <Input placeholder="Nro Factura" />
                    </div>

                    <div className="space-y-2 md:col-span-2">
                        <Label>Notas / Referencia</Label>
                        <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ej: Vuelo Latam #1234" />
                    </div>
                </CardContent>
            </Card>

            <div className="flex justify-end space-x-4">
                <Button variant="outline" onClick={() => router.back()} disabled={isPending}>Cancelar</Button>
                <Button onClick={handleSubmit} disabled={isPending} className="bg-fuchsia-600 hover:bg-fuchsia-700 text-white">
                    {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Crear Envío
                </Button>
            </div>
        </div>
    );
}
