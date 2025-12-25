'use client';

import { useState, useTransition, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createSupplier, updateSupplier } from '@/app/actions';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit2, Loader2 } from 'lucide-react';

const PHONE_COUNTRY_MAP: Record<string, string> = {
    '54': 'Argentina',
    '1': 'United States',
    '86': 'China', // Priority for suppliers
    '598': 'Uruguay', '56': 'Chile', '55': 'Brazil',
    '595': 'Paraguay', '591': 'Bolivia', '51': 'Peru',
    '57': 'Colombia', '52': 'Mexico', '34': 'Spain'
};

const COUNTRY_LIST = [
    "Argentina", "United States", "China", "Uruguay", "Chile", "Brazil",
    "Paraguay", "Bolivia", "Peru", "Colombia", "Mexico",
    "Spain", "Venezuela", "Ecuador", "Canada",
    "United Kingdom", "France", "Germany", "Italy"
].sort();

const ARG_PROVINCES = [
    "CABA", "Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes",
    "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones",
    "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe",
    "Santiago del Estero", "Tierra del Fuego", "Tucumán"
].sort();

interface EditSupplierDialogProps {
    supplier?: {
        id: number;
        name: string;
        contact?: string | null;
        email?: string | null;
        phone?: string | null;
        address?: string | null;
        city?: string | null;
        state?: string | null;
        country?: string | null;
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
    const [city, setCity] = useState('');
    const [state, setState] = useState('');
    const [country, setCountry] = useState('');
    const [notes, setNotes] = useState('');

    // Control for custom state input
    const [showCustomState, setShowCustomState] = useState(false);

    useEffect(() => {
        if (open && supplier && mode === 'edit') {
            setName(supplier.name);
            setContact(supplier.contact || '');
            setEmail(supplier.email || '');
            setPhone(supplier.phone || '');
            setAddress(supplier.address || '');
            setCity(supplier.city || '');
            setState(supplier.state || '');
            setCountry(supplier.country || '');
            setNotes(supplier.notes || '');

            const isArg = supplier.country === 'Argentina';
            const isInList = ARG_PROVINCES.includes(supplier.state || '');
            setShowCustomState(!isArg || (isArg && !isInList && !!supplier.state));

        } else if (open && mode === 'create') {
            setName('');
            setContact('');
            setEmail('');
            setPhone('');
            setAddress('');
            setCity('');
            setState('');
            setCountry('');
            setNotes('');
            setShowCustomState(false);
        }
    }, [open, supplier, mode]);

    // Auto-detect country from phone
    useEffect(() => {
        if (!phone) return;
        const digits = phone.replace(/\D/g, '');
        for (const [code, countryName] of Object.entries(PHONE_COUNTRY_MAP)) {
            if (digits.startsWith(code)) {
                setCountry(countryName);
                break;
            }
        }
    }, [phone]);

    // Auto-handle State input mode based on Country
    useEffect(() => {
        if (country === 'Argentina') {
            if (!ARG_PROVINCES.includes(state) && state !== '') {
                setShowCustomState(true);
            } else {
                setShowCustomState(false);
            }
        } else if (country && country !== 'Argentina') {
            setShowCustomState(true);
        }
    }, [country]);

    const handleSave = () => {
        if (!name) return alert('El nombre es obligatorio');

        startTransition(async () => {
            let result;
            const data = { name, contact, email, phone, address, city, state, country, notes };

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
                            <Input id="phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+54 9 11..." />
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
                    <div className="grid grid-cols-3 gap-2">
                        <div className="grid gap-2">
                            <Label htmlFor="city">Ciudad</Label>
                            <Input id="city" value={city} onChange={e => setCity(e.target.value)} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="state">Provincia / Edo</Label>
                            {showCustomState ? (
                                <Input
                                    id="state"
                                    value={state}
                                    onChange={e => setState(e.target.value)}
                                    placeholder={country === 'Argentina' ? 'Otra provincia...' : 'Estado/Provincia'}
                                />
                            ) : (
                                <Select
                                    value={ARG_PROVINCES.includes(state) ? state : ''}
                                    onValueChange={(val) => {
                                        if (val === 'OTHER') {
                                            setShowCustomState(true);
                                            setState('');
                                        } else {
                                            setState(val);
                                        }
                                    }}
                                >
                                    <SelectTrigger id="state">
                                        <SelectValue placeholder="Seleccionar..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {ARG_PROVINCES.map(p => (
                                            <SelectItem key={p} value={p}>{p}</SelectItem>
                                        ))}
                                        <SelectItem value="OTHER">Otro...</SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="country">País</Label>
                            <Select value={country} onValueChange={setCountry}>
                                <SelectTrigger id="country">
                                    <SelectValue placeholder="País" />
                                </SelectTrigger>
                                <SelectContent>
                                    {COUNTRY_LIST.map(c => (
                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                    ))}
                                    <SelectItem value="Other">Otro</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
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
