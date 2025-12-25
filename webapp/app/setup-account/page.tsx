
'use client';

import { useState } from 'react';
import { setupClientAccount } from '@/app/auth-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Package, Lock, User, Mail, Globe, MapPin, Instagram, Phone, Store, Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function SetupAccountPage() {
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const router = useRouter();

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setIsPending(true);
        setError(null);

        const formData = new FormData(e.currentTarget);
        const result = await setupClientAccount(formData);

        setIsPending(false);
        if (result.success) {
            setSuccess(true);
        } else {
            setError(result.error || 'Ocurrió un error.');
        }
    }

    if (success) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#0a0a0c] p-4 text-white">
                <Card className="bg-slate-900 border-slate-800 w-full max-w-[500px] text-center p-8 shadow-2xl">
                    <div className="flex justify-center mb-6">
                        <div className="bg-emerald-500/20 p-4 rounded-full">
                            <CheckCircle2 className="h-16 w-16 text-emerald-500" />
                        </div>
                    </div>
                    <h2 className="text-3xl font-black mb-2">¡Cuenta Activada!</h2>
                    <p className="text-slate-400 mb-8">Ahora puedes iniciar sesión con tu número de cliente y la contraseña que elegiste.</p>
                    <Link href="/login" className="w-full">
                        <Button className="w-full bg-indigo-600 hover:bg-indigo-700 h-12 rounded-xl font-bold">
                            Ir al Login
                        </Button>
                    </Link>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen py-10 px-4 bg-[#0a0a0c] relative overflow-hidden flex items-center justify-center">
            {/* Background Glows */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-500/10 blur-[120px] rounded-full"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 blur-[120px] rounded-full"></div>

            <Card className="w-full max-w-[650px] bg-slate-900/50 border-slate-800 backdrop-blur-xl shadow-2xl relative z-10 border-[1.5px]">
                <CardHeader className="space-y-1">
                    <div className="flex justify-between items-center mb-4">
                        <Link href="/login">
                            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white group">
                                <ArrowLeft className="mr-2 h-4 w-4 transition-transform group-hover:-translate-x-1" />
                                Volver al Login
                            </Button>
                        </Link>
                        <Package className="h-8 w-8 text-indigo-500" />
                    </div>
                    <CardTitle className="text-3xl font-black text-white">Activar Mi Cuenta</CardTitle>
                    <CardDescription className="text-slate-400">
                        Completa tus datos para empezar a gestionar tus importaciones
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Account Security */}
                            <div className="space-y-4 md:col-span-2">
                                <h3 className="text-indigo-400 text-sm font-black uppercase tracking-widest border-b border-slate-800 pb-2">Seguridad de la Cuenta</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-500 uppercase">Nro de Cliente (ID)</label>
                                        <div className="relative">
                                            <User className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                                            <Input name="clientNumber" placeholder="Ej: 162" required className="bg-slate-950 border-slate-800 text-white pl-10 rounded-xl" />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-500 uppercase">Elige una Contraseña</label>
                                        <div className="relative">
                                            <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                                            <Input name="password" type="password" placeholder="••••••••" required className="bg-slate-950 border-slate-800 text-white pl-10 rounded-xl" />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Store Details */}
                            <div className="space-y-4 md:col-span-2">
                                <h3 className="text-indigo-400 text-sm font-black uppercase tracking-widest border-b border-slate-800 pb-2">Datos del Negocio / Tienda</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-500 uppercase">Nombre de la Tienda</label>
                                        <div className="relative">
                                            <Store className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                                            <Input name="storeName" placeholder="Tu Negocio" required className="bg-slate-950 border-slate-800 text-white pl-10 rounded-xl" />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-500 uppercase">Web o Instagram</label>
                                        <div className="relative">
                                            <Globe className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                                            <Input name="instagram" placeholder="@tu_usuario" className="bg-slate-950 border-slate-800 text-white pl-10 rounded-xl" />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-500 uppercase">WhatsApp</label>
                                        <div className="relative">
                                            <Phone className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                                            <Input name="phone" placeholder="+54 9 11..." required className="bg-slate-950 border-slate-800 text-white pl-10 rounded-xl" />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-500 uppercase">Email</label>
                                        <div className="relative">
                                            <Mail className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                                            <Input name="email" type="email" placeholder="hola@tienda.com" required className="bg-slate-950 border-slate-800 text-white pl-10 rounded-xl" />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Location */}
                            <div className="space-y-4 md:col-span-2">
                                <h3 className="text-indigo-400 text-sm font-black uppercase tracking-widest border-b border-slate-800 pb-2">Ubicación</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-500 uppercase">Ciudad</label>
                                        <div className="relative">
                                            <MapPin className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                                            <Input name="city" placeholder="Ciudad" required className="bg-slate-950 border-slate-800 text-white pl-10 rounded-xl" />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-500 uppercase">Provincia</label>
                                        <div className="relative">
                                            <MapPin className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                                            <Input name="state" placeholder="Provincia" required className="bg-slate-950 border-slate-800 text-white pl-10 rounded-xl" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm font-bold text-center italic">
                                {error}
                            </div>
                        )}

                        <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black h-14 rounded-xl shadow-xl transition-all transform hover:scale-[1.01]" disabled={isPending}>
                            {isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : "ACTIVAR MI CUENTA"}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
