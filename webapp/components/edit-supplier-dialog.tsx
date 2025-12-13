'use client';

import { useState, useTransition, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createSupplier, updateSupplier } from '@/app/actions';
import { Loader2, Plus, Edit2 } from 'lucide-react';

interface EditSupplierDialogProps {
    supplier?: {
        id: number;
        name: string;
        contact?: string | null;
        email?: string | null;
        phone?: string | null;
        address?: string | null;
        notes?: string | null;
    };
    mode: 'create' | 'edit';
    trigger?: React.ReactNode;
}

export function EditSupplierDialog({ supplier, mode, trigger }: EditSupplierDialogProps) {
    const [open, setOpen] = useState(false);
    const [isPending, startTransition] = useTransition();

    // Form State
    const [name, setName] = useState('');
    const [contact, setContact] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [address, setAddress] = useState('');
    const [notes, setNotes] = useState('');

    useEffect(() => {
        if (open && supplier && mode === 'edit') {
            setName(supplier.name);
            setContact(supplier.contact || '');
            setEmail(supplier.email || '');
            setPhone(supplier.phone || '');
            setAddress(supplier.address || '');
            setNotes(supplier.notes || '');
        } else if (open && mode === 'create') {
            setName('');
            setContact('');
            setEmail('');
            setPhone('');
            setAddress('');
            setNotes('');
        }
    }, [open, supplier, mode]);

    const handleSave = () => {
        if (!name) return alert('El nombre es obligatorio');

        startTransition(async () => {
            let result;
            const data = { name, contact, email, phone, address, notes };

            if (mode === 'create') {
                result = await createSupplier(data);
            } else if (mode === 'edit' && supplier) {
                result = await updateSupplier(supplier.id, data);
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
                        {mode === 'create' ? <><Plus className="mr-2 h-4 w-4" /> Nuevo Proveedor</> : <Edit2 className="h-4 w-4" />}
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{mode === 'create' ? 'Nuevo Proveedor' : 'Editar Proveedor'}</DialogTitle>
                    <DialogDescription>
                        {mode === 'create' ? 'Ingrese los datos del nuevo proveedor.' : 'Modifique los datos del proveedor.'}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name">Nombre / Razón Social *</Label>
                        <Input id="name" value={name} onChange={e => setName(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="contact">Contacto</Label>
                            <Input id="contact" value={contact} onChange={e => setContact(e.target.value)} placeholder="Ej: Juan Perez" />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="phone">Teléfono</Label>
                            <Input id="phone" value={phone} onChange={e => setPhone(e.target.value)} />
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" value={email} onChange={e => setEmail(e.target.value)} type="email" />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="address">Dirección</Label>
                        <Input id="address" value={address} onChange={e => setAddress(e.target.value)} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="notes">Notas</Label>
                        <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                        Cancelar
                    </Button>
                    <Button onClick={handleSave} disabled={isPending} className="bg-orange-600 hover:bg-orange-700 text-white">
                        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Guardar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
