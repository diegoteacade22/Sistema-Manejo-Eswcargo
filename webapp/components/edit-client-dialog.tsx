'use client';

import { useState, useTransition, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient, updateClient } from '@/app/actions';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit2, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';


const PHONE_COUNTRY_MAP: Record<string, string> = {
    '54': 'Argentina',
    '1': 'United States',
    '598': 'Uruguay',
    '56': 'Chile',
    '55': 'Brazil',
    '595': 'Paraguay',
    '591': 'Bolivia',
    '51': 'Peru',
    '57': 'Colombia',
    '52': 'Mexico',
    '34': 'Spain',
    '86': 'China'
};

const COUNTRY_LIST = [
    "Argentina", "United States", "Uruguay", "Chile", "Brazil",
    "Paraguay", "Bolivia", "Peru", "Colombia", "Mexico",
    "Spain", "China", "Venezuela", "Ecuador", "Canada",
    "United Kingdom", "France", "Germany", "Italy"
].sort();

const ARG_PROVINCES = [
    "CABA", "Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes",
    "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones",
    "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe",
    "Santiago del Estero", "Tierra del Fuego", "Tucumán"
].sort();

interface EditClientDialogProps {
    client?: {
        id: number;
        name: string;
        document_id?: string | null;
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

export function EditClientDialog({ client, mode, trigger }: EditClientDialogProps) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [isPending, startTransition] = useTransition();

    // Form State
    const [name, setName] = useState('');
    const [documentId, setDocumentId] = useState('');
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
        if (open && client && mode === 'edit') {
            setName(client.name);
            setDocumentId(client.document_id || '');
            setEmail(client.email || '');
            setPhone(client.phone || '');
            setAddress(client.address || '');
            setCity(client.city || '');
            setState(client.state || '');
            setCountry(client.country || '');
            setNotes(client.notes || '');

            // If editing and state is not in list but country is Argentina, show custom.
            // Or if country is not Argentina, show custom.
            const isArg = client.country === 'Argentina';
            const isInList = ARG_PROVINCES.includes(client.state || '');
            setShowCustomState(!isArg || (isArg && !isInList && !!client.state));

        } else if (open && mode === 'create') {
            setName('');
            setDocumentId('');
            setEmail('');
            setPhone('');
            setAddress('');
            setCity('');
            setState('');
            setCountry('');
            setNotes('');
            setShowCustomState(false);
        }
    }, [open, client, mode]);

    // Auto-detect country from phone
    useEffect(() => {
        if (!phone) return;
        // Clean phone to just digits
        const digits = phone.replace(/\D/g, '');

        // Find matching prefix
        for (const [code, countryName] of Object.entries(PHONE_COUNTRY_MAP)) {
            if (digits.startsWith(code)) {
                // Only auto-set if it matches a known one. 
                // We should check if the current country is already set to something else? 
                // User said "asignale", so we force update.
                setCountry(countryName);
                break;
            }
        }
    }, [phone]);

    // Auto-handle State input mode based on Country
    useEffect(() => {
        if (country === 'Argentina') {
            // Check if current state is valid province
            if (!ARG_PROVINCES.includes(state) && state !== '') {
                // If we have a state that isn't a province, keep custom mode
                setShowCustomState(true);
            } else {
                // Otherwise default to dropdown
                setShowCustomState(false);
            }
        } else if (country && country !== 'Argentina') {
            // Non-Argentina countries default to text input
            setShowCustomState(true);
        }
    }, [country]);

    const handleSave = () => {
        if (!name) return alert('El nombre es obligatorio');

        startTransition(async () => {
            let result;
            const data = { name, document_id: documentId, email, phone, address, city, state, country, notes };

            if (mode === 'create') {
                result = await createClient(data);
            } else if (mode === 'edit' && client) {
                result = await updateClient(client.id, data);
            }

            if (result?.success) {
                setOpen(false);
                router.refresh(); // Refresh to get updated data
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
                        {mode === 'create' ? <><Plus className="mr-2 h-4 w-4" /> Nuevo Cliente</> : <Edit2 className="h-4 w-4" />}
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700/50 shadow-2xl backdrop-blur-xl">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">
                        {mode === 'create' ? 'Nuevo Cliente' : 'Editar Cliente'}
                    </DialogTitle>
                    <DialogDescription className="text-slate-400">
                        {mode === 'create' ? 'Ingrese los datos del nuevo cliente.' : 'Modifique los datos del cliente.'}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name" className="text-slate-200 font-semibold">Nombre Completo *</Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="bg-slate-800/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-violet-500 focus:ring-violet-500/20"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="documentId" className="text-slate-200 font-semibold">DNI / CUIT</Label>
                            <Input
                                id="documentId"
                                value={documentId}
                                onChange={e => setDocumentId(e.target.value)}
                                className="bg-slate-800/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-violet-500 focus:ring-violet-500/20"
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="phone" className="text-slate-200 font-semibold">Teléfono</Label>
                            <Input
                                id="phone"
                                value={phone}
                                onChange={e => setPhone(e.target.value)}
                                placeholder="+54 9 11..."
                                className="bg-slate-800/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-violet-500 focus:ring-violet-500/20"
                            />
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="email" className="text-slate-200 font-semibold">Email</Label>
                        <Input
                            id="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            type="email"
                            className="bg-slate-800/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-violet-500 focus:ring-violet-500/20"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="address" className="text-slate-200 font-semibold">Dirección</Label>
                        <Input
                            id="address"
                            value={address}
                            onChange={e => setAddress(e.target.value)}
                            className="bg-slate-800/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-violet-500 focus:ring-violet-500/20"
                        />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <div className="grid gap-2">
                            <Label htmlFor="city" className="text-slate-200 font-semibold">Ciudad</Label>
                            <Input
                                id="city"
                                value={city}
                                onChange={e => setCity(e.target.value)}
                                className="bg-slate-800/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-violet-500 focus:ring-violet-500/20"
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="state" className="text-slate-200 font-semibold">Provincia / Edo</Label>
                            {showCustomState ? (
                                <Input
                                    id="state"
                                    value={state}
                                    onChange={e => setState(e.target.value)}
                                    placeholder={country === 'Argentina' ? 'Otra provincia...' : 'Estado/Provincia'}
                                    className="bg-slate-800/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-violet-500 focus:ring-violet-500/20"
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
                                    <SelectTrigger id="state" className="bg-slate-800/50 border-slate-600 text-white">
                                        <SelectValue placeholder="Seleccionar..." />
                                    </SelectTrigger>
                                    <SelectContent className="bg-slate-800 border-slate-700 text-white">
                                        {ARG_PROVINCES.map(p => (
                                            <SelectItem key={p} value={p} className="text-white hover:bg-slate-700">{p}</SelectItem>
                                        ))}
                                        <SelectItem value="OTHER" className="text-white hover:bg-slate-700">Otro...</SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="country" className="text-slate-200 font-semibold">País</Label>
                            <Select value={country} onValueChange={setCountry}>
                                <SelectTrigger id="country" className="bg-slate-800/50 border-slate-600 text-white">
                                    <SelectValue placeholder="País" />
                                </SelectTrigger>
                                <SelectContent className="bg-slate-800 border-slate-700 text-white">
                                    {COUNTRY_LIST.map(c => (
                                        <SelectItem key={c} value={c} className="text-white hover:bg-slate-700">{c}</SelectItem>
                                    ))}
                                    <SelectItem value="Other" className="text-white hover:bg-slate-700">Otro</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="notes" className="text-slate-200 font-semibold">Notas</Label>
                        <Textarea
                            id="notes"
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            className="bg-slate-800/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-violet-500 focus:ring-violet-500/20 min-h-[80px]"
                        />
                    </div>
                </div>
                <DialogFooter className="gap-2">
                    <Button
                        variant="outline"
                        onClick={() => setOpen(false)}
                        disabled={isPending}
                        className="bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white"
                    >
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={isPending}
                        className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-900/50"
                    >
                        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Guardar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
