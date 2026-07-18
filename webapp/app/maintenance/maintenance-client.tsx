'use client';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Server, Database, RefreshCw, HardDrive, AlertTriangle, CheckCircle2, Cloud, Users, Rocket, History, ExternalLink } from "lucide-react";
import { useEffect, useState, useTransition } from 'react';
import { getGitHubSyncStatus, getSyncControlCenter, revalidateSystem, syncExcel, deployToProduction, applyProductionRefresh } from './actions';
import { DeleteEntityCard } from '@/components/delete-entity-card';

type SyncControlCenter = Awaited<ReturnType<typeof getSyncControlCenter>>;

function formatSyncDate(value: string | null) {
    if (!value) return 'Sin registros';
    return new Intl.DateTimeFormat('es-AR', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'America/Argentina/Buenos_Aires',
    }).format(new Date(value));
}

function syncResultLabel(status: string, conclusion: string | null) {
    if (status !== 'completed') return status === 'queued' ? 'En cola' : 'En curso';
    return conclusion === 'success' ? 'Validada' : conclusion || 'Sin resultado';
}

function formatDuration(seconds: number | null) {
    if (seconds === null) return 'Sin dato';
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function MaintenanceClient() {
    const [isPending, startTransition] = useTransition();
    const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);
    const [syncControl, setSyncControl] = useState<SyncControlCenter | null>(null);
    const [isLoadingSyncControl, setIsLoadingSyncControl] = useState(true);

    const loadSyncControl = async () => {
        setIsLoadingSyncControl(true);
        const result = await getSyncControlCenter();
        setSyncControl(result);
        setIsLoadingSyncControl(false);
    };

    useEffect(() => {
        void loadSyncControl();
    }, []);

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

    const handleSync = () => {
        setMessage({ text: 'Actualizando todos los datos de la planilla...', type: 'success' });
        startTransition(async () => {
            const res = await syncExcel(0);
            if (res.success) {
                setMessage({ text: res.message || 'Sincronización completa finalizada.', type: 'success' });
            } else {
                setMessage({ text: res.message, type: 'error' });
            }
        });
    };

    const handleCheckCloudSync = () => {
        setMessage(null);
        startTransition(async () => {
            const res = await getGitHubSyncStatus();
            setMessage({ text: res.message, type: res.success ? 'success' : 'error' });
            await loadSyncControl();
        });
    };

    const handleDeployProduction = () => {
        if (!confirm("¿Confirmas pasar a PRODUCCIÓN los cambios actuales de DEV?")) {
            return;
        }
        setMessage(null);
        startTransition(async () => {
            const res = await deployToProduction();
            if (res.success) {
                setMessage({ text: res.message, type: 'success' });
            } else {
                setMessage({ text: res.message, type: 'error' });
            }
        });
    };

    const handleApplyProductionRefresh = () => {
        if (!confirm("¿Confirmas ejecutar actualización + reinicio de producción desde mantenimiento?")) {
            return;
        }

        setMessage({ text: 'Actualización de producción en curso...', type: 'success' });
        startTransition(async () => {
            const res = await applyProductionRefresh();
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

            <section className="border-y border-slate-200 py-6 dark:border-slate-800">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h3 className="flex items-center gap-2 text-lg font-semibold"><History className="h-5 w-5 text-emerald-500" /> Control de sincronización</h3>
                        <p className="text-sm text-muted-foreground">Resultado real de las últimas actualizaciones cloud.</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => void loadSyncControl()} disabled={isLoadingSyncControl || isPending}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${isLoadingSyncControl ? 'animate-spin' : ''}`} />
                        Actualizar estado
                    </Button>
                </div>

                {isLoadingSyncControl ? (
                    <p className="text-sm text-muted-foreground">Consultando actualizaciones...</p>
                ) : !syncControl?.success ? (
                    <p className="text-sm text-red-600 dark:text-red-400">{syncControl?.message || 'No se pudo cargar el control.'}</p>
                ) : (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                            <span className="font-medium">Última validada: {formatSyncDate(syncControl.lastSuccessAt)}</span>
                            <span className={syncControl.exceptions.length ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>{syncControl.message}</span>
                        </div>

                        {syncControl.exceptions.length > 0 && (
                            <div className="space-y-2">
                                {syncControl.exceptions.map((exception, index) => (
                                    <div key={`${exception.title}-${index}`} className={`flex items-start justify-between gap-3 border-l-4 px-3 py-2 text-sm ${exception.level === 'error' ? 'border-red-500 bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300' : 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'}`}>
                                        <div><strong>{exception.title}</strong><p className="mt-1">{exception.detail}</p></div>
                                        {exception.url && <a href={exception.url} target="_blank" rel="noreferrer" aria-label={`Ver detalle de ${exception.title}`}><ExternalLink className="h-4 w-4" /></a>}
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="overflow-x-auto border border-slate-200 dark:border-slate-800">
                            <table className="w-full min-w-[560px] text-left text-sm">
                                <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                                    <tr><th className="px-3 py-2">Finalización</th><th className="px-3 py-2">Rango</th><th className="px-3 py-2">Resultado</th><th className="px-3 py-2">Duración</th><th className="px-3 py-2"></th></tr>
                                </thead>
                                <tbody>
                                    {syncControl.history.slice(0, 6).map((run) => (
                                        <tr key={run.id} className="border-t border-slate-100 dark:border-slate-800">
                                            <td className="px-3 py-2">{formatSyncDate(run.updatedAt)}</td>
                                            <td className="px-3 py-2">{run.scope}</td>
                                            <td className={`px-3 py-2 font-medium ${run.status === 'completed' && run.conclusion === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>{syncResultLabel(run.status, run.conclusion)}</td>
                                            <td className="px-3 py-2">{formatDuration(run.durationSeconds)}</td>
                                            <td className="px-3 py-2"><a className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100" href={run.url} target="_blank" rel="noreferrer">Detalle <ExternalLink className="h-3.5 w-3.5" /></a></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </section>

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
                            <span className="text-emerald-500 font-medium">Conectada</span>
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
                        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                            <p className="font-medium">Reinicio de base bloqueado</p>
                            <p className="mt-1 text-xs">Las recuperaciones se realizan con respaldo y control; nunca desde esta pantalla.</p>
                        </div>
                        <div className="pt-2 border-t dark:border-slate-800 space-y-3">
                            <h4 className="text-sm font-semibold flex items-center gap-2">
                                <RefreshCw className="h-4 w-4 text-emerald-500" /> Sincronizar con Excel (Drive)
                            </h4>
                            <p className="text-xs text-muted-foreground">Procesa toda la fuente operativa para incluir cambios en pedidos antiguos.</p>

                            <div className="grid grid-cols-1 gap-2">
                                <Button
                                    variant="outline"
                                    className="justify-start text-emerald-600 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-50"
                                    onClick={handleSync}
                                    disabled={isPending}
                                >
                                    <Cloud className={`mr-2 h-4 w-4 ${isPending ? 'animate-bounce' : ''}`} />
                                    ACTUALIZAR AHORA (Fuente completa)
                                </Button>
                                <Button
                                    variant="ghost"
                                    className="justify-start"
                                    onClick={handleCheckCloudSync}
                                    disabled={isPending}
                                >
                                    <CheckCircle2 className={`mr-2 h-4 w-4 ${isPending ? 'animate-spin' : ''}`} />
                                    Verificar última actualización cloud
                                </Button>
                            </div>
                        </div>
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

                <Card className="dark:bg-slate-900 dark:border-slate-800 border-emerald-300/50">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Rocket className="h-5 w-5 text-emerald-500" /> Release
                        </CardTitle>
                        <CardDescription>Publica en producción cuando lo decidas</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground mb-4">
                            Usa este botón para pasar a producción los cambios validados en dev.
                        </p>
                        <Button
                            onClick={handleDeployProduction}
                            disabled={isPending}
                            className="w-full bg-emerald-600 hover:bg-emerald-700"
                        >
                            <Rocket className="mr-2 h-4 w-4" />
                            {isPending ? 'Desplegando...' : 'Pasar a Producción'}
                        </Button>
                        <Button
                            onClick={handleApplyProductionRefresh}
                            disabled={isPending}
                            variant="outline"
                            className="w-full mt-2"
                        >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            {isPending ? 'Aplicando...' : 'Aplicar cambios (build + restart)'}
                        </Button>
                    </CardContent>
                </Card>
                <DeleteEntityCard />
            </div>
        </div>
    );
}
