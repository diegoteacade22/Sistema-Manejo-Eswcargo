'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { submitOrder } from '@/app/actions';
import { Trash2, Plus, Loader2 } from 'lucide-react';

interface Client {
    id: number;
    name: string;
}

interface Product {
    id: number;
    name: string;
    sku: string;
    lp1: number | null;
    last_purchase_cost: number | null;
    color_grade: string | null;
}

interface OrderItemRow {
    productId: string; // stored as string for Select value, converted later
    name: string;
    quantity: number;
    price: number;
    cost: number;
}

export default function NewOrderForm({ clients, products }: { clients: Client[], products: Product[] }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [clientId, setClientId] = useState<string>('');
    const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [items, setItems] = useState<OrderItemRow[]>([]);
    const [notes, setNotes] = useState('');

    const addItem = () => {
        setItems([...items, { productId: '', name: '', quantity: 1, price: 0, cost: 0 }]);
    };

    const removeItem = (index: number) => {
        const newItems = [...items];
        newItems.splice(index, 1);
        setItems(newItems);
    };

    const updateItem = (index: number, field: keyof OrderItemRow, value: any) => {
        const newItems = [...items];
        const item = { ...newItems[index], [field]: value };

        // Auto-fill details if product changes
        if (field === 'productId') {
            const product = products.find(p => p.id.toString() === value);
            if (product) {
                item.name = product.name;
                item.price = product.lp1 || 0;
                item.cost = product.last_purchase_cost || 0;
            }
        }

        newItems[index] = item;
        setItems(newItems);
    };

    const totalAmount = items.reduce((acc, item) => acc + (item.price * item.quantity), 0);

    const handleSubmit = async () => {
        if (!clientId) {
            alert('Seleccione un cliente');
            return;
        }
        if (items.length === 0) {
            alert('Agregue al menos un producto');
            return;
        }

        startTransition(async () => {
            const payload = {
                clientId: parseInt(clientId),
                date: new Date(date),
                items: items.map(i => ({
                    productId: i.productId ? parseInt(i.productId) : null,
                    name: i.name || 'Item manual', // Fallback if no product selected
                    quantity: i.quantity,
                    price: i.price,
                    cost: i.cost
                })),
                notes
            };

            const result = await submitOrder(payload);
            if (result.success) {
                router.push('/orders');
            } else {
                alert('Error: ' + result.message);
            }
        });
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardContent className="pt-6 grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                        <Label>Cliente</Label>
                        <Select value={clientId} onValueChange={setClientId}>
                            <SelectTrigger>
                                <SelectValue placeholder="Seleccionar Cliente" />
                            </SelectTrigger>
                            <SelectContent>
                                {clients.map(c => (
                                    <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Fecha</Label>
                        <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
                    </div>
                    <div className="col-span-2 space-y-2">
                        <Label>Notas</Label>
                        <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Observaciones..." />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardContent className="pt-6">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[60%]">Producto</TableHead>
                                <TableHead className="w-[10%] text-center">Cant.</TableHead>
                                <TableHead className="w-[15%] text-right">Precio Unit.</TableHead>
                                <TableHead className="w-[15%] text-right">Subtotal</TableHead>
                                <TableHead></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.map((item, index) => (
                                <TableRow key={index}>
                                    <TableCell>
                                        <Select
                                            value={item.productId}
                                            onValueChange={(val) => updateItem(index, 'productId', val)}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="Buscar producto..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {products.map(p => (
                                                    <SelectItem key={p.id} value={p.id.toString()}>
                                                        {p.sku} - {p.name} {p.color_grade ? `(${p.color_grade})` : ''}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        {/* Optional: Allow custom name edit if needed */}
                                    </TableCell>
                                    <TableCell>
                                        <Input
                                            type="number"
                                            min="1"
                                            value={item.quantity}
                                            onChange={e => updateItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            value={item.price}
                                            onChange={e => updateItem(index, 'price', parseFloat(e.target.value) || 0)}
                                        />
                                    </TableCell>
                                    <TableCell className="text-right font-medium">
                                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.price * item.quantity)}
                                    </TableCell>
                                    <TableCell>
                                        <Button variant="ghost" size="icon" onClick={() => removeItem(index)}>
                                            <Trash2 className="h-4 w-4 text-red-500" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>

                    <div className="mt-4 flex justify-between items-center">
                        <Button variant="outline" onClick={addItem}>
                            <Plus className="mr-2 h-4 w-4" /> Agregar Item
                        </Button>
                        <div className="text-2xl font-bold">
                            Total: {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalAmount)}
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="flex justify-end space-x-4">
                <Button variant="outline" onClick={() => router.back()} disabled={isPending}>Cancelar</Button>
                <Button onClick={handleSubmit} disabled={isPending}>
                    {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Confirmar Venta
                </Button>
            </div>
        </div>
    );
}
