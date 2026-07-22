
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CreditCard } from 'lucide-react';
import { registerPaymentFromForm } from '@/app/actions';
import { ReceiptInput } from '@/components/receipt-input';

export function PaymentDialog({
    clientId,
    clientName,
    buttonLabel = 'Registrar Pago',
    buttonVariant = 'outline',
    buttonSize,
    buttonClassName,
    target,
    defaultAmount,
}: {
    clientId: number;
    clientName: string;
    buttonLabel?: string;
    buttonVariant?: React.ComponentProps<typeof Button>['variant'];
    buttonSize?: React.ComponentProps<typeof Button>['size'];
    buttonClassName?: string;
    target?: { kind: 'ORDER' | 'SHIPMENT'; id: number; label: string; pendingAmount: number };
    defaultAmount?: number;
}) {
    const [open, setOpen] = useState(false);
    const [amount, setAmount] = useState(defaultAmount ? defaultAmount.toFixed(2) : '');
    const [reference, setReference] = useState('');
    const [description, setDescription] = useState('');
    const [method, setMethod] = useState('');
    const [proof, setProof] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        const formData = new FormData();
        formData.set('clientId', String(clientId));
        formData.set('amount', amount);
        formData.set('description', description);
        formData.set('reference', reference);
        formData.set('paymentMethod', method);
        if (target) {
            formData.set('targetKind', target.kind);
            formData.set('targetId', String(target.id));
        }
        if (proof) formData.set('proof', proof);

        const res = await registerPaymentFromForm(formData);

        setLoading(false);
        if (res.success) {
            setOpen(false);
            setAmount('');
            setReference('');
            setDescription('');
            setMethod('');
            setProof(null);
            // Ideally show a toast here
        } else {
            alert(res.error || 'Error al registrar pago');
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button
                    variant={buttonVariant}
                    size={buttonSize}
                    className={buttonClassName || "border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"}
                >
                    <CreditCard className="mr-2 h-4 w-4" /> {buttonLabel}
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] bg-card text-card-foreground shadow-2xl">
                <DialogHeader>
                    <DialogTitle>Registrar Pago</DialogTitle>
                    <DialogDescription>
                        {target
                            ? `${target.label}: pendiente ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(target.pendingAmount)}.`
                            : `Ingresa los detalles del pago recibido de ${clientName}.`}
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="amount" className="text-right">
                            Monto
                        </Label>
                        <Input
                            id="amount"
                            type="number"
                            step="0.01"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="col-span-3"
                            placeholder="0.00"
                            max={target?.pendingAmount}
                            required
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="method" className="text-right">
                            Método
                        </Label>
                        <div className="col-span-3">
                            <Select value={method} onValueChange={setMethod} required>
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar método" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="USDT">USDT</SelectItem>
                                    <SelectItem value="WIRE">WIRE</SelectItem>
                                    <SelectItem value="EFECTIVO">Efectivo</SelectItem>
                                    <SelectItem value="TARJETA">Tarjeta</SelectItem>
                                    <SelectItem value="OTRO">Otro</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="reference" className="text-right">
                            Referencia
                        </Label>
                        <Input
                            id="reference"
                            value={reference}
                            onChange={(e) => setReference(e.target.value)}
                            className="col-span-3"
                            placeholder="# Comprobante / Transferencia"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="description" className="text-right">
                            Notas
                        </Label>
                        <Textarea
                            id="description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="col-span-3"
                            placeholder="Detalles adicionales..."
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">
                            Comprobante
                        </Label>
                        <div className="col-span-3">
                            <ReceiptInput file={proof} onFileChange={setProof} inputId="dialog-proof" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="submit" disabled={loading} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                            {loading ? 'Registrando...' : 'Confirmar Pago'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
