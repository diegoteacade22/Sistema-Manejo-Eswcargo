'use client';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Server, Database, RefreshCw, HardDrive, AlertTriangle, CheckCircle2, Cloud, Users, Rocket, FileCheck2, Landmark } from "lucide-react";
import { useState, useTransition } from 'react';
import { getGitHubSyncStatus, revalidateSystem, syncExcel, syncInvoice, deployToProduction, applyProductionRefresh } from './actions';
import { DeleteEntityCard } from '@/components/delete-entity-card';

export function MaintenanceClient({ directSyncEnabled }: { directSyncEnabled: boolean }) {
    const [isPending, startTransition] = useTransition();
    const [message, setMessage] = useState<{ text: string, type: 'success' | 'warning' | 'error' } | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [reductionIssue, setReductionIssue] = useState<{
        orderNumber: number | null;
        reason: string;
        sourceItemCount?: number;
        existingItemCount?: number;
        canApproveReduction: boolean;
        approvalToken?: string;
    } | null>(null);

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

    const handleInvoiceSync = async (reductionApprovalToken?: string) => {
        if (isSyncing) return;
        const orderNumber = Number(invoiceNumber);
        setIsSyncing(true);
        setReductionIssue(null);
        setMessage({ text: `Verificando invoice #${invoiceNumber}...`, type: 'success' });
        try {
            const res = await syncInvoice(orderNumber, reductionApprovalToken);
            setMessage({
                text: res.message,
                type: res.success ? ('partial' in res && res.partial ? 'warning' : 'success') : 'error',
            });
            if ('issue' in res && res.issue) setReductionIssue(res.issue);
        } finally {
            setIsSyncing(false);
        }
    };

    const handleSync = async (days: 0 | 7 | 30) => {
        if (isSyncing) return;
        const syncScope = days === 0 ? 'completa' : `ultimos ${days} dias`;
        setIsSyncing(true);
        setMessage({ text: `Actualizacion ${syncScope} en curso...`, type: 'success' });
        try {
            const res = await syncExcel(days);
            if (!res.success) {
                setMessage({ text: res.message, type: 'error' });
                return;
            }

            const runId = 'runId' in res ? res.runId : null;
            const requestId = 'requestId' in res ? res.requestId : null;
            if (!runId && !requestId) {
                setMessage({
                    text: res.message || `Actualizacion ${syncScope} finalizada.`,
                    type: 'partial' in res && res.partial ? 'warning' : 'success',
                });
                return;
            }

            setMessage({ text: res.message, type: 'success' });
            let trackedRunId = runId;
            for (let attempt = 0; attempt < 240; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 2500));
                const status = await getGitHubSyncStatus(trackedRunId, requestId);
                if ('runId' in status && status.runId) trackedRunId = status.runId;
                setMessage({ text: status.message, type: status.success ? 'success' : 'error' });
                if ('completed' in status && status.completed) {
                    return;
                }
            }
            setMessage({ text: 'La actualización completa sigue activa en GitHub. Volvé a esta pantalla más tarde para iniciar una nueva consulta.', type: 'error' });
        } finally {
            setIsSyncing(false);
        }
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
                <div className={`p-4 rounded-md border flex items-center gap-2 ${message.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-900/20 dark:border-emerald-900 dark:text-emerald-400'
                    : message.type === 'warning'
                        ? 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-900 dark:text-amber-300'
                        : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-900 dark:text-red-400'}`}>
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
                            <p className="text-xs text-muted-foreground">La actualización operativa compara Google Sheets con Supabase y escribe solamente los cambios. La completa queda como reconciliación de respaldo.</p>

                            <div className="space-y-2 rounded-md border border-slate-700/60 p-3">
                                <label htmlFor="invoice-sync-number" className="text-xs font-medium">
                                    Invoice urgente (incluye históricos)
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        id="invoice-sync-number"
                                        inputMode="numeric"
                                        value={invoiceNumber}
                                        onChange={(event) => setInvoiceNumber(event.target.value.replace(/\D/g, ''))}
                                        placeholder="Ej. 2593"
                                        className="min-w-0 flex-1 rounded-md border border-slate-700 bg-transparent px-3 py-2 text-sm"
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => handleInvoiceSync()}
                                        disabled={isPending || isSyncing || !invoiceNumber}
                                    >
                                        Actualizar invoice
                                    </Button>
                                </div>
                                <p className="text-[11px] text-muted-foreground">Compara ese invoice aunque su fecha sea anterior a 7 días y verifica el resultado antes de habilitar la impresión.</p>
                                {reductionIssue?.canApproveReduction && reductionIssue.orderNumber && (
                                    <div className="rounded-md border border-amber-700/60 bg-amber-950/30 p-2 text-xs text-amber-200">
                                        <p>
                                            Google Sheets tiene {reductionIssue.sourceItemCount} línea(s) y Supabase {reductionIssue.existingItemCount}.
                                            La reducción no perderá compras, costos de envío ni asignaciones protegidas.
                                        </p>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="mt-2 border-amber-500 text-amber-200"
                                            onClick={() => {
                                                if (confirm(`¿Confirmás eliminar del invoice #${reductionIssue.orderNumber} las líneas que ya no están en Google Sheets?`)) {
                                                    void handleInvoiceSync(reductionIssue.approvalToken);
                                                }
                                            }}
                                            disabled={isSyncing}
                                        >
                                            Confirmar reducción de este invoice
                                        </Button>
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-1 gap-2">
                                <Button
                                    variant="outline"
                                    className="justify-start text-emerald-600 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-50"
                                    onClick={() => handleSync(7)}
                                    disabled={isPending || isSyncing}
                                >
                                    <Cloud className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-bounce' : ''}`} />
                                    {isSyncing
                                        ? 'SINCRONIZANDO...'
                                        : directSyncEnabled
                                            ? 'ACTUALIZAR AHORA (DIRECTO)'
                                            : 'ACTUALIZAR 7 DIAS (CLOUD)'}
                                </Button>
                                <Button
                                    variant="outline"
                                    className="justify-start text-slate-600 border-slate-200 dark:border-slate-800 hover:bg-slate-50"
                                    onClick={() => handleSync(0)}
                                    disabled={isPending || isSyncing}
                                >
                                    <Cloud className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-bounce' : ''}`} />
                                    ACTUALIZACION COMPLETA (Historico)
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

                <Link href="/maintenance/evidence">
                    <Card className="dark:bg-slate-900 dark:border-slate-800 hover:border-emerald-500 transition-colors cursor-pointer h-full">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <FileCheck2 className="h-5 w-5 text-emerald-500" /> Evidencia de cuentas
                            </CardTitle>
                            <CardDescription>Respaldo para conciliaciones pendientes</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground mb-4">
                                Adjuntá Invoices, recibos o referencias antes de corregir un saldo histórico.
                            </p>
                            <Button variant="secondary" className="w-full">
                                Registrar evidencia
                            </Button>
                        </CardContent>
                    </Card>
                </Link>

                <Link href="/maintenance/accounts-review">
                    <Card className="dark:bg-slate-900 dark:border-slate-800 hover:border-amber-500 transition-colors cursor-pointer h-full">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Landmark className="h-5 w-5 text-amber-500" /> Revisión de cuentas
                            </CardTitle>
                            <CardDescription>Saldos, origen y respaldos pendientes</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground mb-4">
                                Controle cuentas con ajustes históricos antes de aplicar una corrección.
                            </p>
                            <Button variant="secondary" className="w-full">
                                Ver cuentas
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
