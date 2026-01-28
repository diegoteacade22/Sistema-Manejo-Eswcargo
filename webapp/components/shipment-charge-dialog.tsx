'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DollarSign, Loader2 } from 'lucide-react';
import { registerShipmentCharge } from '@/app/actions';
import { toast } from 'sonner';

interface ChargeDialogProps {
    shipmentId: number;
    shipmentNumber: number;
    clientId?: number | null;
    clientName?: string | null;
    currentCost?: number; // Helps to suggest amount
}

export function ShipmentChargeDialog({ shipmentId, shipmentNumber, clientId, clientName, currentCost }: ChargeDialogProps) {
    const [open, setOpen] = useState(false);
    const [amount, setAmount] = useState(currentCost?.toString() || '');
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!clientId) {
            toast.error('Este envío no tiene un cliente asignado. Edite el envío primero.');
            return;
        }

        if (!amount || parseFloat(amount) <= 0) {
            toast.error('Ingrese un monto válido.');
            return;
        }

        setLoading(true);

        const res = await registerShipmentCharge(
            shipmentId,
            clientId,
            parseFloat(amount),
            notes
        );

        setLoading(false);
        if (res.success) {
            setOpen(false);
            setNotes('');
            toast.success('Cargo registrado en cuenta corriente.');
        } else {
            toast.error(res.message || 'Error al registrar cargo');
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/40"
                    title="Cargar costo a Cuenta Cliente"
                    disabled={!clientId}
                >
                    <DollarSign className="h-5 w-5" />
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] bg-slate-50 dark:bg-slate-900">
                <DialogHeader>
                    <DialogTitle className="text-red-600 dark:text-red-400">Registrar Cargo de Envío</DialogTitle>
                    <DialogDescription>
                        Esto agregará un DEBITO en la cuenta de <strong>{clientName || 'Cliente desconocido'}</strong> por el Envío #{shipmentNumber}.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    {!clientId && (
                        <div className="p-3 mb-2 text-sm text-yellow-700 bg-yellow-100 rounded-md border border-yellow-200">
                            ⚠️ Este envío no tiene un cliente único asignado. Asigne uno en "Editar" para poder cobrarle.
                        </div>
                    )}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="amount" className="text-right font-bold text-slate-700 dark:text-slate-200">
                            Monto (USD)
                        </Label>
                        <Input
                            id="amount"
                            type="number"
                            step="0.01"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="col-span-3 font-mono font-bold text-lg"
                            placeholder="0.00"
                            required
                            disabled={!clientId}
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="notes" className="text-right text-slate-600">
                            Notas
                        </Label>
                        <Textarea
                            id="notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="col-span-3"
                            placeholder="Ej: Costo por Kg, Seguro, etc..."
                            disabled={!clientId}
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            type="submit"
                            disabled={loading || !clientId}
                            className="bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-200 dark:shadow-red-900/20"
                        >
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {loading ? 'Procesando...' : 'Confirmar Cargo'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
