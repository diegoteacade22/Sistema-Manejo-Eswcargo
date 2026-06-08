'use client';

import { useState, useTransition, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { createClient, updateClient } from '@/app/actions';
import { generateClientCredentials } from '@/app/user-actions';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit2, Loader2, ShieldCheck, ShieldAlert, Key, Copy, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';


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
        canAccess?: boolean;
        userId?: string | null;
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
    const [canAccess, setCanAccess] = useState(true);

    // Generated Creds State
    const [generatedCreds, setGeneratedCreds] = useState<{ username: string, password: string } | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);

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
            setCanAccess(client.canAccess ?? true);
            setGeneratedCreds(null); // Reset on open

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
            setCanAccess(true);
            setShowCustomState(false);
            setGeneratedCreds(null);
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
            const data = { name, document_id: documentId, email, phone, address, city, state, country, notes, canAccess };

            if (mode === 'create') {
                result = await createClient(data);
            } else if (mode === 'edit' && client) {
                result = await updateClient(client.id, data);
            }

            if (result?.success) {
                setOpen(false);
                router.refresh(); // Refresh to get updated data
                toast.success('Cliente guardado correctamente');
            } else {
                toast.error(result?.message || 'Error al guardar');
            }
        });
    };

    const handleGenerateCredentials = async () => {
        if (!client || !client.id) return;
        if (!email) {
            toast.error("Debe ingresar un email para generar el usuario.");
            return;
        }

        setIsGenerating(true);
        try {
            // Ensure email is saved first if it changed
            if (email !== client.email) {
                await updateClient(client.id, {
                    name, document_id: documentId, email, phone, address, city, state, country, notes, canAccess
                });
            }

            const result = await generateClientCredentials(client.id);
            if (result.success && result.credentials) {
                setGeneratedCreds(result.credentials);
                toast.success("Credenciales generadas exitosamente");
                router.refresh();
            } else {
                toast.error(result.message || "Error generando credenciales");
            }
        } catch (error) {
            console.error(error);
            toast.error("Ocurrió un error inesperado");
        } finally {
            setIsGenerating(false);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success("Copiado al portapapeles");
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
            <DialogContent className="sm:max-w-[500px] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700/50 shadow-2xl backdrop-blur-xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">
                        {mode === 'create' ? 'Nuevo Cliente' : 'Editar Cliente'}
                    </DialogTitle>
                    <DialogDescription className="text-slate-400">
                        {mode === 'create' ? 'Ingrese los datos del nuevo cliente.' : 'Modifique los datos del cliente.'}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className={cn(
                        "flex flex-col gap-3 p-4 rounded-2xl border transition-all duration-300",
                        canAccess ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"
                    )}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className={cn(
                                    "p-2 rounded-xl",
                                    canAccess ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                                )}>
                                    {canAccess ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
                                </div>
                                <div>
                                    <p className={cn("text-sm font-bold leading-none", canAccess ? "text-emerald-400" : "text-red-400")}>Acceso al Portal</p>
                                    <p className="text-[10px] opacity-70 mt-1 text-slate-300 text-balance">
                                        {canAccess ? 'Permite el acceso. Usuario requerido.' : 'Acceso suspendido.'}
                                    </p>
                                </div>
                            </div>
                            <Switch
                                checked={canAccess}
                                onCheckedChange={setCanAccess}
                            />
                        </div>

                        {/* Credential Generation Section - ONLY in Edit Mode */}
                        {mode === 'edit' && canAccess && (
                            <div className="mt-2 text-sm">
                                {client?.userId ? (
                                    <div className="flex items-center gap-2 p-2 bg-emerald-500/20 rounded border border-emerald-500/30 text-emerald-300 text-xs font-mono">
                                        <Check className="h-3 w-3" /> Usuario Vinculado Activado
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {!generatedCreds ? (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="w-full border-dashed border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10"
                                                onClick={handleGenerateCredentials}
                                                disabled={isGenerating}
                                            >
                                                {isGenerating ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <Key className="h-3 w-3 mr-2" />}
                                                Generar Credenciales de Acceso
                                            </Button>
                                        ) : (
                                            <div className="p-3 bg-slate-950 rounded border border-indigo-500/50 space-y-2 animate-in fade-in zoom-in-95">
                                                <p className="text-xs text-indigo-300 font-bold mb-1">¡Credenciales Generadas!</p>
                                                <div className="flex justify-between items-center bg-slate-900 p-2 rounded">
                                                    <code className="text-xs text-slate-300">{generatedCreds.username}</code>
                                                    <Button variant="ghost" size="icon" className="h-5 w-5 ml-2" onClick={() => copyToClipboard(generatedCreds.username)}>
                                                        <Copy className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                                <div className="flex justify-between items-center bg-slate-900 p-2 rounded">
                                                    <code className="text-xs text-orange-400 font-bold">{generatedCreds.password}</code>
                                                    <Button variant="ghost" size="icon" className="h-5 w-5 ml-2" onClick={() => copyToClipboard(generatedCreds.password)}>
                                                        <Copy className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                                <p className="text-[10px] text-slate-500 text-center mt-1">Comparte estos datos con el cliente.</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="name" className="text-slate-200 font-semibold">Nombre Completo *</Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="bg-slate-800/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-violet-500 focus:ring-violet-500/20"
                        />
                    </div>
                    {/* ... rest of inputs ... */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            {/* ... */}
                        </div>
                    </div>
                    {/* Simplified for brevity in replace, but must keep all original structure */}
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
