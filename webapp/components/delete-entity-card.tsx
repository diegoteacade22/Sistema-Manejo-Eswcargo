'use client';

import { useState, useTransition } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deleteEntity } from '@/app/actions';
import { Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function DeleteEntityCard() {
    const [type, setType] = useState<string>('client');
    const [id, setId] = useState<string>('');
    const [isPending, startTransition] = useTransition();
    const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);

    const handleDelete = () => {
        if (!id) return;
        if (!confirm(`¿Está seguro de que desea eliminar este registro (ID: ${id}) de tipo ${type}?`)) return;

        startTransition(async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const res = await deleteEntity(type as any, parseInt(id));
            if (res.success) {
                setMessage({ text: 'Eliminado correctamente.', type: 'success' });
                setId('');
            } else {
                setMessage({ text: res.message || 'Error al eliminar.', type: 'error' });
            }
        });
    };

    return (
        <Card className="dark:bg-slate-900 dark:border-slate-800 border-red-200">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-500">
                    <Trash2 className="h-5 w-5" /> Borrado Seguro
                </CardTitle>
                <CardDescription>Eliminar registros individualmente por ID</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid gap-2">
                    <Label>Tipo de Entidad</Label>
                    <Select value={type} onValueChange={setType}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="client">Cliente</SelectItem>
                            <SelectItem value="product">Producto/Artículo</SelectItem>
                            <SelectItem value="supplier">Proveedor</SelectItem>
                            <SelectItem value="order">Pedido</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="grid gap-2">
                    <Label>ID del Registro</Label>
                    <Input
                        placeholder="Ingrese el ID..."
                        value={id}
                        onChange={e => setId(e.target.value)}
                        type="number"
                    />
                    <p className="text-xs text-muted-foreground">Puede ver el ID en la URL de la ficha del detalle (ej: /clients/123)</p>
                </div>

                {message && (
                    <div className={`text-sm p-2 rounded ${message.type === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {message.text}
                    </div>
                )}

                <Button
                    variant="destructive"
                    className="w-full"
                    onClick={handleDelete}
                    disabled={isPending || !id}
                >
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <AlertTriangle className="mr-2 h-4 w-4" />}
                    Eliminar Registro
                </Button>
            </CardContent>
        </Card>
    );
}
