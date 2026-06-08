'use client';

import { useState } from 'react';
import { setupClientAccount, getClientByOldId } from '@/app/auth-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Package, Lock, User, Mail, Globe, MapPin, Instagram, Phone, Store, Loader2, ArrowLeft, CheckCircle2, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export default function SetupAccountPage() {
    const [isPending, setIsPending] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    // Form States for Pre-filling
    const [formData, setFormData] = useState({
        clientNumber: '',
        password: '',
        storeName: '',
        instagram: '',
        phone: '',
        email: '',
        city: '',
        state: ''
    });

    const router = useRouter();

    async function handleClientBlur() {
        const id = parseInt(formData.clientNumber);
        if (isNaN(id)) return;

        setIsSearching(true);
        try {
            const res = await getClientByOldId(id);
            if (res.success && res.data) {
                const client = res.data;
                setFormData(prev => ({
                    ...prev,
                    storeName: client.name || '',
                    email: client.email || '',
                    phone: client.phone || '',
                    city: client.city || '',
                    state: client.state || '',
                    instagram: client.instagram || ''
                }));
                toast.success('¡Cliente encontrado! Hemos pre-completado tus datos.');
            } else if (res.success && !res.data) {
                toast.error('Nro de cliente no encontrado.');
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsSearching(false);
        }
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setIsPending(true);
        setError(null);

        const rawFormData = new FormData(e.currentTarget);
        const result = await setupClientAccount(rawFormData);

        setIsPending(false);
        if (result.success) {
            setSuccess(true);
        } else {
            setError(result.error || 'Ocurrió un error.');
            toast.error(result.error || 'Error al activar la cuenta');
        }
    }

    if (success) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#0a0a0c] p-4 text-white">
                <Card className="bg-slate-900 border-emerald-500/30 w-full max-w-[500px] text-center p-8 shadow-2xl">
                    <div className="flex justify-center mb-6">
                        <div className="bg-emerald-500/20 p-4 rounded-full animate-bounce">
                            <CheckCircle2 className="h-16 w-16 text-emerald-500" />
                        </div>
                    </div>
                    <h2 className="text-3xl font-black mb-2 text-white">¡Bienvenido a bordo!</h2>
                    <p className="text-slate-400 mb-8">Tu cuenta ha sido activada correctamente. Ahora puedes acceder a tu panel de control.</p>
                    <Link href="/login" className="w-full">
                        <Button className="w-full bg-emerald-600 hover:bg-emerald-700 h-12 rounded-xl font-bold shadow-lg shadow-emerald-900/20">
                            Iniciar Sesión Ahora
                        </Button>
                    </Link>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen py-10 px-4 bg-[#0a0a0c] relative overflow-hidden flex items-center justify-center font-sans tracking-tight">
            {/* Background Effects */}
            <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-500/20 blur-[150px] rounded-full animate-pulse"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-500/10 blur-[150px] rounded-full"></div>

            <Card className="w-full max-w-[650px] bg-slate-950/40 border-slate-800 backdrop-blur-2xl shadow-2xl relative z-10 border-[1.5px] rounded-2xl overflow-hidden">
                <CardHeader className="space-y-4 p-8 bg-gradient-to-b from-slate-900/50 to-transparent">
                    <div className="flex justify-between items-center">
                        <Link href="/login">
                            <Button variant="ghost" size="sm" className="text-slate-500 hover:text-white group">
                                <ArrowLeft className="mr-2 h-4 w-4 transition-transform group-hover:-translate-x-1" />
                                Regresar
                            </Button>
                        </Link>
                        <div className="h-12 w-12 bg-indigo-500/10 rounded-xl flex items-center justify-center border border-indigo-500/20 shadow-inner">
                            <Package className="h-6 w-6 text-indigo-500" />
                        </div>
                    </div>
                    <div>
                        <CardTitle className="text-4xl font-black text-white tracking-tighter">Activar Mi Cuenta</CardTitle>
                        <CardDescription className="text-slate-500 text-lg mt-1 font-medium italic">
                            Sincroniza tu número de cliente para comenzar.
                        </CardDescription>
                    </div>
                </CardHeader>

                <CardContent className="p-8 pt-0">
                    <form onSubmit={handleSubmit} className="space-y-8">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                            {/* Account Security */}
                            <div className="space-y-4 md:col-span-2">
                                <h3 className="text-indigo-400 text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2">
                                    <span className="h-1 w-8 bg-indigo-500 rounded-full"></span>
                                    Seguridad de la Cuenta
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">ID CLIENTE</label>
                                        <div className="relative group">
                                            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                                                {isSearching ? <Loader2 className="h-4 w-4 text-indigo-500 animate-spin" /> : <Search className="h-4 w-4 text-slate-500 group-focus-within:text-indigo-500 transition-colors" />}
                                            </div>
                                            <Input
                                                name="clientNumber"
                                                value={formData.clientNumber}
                                                onChange={handleChange}
                                                onBlur={handleClientBlur}
                                                placeholder="Ej: 162"
                                                required
                                                className="bg-slate-900/50 border-slate-800 focus:border-indigo-500/50 text-white pl-10 h-12 rounded-xl transition-all font-mono"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">CONTRASEÑA</label>
                                        <div className="relative group">
                                            <Lock className="absolute left-3 top-4 h-4 w-4 text-slate-500 group-focus-within:text-indigo-500 transition-colors" />
                                            <Input
                                                name="password"
                                                type="password"
                                                value={formData.password}
                                                onChange={handleChange}
                                                placeholder="••••••••"
                                                required
                                                className="bg-slate-900/50 border-slate-800 focus:border-indigo-500/50 text-white pl-10 h-12 rounded-xl transition-all"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Store Details */}
                            <div className="space-y-4 md:col-span-2">
                                <h3 className="text-indigo-400 text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2">
                                    <span className="h-1 w-8 bg-indigo-500 rounded-full"></span>
                                    Datos del Negocio
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">NOMBRE DE TIENDA</label>
                                        <div className="relative group">
                                            <Store className="absolute left-3 top-4 h-4 w-4 text-slate-500" />
                                            <Input name="storeName" value={formData.storeName} onChange={handleChange} placeholder="Tu Negocio" required className="bg-slate-950/60 border-slate-800 text-white pl-10 h-12 rounded-xl" />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">INSTAGRAM / WEB</label>
                                        <div className="relative group">
                                            <Instagram className="absolute left-3 top-4 h-4 w-4 text-slate-500" />
                                            <Input name="instagram" value={formData.instagram} onChange={handleChange} placeholder="@tu_usuario" className="bg-slate-950/60 border-slate-800 text-white pl-10 h-12 rounded-xl" />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">WHATSAPP</label>
                                        <div className="relative group">
                                            <Phone className="absolute left-3 top-4 h-4 w-4 text-slate-500" />
                                            <Input name="phone" value={formData.phone} onChange={handleChange} placeholder="+54 9 11..." required className="bg-slate-950/60 border-slate-800 text-white pl-10 h-12 rounded-xl" />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">EMAIL DE ACCESO</label>
                                        <div className="relative group">
                                            <Mail className="absolute left-3 top-4 h-4 w-4 text-slate-500" />
                                            <Input name="email" value={formData.email} onChange={handleChange} type="email" placeholder="hola@tienda.com" required className="bg-slate-950/60 border-slate-800 text-white pl-10 h-12 rounded-xl" />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Location */}
                            <div className="space-y-4 md:col-span-2">
                                <h3 className="text-indigo-400 text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2">
                                    <span className="h-1 w-8 bg-indigo-500 rounded-full"></span>
                                    Ubicación Destino
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">CIUDAD</label>
                                        <Input name="city" value={formData.city} onChange={handleChange} placeholder="Ciudad" required className="bg-slate-950/60 border-slate-800 text-white h-12 rounded-xl" />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">PROVINCIA</label>
                                        <Input name="state" value={formData.state} onChange={handleChange} placeholder="Provincia" required className="bg-slate-950/60 border-slate-800 text-white h-12 rounded-xl" />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/20 text-red-500 text-xs font-bold text-center animate-shake">
                                {error}
                            </div>
                        )}

                        <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black h-16 rounded-2xl shadow-2xl shadow-indigo-900/40 transition-all transform hover:scale-[1.02] active:scale-[0.98] border-t border-white/10" disabled={isPending}>
                            {isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : (
                                <span className="flex items-center gap-2 uppercase tracking-widest">
                                    Activar mi Panel <ArrowLeft className="h-4 w-4 rotate-180" />
                                </span>
                            )}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
