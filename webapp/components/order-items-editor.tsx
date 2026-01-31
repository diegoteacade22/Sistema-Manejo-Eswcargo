
'use client'

import { useState, useTransition } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pencil, Check, X, Loader2 } from 'lucide-react';
import { getProductColorClass } from '@/lib/utils';
import { updateOrderItem } from '@/app/orders/actions';
import { toast } from 'sonner';

interface OrderItem {
    id: number;
    productName: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
    product?: {
        color_grade?: string | null;
    } | null;
}

interface Props {
    items: OrderItem[];
    totalAmount: number;
    isAdmin: boolean;
}

export function OrderItemsEditor({ items, totalAmount, isAdmin }: Props) {
    const [editingItemId, setEditingItemId] = useState<number | null>(null);
    const [editValues, setEditValues] = useState<{ quantity: number; unit_price: number }>({ quantity: 0, unit_price: 0 });
    const [isPending, startTransition] = useTransition();

    const startEditing = (item: OrderItem) => {
        setEditingItemId(item.id);
        setEditValues({ quantity: item.quantity, unit_price: item.unit_price });
    };

    const cancelEditing = () => {
        setEditingItemId(null);
    };

    const saveEditing = async (itemId: number) => {
        startTransition(async () => {
            const result = await updateOrderItem(itemId, editValues);
            if (result.success) {
                toast.success('Item actualizado correctamente');
                setEditingItemId(null);
            } else {
                toast.error('Error al actualizar el item');
            }
        });
    };

    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Producto / Detalle</TableHead>
                    <TableHead className="text-center">Cant</TableHead>
                    <TableHead className="text-right">Precio Unit.</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                    {isAdmin && <TableHead className="w-[50px]"></TableHead>}
                </TableRow>
            </TableHeader>
            <TableBody>
                {items.map((item) => {
                    const isEditing = editingItemId === item.id;

                    return (
                        <TableRow key={item.id}>
                            <TableCell className="font-medium">
                                {item.productName}
                                {item.product?.color_grade && (
                                    <span className={`ml-2 text-sm ${getProductColorClass(item.product.color_grade)}`}>
                                        ({item.product.color_grade})
                                    </span>
                                )}
                            </TableCell>
                            <TableCell className="text-center">
                                {isEditing ? (
                                    <Input
                                        type="number"
                                        className="w-20 mx-auto text-center h-8"
                                        value={editValues.quantity}
                                        onChange={(e) => setEditValues({ ...editValues, quantity: parseInt(e.target.value) || 0 })}
                                    />
                                ) : (
                                    item.quantity
                                )}
                            </TableCell>
                            <TableCell className="text-right">
                                {isEditing ? (
                                    <Input
                                        type="number"
                                        className="w-24 ml-auto text-right h-8"
                                        value={editValues.unit_price}
                                        onChange={(e) => setEditValues({ ...editValues, unit_price: parseFloat(e.target.value) || 0 })}
                                    />
                                ) : (
                                    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.unit_price)
                                )}
                            </TableCell>
                            <TableCell className="text-right font-bold">
                                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.subtotal)}
                            </TableCell>
                            {isAdmin && (
                                <TableCell>
                                    {isEditing ? (
                                        <div className="flex space-x-1">
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => saveEditing(item.id)} disabled={isPending}>
                                                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                            </Button>
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600" onClick={cancelEditing} disabled={isPending}>
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ) : (
                                        <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => startEditing(item)}>
                                            <Pencil className="h-3 w-3" />
                                        </Button>
                                    )}
                                </TableCell>
                            )}
                        </TableRow>
                    );
                })}
                {/* Totals Row */}
                <TableRow className="bg-slate-50 dark:bg-slate-900/50">
                    <TableCell colSpan={3} className="text-right font-black text-lg">TOTAL PAGADO / A PAGAR</TableCell>
                    <TableCell className="text-right font-black text-xl text-indigo-600 dark:text-indigo-400">
                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalAmount)}
                    </TableCell>
                    {isAdmin && <TableCell></TableCell>}
                </TableRow>
            </TableBody>
        </Table>
    );
}
