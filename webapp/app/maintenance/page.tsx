'use client';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Server, Database, RefreshCw, HardDrive, AlertTriangle, CheckCircle2, FileSpreadsheet, Cloud, Users } from "lucide-react";
import { useState, useTransition } from 'react';
import { revalidateSystem, resetDatabase, syncExcel } from './actions';
import { DeleteEntityCard } from '@/components/delete-entity-card';

export default function MaintenancePage() {
    const [isPending, startTransition] = useTransition();
    const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);

    const handleRevalidate = () => {
        setMessage(null);
        startTransition(async () => {
            const res = await revalidateSystem();
            if (res.success) {
                setMessage({ text: res.message, type: 'success' });
            } else {
                setMessage({ text: 'Error al revalidar', type: 'error' });
            }
        });
    };

    const handleReset = () => {
        if (!confirm("ADVERTENCIA: Esto borrará TODOS los datos y reiniciará la base de datos con los datos de prueba (Seed). ¿Está seguro?")) {
            return;
        }
        setMessage(null);
        startTransition(async () => {
            const res = await resetDatabase();
            if (res.success) {
                setMessage({ text: res.message, type: 'success' });
            } else {
                setMessage({ text: res.message || 'Error al resetear', type: 'error' });
            }
        });
    };

    const handleSync = () => {
        setMessage(null);
        startTransition(async () => {
            const res = await syncExcel();
            if (res.success) {
                setMessage({ text: res.message, type: 'success' });
            } else {
                setMessage({ text: res.message, type: 'error' });
            }
        });
    };

    return (
        <div className="p-8 space-y-8">
            <div>
                <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                    Mantenimiento del Sistema
                </h2>
                <p className="text-muted-foreground mt-1">
                    Gestión, limpieza y aseguramiento de datos.
                </p>
            </div>

            {message && (
                <div className={`p-4 rounded-md border flex items-center gap-2 ${message.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-900/20 dark:border-emerald-900 dark:text-emerald-400' : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-900 dark:text-red-400'}`}>
                    {message.type === 'success' ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                    <p className="text-sm font-medium">{message.text}</p>
                </div>
            )}

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {/* System Status */}
                <Card className="dark:bg-slate-900 dark:border-slate-800">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Server className="h-5 w-5 text-blue-500" /> Estado del Servidor
                        </CardTitle>
                        <CardDescription>Información sobre el entorno de ejecución</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-muted-foreground">Estado TS Server:</span>
                            <span className="text-emerald-500 font-medium">Activo</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-muted-foreground">Base de Datos:</span>
                            <span className="text-emerald-500 font-medium">Conectada (SQLite)</span>
                        </div>
                        <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-md border border-yellow-200 dark:border-yellow-900">
                            <h4 className="flex items-center gap-2 text-sm font-semibold text-yellow-800 dark:text-yellow-500 mb-1">
                                <AlertTriangle className="h-4 w-4" /> Reinicio Requerido
                            </h4>
                            <p className="text-xs text-yellow-700 dark:text-yellow-400">
                                Si nota errores visuales o de tipos después de actualizar el esquema, reinicie el servidor de desarrollo manualmente.
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* Database Tools */}
                <Card className="dark:bg-slate-900 dark:border-slate-800">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Database className="h-5 w-5 text-fuchsia-500" /> Base de Datos
                        </CardTitle>
                        <CardDescription>Operaciones sobre los datos</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <Button
                            variant="outline"
                            className="w-full justify-start"
                            onClick={handleRevalidate}
                            disabled={isPending}
                        >
                            <RefreshCw className={`mr-2 h-4 w-4 ${isPending ? 'animate-spin' : ''}`} />
                            {isPending ? 'Procesando...' : 'Recargar Caché de Prisma'}
                        </Button>
                        <Button
                            variant="outline"
                            className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                            onClick={handleReset}
                            disabled={isPending}
                        >
                            <AlertTriangle className="mr-2 h-4 w-4" />
                            {isPending ? 'Reseteando...' : 'Resetear Base de Datos (Seed)'}
                        </Button>
                        <Button
                            variant="outline"
                            className="w-full justify-start text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950 border-emerald-200 dark:border-emerald-800"
                            onClick={handleSync}
                            disabled={isPending}
                        >
                            <Cloud className={`mr-2 h-4 w-4 ${isPending ? 'animate-bounce' : ''}`} />
                            {isPending ? 'Descargando desde Drive...' : 'Sincronizar con Google Sheets'}
                        </Button>
                    </CardContent>
                </Card>

                {/* User Management */}
                <Link href="/maintenance/users">
                    <Card className="dark:bg-slate-900 dark:border-slate-800 hover:border-indigo-500 transition-colors cursor-pointer h-full">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Users className="h-5 w-5 text-indigo-500" /> Usuarios
                            </CardTitle>
                            <CardDescription>Gestión de accesos y roles</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground mb-4">
                                Cree y administre usuarios. Vincule cuentas a clientes para acceso restringido.
                            </p>
                            <Button variant="secondary" className="w-full">
                                Gestionar Usuarios
                            </Button>
                        </CardContent>
                    </Card>
                </Link>

                {/* Backups */}
                <Card className="dark:bg-slate-900 dark:border-slate-800 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-3 bg-fuchsia-100 dark:bg-fuchsia-900 text-fuchsia-600 dark:text-fuchsia-300 text-xs font-bold rounded-bl-xl">
                        PRÓXIMAMENTE
                    </div>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <HardDrive className="h-5 w-5 text-emerald-500" /> Copias de Seguridad
                        </CardTitle>
                        <CardDescription>Gestión de Backups y Restauración</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground mb-4">
                            La funcionalidad de backups automáticos a la nube estará disponible en la próxima versión.
                        </p>
                        <Button disabled className="w-full">
                            Configurar Backup
                        </Button>
                    </CardContent>
                </Card>
                <DeleteEntityCard />
            </div>
        </div>
    );
}
