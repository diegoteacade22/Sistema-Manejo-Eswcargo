'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileCheck2, Loader2, Paperclip, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ReceiptInput } from '@/components/receipt-input';
import { registerAccountEvidence } from './actions';

type ClientOption = { id: number; name: string; old_id: number | null };
type EvidenceItem = {
    id: number;
    category: string;
    note: string | null;
    source: string | null;
    fileName: string | null;
    createdAt: string;
    client: { id: number; name: string; old_id: number | null };
    transaction: { id: number; type: string; amount: number; reference: string | null } | null;
};

const EVIDENCE_CATEGORIES = [
    ['INVOICE', 'Invoice / venta'],
    ['PAYMENT_RECEIPT', 'Recibo de pago'],
    ['BANK', 'Comprobante bancario'],
    ['CASHFLOW', 'Respaldo Cash Flow'],
    ['OTHER', 'Otro respaldo'],
] as const;

function formatDate(value: string) {
    return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export function EvidenceClient({ clients, evidence }: { clients: ClientOption[]; evidence: EvidenceItem[] }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [clientId, setClientId] = useState('');
    const [category, setCategory] = useState('INVOICE');
    const [file, setFile] = useState<File | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const submit = (formData: FormData) => {
        setMessage(null);
        formData.set('clientId', clientId);
        formData.set('category', category);
        if (file) formData.set('evidenceFile', file);

        startTransition(async () => {
            try {
                const result = await registerAccountEvidence(formData);
                if (!result.success) throw new Error('No se pudo registrar la evidencia.');
                setMessage({ type: 'success', text: 'Evidencia registrada. La cuenta queda lista para revisión, sin modificar su saldo.' });
                setFile(null);
                router.refresh();
            } catch (error) {
                setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo registrar la evidencia.' });
            }
        });
    };

    return (
        <div className="p-8 space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/maintenance"><Button variant="ghost" size="icon" aria-label="Volver a Mantenimiento"><ArrowLeft className="h-5 w-5" /></Button></Link>
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight">Evidencia de cuentas</h2>
                        <p className="mt-1 text-muted-foreground">Documentá el respaldo antes de corregir una cuenta corriente.</p>
                    </div>
                </div>
            </div>

            {message && (
                <div className={`border-l-4 px-4 py-3 text-sm ${message.type === 'success' ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-red-500 bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300'}`}>
                    {message.text}
                </div>
            )}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Paperclip className="h-5 w-5 text-emerald-500" /> Registrar respaldo</CardTitle>
                        <CardDescription>Un adjunto, referencia externa o nota. No modifica cargos, pagos ni saldos.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form action={submit} className="space-y-5">
                            <div className="space-y-2">
                                <Label>Cuenta</Label>
                                <Select value={clientId} onValueChange={setClientId}>
                                    <SelectTrigger><SelectValue placeholder="Seleccionar cuenta" /></SelectTrigger>
                                    <SelectContent>
                                        {clients.map((client) => <SelectItem key={client.id} value={String(client.id)}>{client.name}{client.old_id !== null ? ` (#${client.old_id})` : ''}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Tipo de evidencia</Label>
                                <Select value={category} onValueChange={setCategory}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>{EVIDENCE_CATEGORIES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="source">Referencia externa</Label>
                                <Input id="source" name="source" placeholder="Drive, número de comprobante o enlace" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="note">Nota de conciliación</Label>
                                <Textarea id="note" name="note" placeholder="Qué respalda y qué movimiento debe revisarse." />
                            </div>
                            <ReceiptInput file={file} onFileChange={setFile} inputId="account-evidence-file" />
                            <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={isPending || !clientId}>
                                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-2 h-4 w-4" />}
                                Registrar evidencia
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Últimos respaldos</CardTitle>
                        <CardDescription>La evidencia deja la corrección preparada, pero no ejecuta cambios automáticamente.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {evidence.length === 0 ? (
                            <p className="py-8 text-center text-sm text-muted-foreground">Todavía no hay evidencia registrada para cuentas corrientes.</p>
                        ) : (
                            <div className="space-y-3">
                                {evidence.map((item) => (
                                    <div key={item.id} className="border-l-4 border-emerald-500 bg-slate-50 p-4 text-sm dark:bg-slate-900">
                                        <div className="flex flex-wrap items-start justify-between gap-2"><strong>{item.client.name}{item.client.old_id !== null ? ` #${item.client.old_id}` : ''}</strong><span className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</span></div>
                                        <p className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">{item.category}</p>
                                        {item.note && <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{item.note}</p>}
                                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                            {item.source && <span>Referencia: {item.source}</span>}
                                            {item.fileName && <a className="inline-flex items-center gap-1 text-emerald-700 hover:underline dark:text-emerald-300" href={`/api/maintenance/evidence/${item.id}`} target="_blank" rel="noreferrer">Adjunto: {item.fileName} <ExternalLink className="h-3 w-3" /></a>}
                                            {item.transaction && <span>Movimiento #{item.transaction.id}: {item.transaction.type} USD {item.transaction.amount.toFixed(2)}</span>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
