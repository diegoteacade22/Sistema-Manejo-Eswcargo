
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
    last_sale_price: number | null;
}

interface Supplier {
    id: number;
    name: string;
}

interface Shipment {
    id: number;
    shipment_number: number;
    forwarder: string | null;
}

interface OrderItemRow {
    productId: string; // stored as string for Select value
    name: string;
    quantity: number;
    price: number;
    cost: number;
    supplierId: string; // string for Select
    purchase_invoice: string;
    shipment_number: number | '';
    status: string;
}

export default function NewOrderForm({ clients, products, suppliers, shipments }: { clients: Client[], products: Product[], suppliers: Supplier[], shipments: Shipment[] }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [clientId, setClientId] = useState<string>('');
    const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [type, setType] = useState<string>('CELL-NEW'); // Default type
    const [items, setItems] = useState<OrderItemRow[]>([]);
    const [notes, setNotes] = useState('');

    const addItem = () => {
        setItems([...items, {
            productId: '',
            name: '',
            quantity: 1,
            price: 0,
            cost: 0,
            supplierId: '',
            purchase_invoice: '',
            shipment_number: '',
            status: 'RESERVADO'
        }]);
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
                item.price = product.last_sale_price ?? product.lp1 ?? 0;
                item.cost = product.last_purchase_cost || 0;
                // Maybe auto-fill Supplier if last purchase available? Not in current schema context lightly.
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
                type: type,
                items: items.map(i => ({
                    productId: i.productId ? parseInt(i.productId) : null,
                    name: i.name || 'Item manual',
                    quantity: i.quantity,
                    price: i.price,
                    cost: i.cost,
                    supplierId: i.supplierId ? parseInt(i.supplierId) : null,
                    purchase_invoice: i.purchase_invoice,
                    shipment_number: i.shipment_number !== '' ? Number(i.shipment_number) : null,
                    status: i.status
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
                <CardContent className="pt-6 grid gap-4 md:grid-cols-4">
                    <div className="space-y-2 col-span-1">
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
                    <div className="space-y-2 col-span-1">
                        <Label>Fecha</Label>
                        <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
                    </div>
                    <div className="space-y-2 col-span-1">
                        <Label>Tipo Venta</Label>
                        <Input value={type} onChange={e => setType(e.target.value)} placeholder="Ej. CELL-NEW" />
                    </div>
                    <div className="col-span-1 space-y-2">
                        <Label>Notas</Label>
                        <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Observaciones..." />
                    </div>
                </CardContent>
            </Card>

            <Card className="overflow-hidden">
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/50">
                                    <TableHead className="w-[300px]">Producto / SKU</TableHead>
                                    <TableHead className="w-[80px]">Cant.</TableHead>
                                    <TableHead className="w-[120px]">Precio Venta</TableHead>
                                    <TableHead className="w-[120px]">Costo Unit.</TableHead>
                                    <TableHead className="w-[180px]">Proveedor</TableHead>
                                    <TableHead className="w-[120px]">Invoice</TableHead>
                                    <TableHead className="w-[100px]">Envio #</TableHead>
                                    <TableHead className="w-[140px]">Estado</TableHead>
                                    <TableHead className="w-[120px] text-right">Ganancia</TableHead>
                                    <TableHead className="w-[50px]"></TableHead>
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
                                                <SelectTrigger className="h-8">
                                                    <SelectValue placeholder="Producto..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {products.map(p => (
                                                        <SelectItem key={p.id} value={p.id.toString()}>
                                                            {p.sku} - {p.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                        <TableCell>
                                            <Input
                                                type="number"
                                                min="1"
                                                className="h-8"
                                                value={item.quantity}
                                                onChange={e => updateItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Input
                                                type="number"
                                                step="0.01"
                                                className="h-8"
                                                value={item.price}
                                                onChange={e => updateItem(index, 'price', parseFloat(e.target.value) || 0)}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Input
                                                type="number"
                                                step="0.01"
                                                className="h-8 bg-slate-50 dark:bg-slate-900"
                                                value={item.cost}
                                                onChange={e => updateItem(index, 'cost', parseFloat(e.target.value) || 0)}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Select
                                                value={item.supplierId}
                                                onValueChange={(val) => updateItem(index, 'supplierId', val)}
                                            >
                                                <SelectTrigger className="h-8">
                                                    <SelectValue placeholder="Prov..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {suppliers.map(s => (
                                                        <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                        <TableCell>
                                            <Input
                                                className="h-8"
                                                value={item.purchase_invoice}
                                                onChange={e => updateItem(index, 'purchase_invoice', e.target.value)}
                                                placeholder="Nro Fact."
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Select
                                                value={item.shipment_number ? item.shipment_number.toString() : undefined}
                                                onValueChange={(val) => updateItem(index, 'shipment_number', val ? parseInt(val) : '')}
                                            >
                                                <SelectTrigger className="h-8">
                                                    <SelectValue placeholder="#" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {shipments.map(s => (
                                                        <SelectItem key={s.id} value={s.shipment_number.toString()}>
                                                            #{s.shipment_number} ({s.forwarder || 'N/A'})
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                        <TableCell>
                                            <Select value={item.status} onValueChange={(val) => updateItem(index, 'status', val)}>
                                                <SelectTrigger className="h-8">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="COMPRAR">COMPRAR</SelectItem>
                                                    <SelectItem value="ENCARGADO">ENCARGADO</SelectItem>
                                                    <SelectItem value="ENTREGADO">ENTREGADO</SelectItem>
                                                    <SelectItem value="LLEGANDO">LLEGANDO</SelectItem>
                                                    <SelectItem value="RESERVADO">RESERVADO</SelectItem>
                                                    <SelectItem value="SALIENDO">SALIENDO</SelectItem>
                                                    <SelectItem value="VENDIDO">VENDIDO</SelectItem>
                                                    <SelectItem value="CANCELADO">CANCELADO</SelectItem>
                                                    <SelectItem value="EN 🇦🇷">EN 🇦🇷</SelectItem>
                                                    <SelectItem value="2023">2023</SelectItem>
                                                    <SelectItem value="PARCIAL">PARCIAL</SelectItem>
                                                    <SelectItem value="CONCESION">CONCESION</SelectItem>
                                                    <SelectItem value="MIAMI">MIAMI</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((item.price - item.cost) * item.quantity)}
                                        </TableCell>
                                        <TableCell>
                                            <Button variant="ghost" size="icon" onClick={() => removeItem(index)} className="h-8 w-8">
                                                <Trash2 className="h-4 w-4 text-red-500" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>

                    <div className="p-4 flex justify-between items-center bg-muted/20">
                        <Button variant="outline" size="sm" onClick={addItem}>
                            <Plus className="mr-2 h-4 w-4" /> Agregar Item
                        </Button>
                        <div className="text-xl font-bold">
                            Total Venta: {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalAmount)}
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="flex justify-end space-x-4">
                <Button variant="outline" onClick={() => router.back()} disabled={isPending}>Cancelar</Button>
                <Button onClick={handleSubmit} disabled={isPending} className="bg-orange-600 hover:bg-orange-700">
                    {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Confirmar Venta
                </Button>
            </div>
        </div>
    );
}
