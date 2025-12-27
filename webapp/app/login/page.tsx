
'use client';

import { useState } from 'react';
import { authenticate } from '@/app/auth-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Package, Lock, User, Loader2, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useFormStatus } from 'react-dom';

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold py-6 rounded-xl shadow-lg transition-all transform hover:scale-[1.02]" disabled={pending}>
            {pending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : "Iniciar Sesión"}
        </Button>
    );
}

export default function LoginPage() {
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(formData: FormData) {
        setError(null);
        const result = await authenticate(undefined, formData);
        if (result) {
            setError(result);
        } else {
            // Force hard redirect to clear client-side cache and show correct sidebar
            window.location.href = '/';
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#0a0a0c] relative overflow-hidden p-4">
            {/* Background Glows */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-500/10 blur-[120px] rounded-full"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 blur-[120px] rounded-full"></div>

            <div className="w-full max-w-[450px] relative z-10">
                <div className="flex flex-col items-center mb-8">
                    <div className="bg-gradient-to-tr from-indigo-500 to-purple-600 p-4 rounded-2xl shadow-xl mb-4 rotate-3">
                        <Package className="h-10 w-10 text-white stroke-[2.5]" />
                    </div>
                    <h1 className="text-4xl font-black text-white tracking-tighter">ImportSys</h1>
                    <p className="text-slate-400 font-medium">Panel de Gestión & Logística</p>
                </div>

                <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl shadow-2xl border-[1.5px]">
                    <CardHeader className="space-y-1 pt-8">
                        <CardTitle className="text-2xl font-bold text-center text-white">Bienvenido</CardTitle>
                        <CardDescription className="text-center text-slate-400">
                            Ingrese sus credenciales para continuar
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <form action={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-xs font-black uppercase tracking-widest text-slate-500 ml-1">Usuario / Nro Cliente</label>
                                <div className="relative">
                                    <User className="absolute left-3 top-3 h-5 w-5 text-slate-500" />
                                    <Input
                                        name="username"
                                        placeholder="Eje: 162 o admin"
                                        required
                                        className="bg-slate-950 border-slate-800 text-white pl-10 h-12 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-black uppercase tracking-widest text-slate-500 ml-1">Contraseña</label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-3 h-5 w-5 text-slate-500" />
                                    <Input
                                        name="password"
                                        type="password"
                                        placeholder="••••••••"
                                        required
                                        className="bg-slate-950 border-slate-800 text-white pl-10 h-12 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                                    />
                                </div>
                            </div>

                            {error && (
                                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-bold text-center">
                                    {error}
                                </div>
                            )}

                            <div className="pt-2">
                                <SubmitButton />
                            </div>
                        </form>
                    </CardContent>
                    <CardFooter className="flex flex-col gap-4 pb-8">
                        <div className="relative w-full">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t border-slate-800"></span>
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-[#0a0a0c] px-2 text-slate-500 font-bold">¿Eres nuevo?</span>
                            </div>
                        </div>
                        <Link href="/setup-account" className="w-full">
                            <Button variant="outline" className="w-full border-slate-800 hover:bg-slate-800 text-slate-300 rounded-xl h-12 font-bold group">
                                Activar mi cuenta de cliente
                                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                            </Button>
                        </Link>
                    </CardFooter>
                </Card>

                <p className="text-center text-slate-600 text-xs mt-8 font-medium">
                    &copy; 2025 ESWCARGO. Todos los derechos reservados.
                </p>
            </div>
        </div>
    );
}
