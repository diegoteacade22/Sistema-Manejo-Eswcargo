
'use client'

import { useState } from 'react'
import { createCollection } from '@/app/collections/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Loader2 } from 'lucide-react'
import { Client } from '@prisma/client'

// Pre-defined payment methods
import { useRouter } from 'next/navigation'

const PAYMENT_METHODS = [
    'Wire TD Bank',
    'Wire Mercury',
    'USDT',
    'Efectivo',
    'Plataforma de Pagos'
]

export function NewCollectionForm({ clients }: { clients: Client[] }) {
    // Use string for native date input (YYYY-MM-DD)
    const [dateStr, setDateStr] = useState<string>(new Date().toISOString().split('T')[0])

    // Controlled states for Selects to ensure data capture
    const [clientId, setClientId] = useState<string>('')
    const [paymentMethod, setPaymentMethod] = useState<string>('')

    const [loading, setLoading] = useState(false)
    const router = useRouter()

    async function onSubmit(formData: FormData) {
        setLoading(true)
        try {
            // Explicitly set values from state if needed, though hidden inputs handle this naturally generally.
            // But for safety:
            if (!formData.get('clientId')) formData.set('clientId', clientId);
            if (!formData.get('paymentMethod')) formData.set('paymentMethod', paymentMethod);

            const result = await createCollection(formData)
            if (result && result.success) {
                router.push('/collections')
            }
        } catch (error) {
            console.error(error)
            alert(error instanceof Error ? error.message : 'Error al crear cobranza')
        } finally {
            setLoading(false)
        }
    }

    return (
        <form action={onSubmit} className="space-y-6 max-w-2xl bg-slate-50 dark:bg-slate-900 p-6 rounded-lg shadow-sm border">

            <div className="space-y-2">
                <Label htmlFor="date">Fecha</Label>
                <Input
                    type="date"
                    id="date"
                    name="date"
                    value={dateStr}
                    onChange={(e) => setDateStr(e.target.value)}
                    required
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="clientId">Cliente</Label>
                {/* Controlled Select with Hidden Input */}
                <input type="hidden" name="clientId" value={clientId} />
                <Select value={clientId} onValueChange={setClientId} required>
                    <SelectTrigger>
                        <SelectValue placeholder="Seleccionar Cliente" />
                    </SelectTrigger>
                    <SelectContent>
                        {clients
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((client) => (
                                <SelectItem key={client.id} value={String(client.id)}>
                                    {client.name}
                                </SelectItem>
                            ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label htmlFor="amount">Importe</Label>
                <div className="relative">
                    <span className="absolute left-3 top-2.5 text-gray-500">$</span>
                    <Input
                        id="amount"
                        name="amount"
                        type="number"
                        step="0.01"
                        min="0"
                        className="pl-7"
                        placeholder="0.00"
                        required
                    />
                </div>
            </div>

            <div className="space-y-2">
                <Label htmlFor="paymentMethod">Método de Pago</Label>
                {/* Controlled Select with Hidden Input */}
                <input type="hidden" name="paymentMethod" value={paymentMethod} />
                <Select value={paymentMethod} onValueChange={setPaymentMethod} required>
                    <SelectTrigger>
                        <SelectValue placeholder="Seleccionar Método" />
                    </SelectTrigger>
                    <SelectContent>
                        {PAYMENT_METHODS.map((method) => (
                            <SelectItem key={method} value={method}>
                                {method}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label htmlFor="description">Notas / Detalles (Opcional)</Label>
                <Textarea
                    id="description"
                    name="description"
                    placeholder="Detalles adicionales..."
                />
            </div>

            <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700" disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Registrar Cobranza
            </Button>
        </form>
    )
}
