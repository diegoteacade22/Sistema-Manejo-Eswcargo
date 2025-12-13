'use client';

import { useState, useTransition, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createProduct, updateProduct } from '@/app/actions';
import { Loader2, Plus, Edit2 } from 'lucide-react';

interface EditProductDialogProps {
    product?: {
        id: number;
        sku: string;
        name: string;
        description?: string | null;
        color_grade?: string | null;
        lp1?: number | null;
        stock: number;
    };
    mode: 'create' | 'edit';
    trigger?: React.ReactNode;
}

export function EditProductDialog({ product, mode, trigger }: EditProductDialogProps) {
    const [open, setOpen] = useState(false);
    const [isPending, startTransition] = useTransition();

    // Form State
    const [name, setName] = useState('');
    const [sku, setSku] = useState('');
    const [colorGrade, setColorGrade] = useState('');
    const [price, setPrice] = useState('');
    const [stock, setStock] = useState('');
    const [description, setDescription] = useState('');

    useEffect(() => {
        if (open && product && mode === 'edit') {
            setName(product.name);
            setSku(product.sku);
            setColorGrade(product.color_grade || '');
            setPrice(product.lp1?.toString() || '');
            setStock(product.stock.toString());
            setDescription(product.description || '');
        } else if (open && mode === 'create') {
            setName('');
            setSku('');
            setColorGrade('');
            setPrice('');
            setStock('0');
            setDescription('');
        }
    }, [open, product, mode]);

    const handleSave = () => {
        if (!name) return alert('El nombre es obligatorio');

        startTransition(async () => {
            let result;
            const data = {
                name,
                sku,
                description,
                color_grade: colorGrade,
                lp1: price ? parseFloat(price) : undefined,
                stock: stock ? parseInt(stock) : undefined
            };

            if (mode === 'create') {
                result = await createProduct(data);
            } else if (mode === 'edit' && product) {
                result = await updateProduct(product.id, data);
            }

            if (result?.success) {
                setOpen(false);
            } else {
                alert(result?.message || 'Error al guardar');
            }
        });
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button variant={mode === 'create' ? "default" : "outline"} size={mode === 'create' ? "default" : "icon"}>
                        {mode === 'create' ? <><Plus className="mr-2 h-4 w-4" /> Nuevo Artículo</> : <Edit2 className="h-4 w-4" />}
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>{mode === 'create' ? 'Nuevo Artículo' : 'Editar Artículo'}</DialogTitle>
                    <DialogDescription>
                        Ingrese los detalles del producto. SKU debe ser único.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-1 grid gap-2">
                            <Label htmlFor="sku">SKU</Label>
                            <Input id="sku" value={sku} onChange={e => setSku(e.target.value)} />
                        </div>
                        <div className="col-span-2 grid gap-2">
                            <Label htmlFor="name">Nombre / Modelo *</Label>
                            <Input id="name" value={name} onChange={e => setName(e.target.value)} />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="color">Color/Grade</Label>
                            <Input id="color" value={colorGrade} onChange={e => setColorGrade(e.target.value)} placeholder="Ej: Gold A+" />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="price">Precio Venta (USD)</Label>
                            <Input id="price" value={price} onChange={e => setPrice(e.target.value)} type="number" step="0.01" />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="stock">Stock</Label>
                            <Input id="stock" value={stock} onChange={e => setStock(e.target.value)} type="number" />
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="desc">Descripción</Label>
                        <Textarea id="desc" value={description} onChange={e => setDescription(e.target.value)} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                        Cancelar
                    </Button>
                    <Button onClick={handleSave} disabled={isPending} className="bg-cyan-600 hover:bg-cyan-700 text-white">
                        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Guardar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
