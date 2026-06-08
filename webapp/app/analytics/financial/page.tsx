
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    Line, ComposedChart
} from 'recharts';
import { getFinancialAnalytics } from '@/app/analytics-actions';
import { AlertTriangle, Banknote, CircleDollarSign, ReceiptText, Target, WalletCards } from 'lucide-react';

import { PeriodSelector } from '@/components/analytics/period-selector';

export default function FinancialDashboard() {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [months, setMonths] = useState(6);

    useEffect(() => {
        setLoading(true);
        getFinancialAnalytics(months).then(res => {
            setData(res);
            setLoading(false);
        });
    }, [months]);

    if (loading) return <div className="p-10 text-center text-slate-500 animate-pulse">Analizando estados financieros ({months} meses)...</div>;

    const money = (value: number) => new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0
    }).format(value || 0);

    const qualityWarnings = [
        data.dataQuality.expenseRows <= 3 ? `Solo hay ${data.dataQuality.expenseRows} gastos cargados en el periodo.` : null,
        data.dataQuality.futureTransactions > 0 ? `${data.dataQuality.futureTransactions} movimientos tienen fecha futura.` : null,
        data.dataQuality.negativePayments > 0 ? `${data.dataQuality.negativePayments} pagos figuran con signo negativo.` : null,
        data.dataQuality.shipmentsMissingFinancials > 0 ? `${data.dataQuality.shipmentsMissingFinancials} envíos tienen precio o costo en cero.` : null,
        data.dataQuality.manualTransactions > 0 ? `${data.dataQuality.manualTransactions} movimientos manuales necesitan clasificación.` : null
    ].filter((warning): warning is string => Boolean(warning));

    return (
        <div className="p-8 space-y-8 animate-in fade-in slide-in-from-bottom-5 duration-700">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-4xl font-black tracking-tight text-slate-900 dark:text-white">
                        Estado de Resultados (P&L)
                    </h1>
                    <p className="text-muted-foreground mt-2">Visión ejecutiva de rentabilidad neta y salud financiera.</p>
                </div>
                <PeriodSelector value={months} onChange={setMonths} />
            </div>

            {/* Top KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="border-l-4 border-l-emerald-500 shadow-lg">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                            <CircleDollarSign className="h-4 w-4" /> Venta Facturada
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-emerald-600">{money(data.summary.totalRevenue)}</div>
                        <p className="text-[10px] text-slate-400 mt-1">Ventas + logística del periodo</p>
                    </CardContent>
                </Card>

                <Card className="border-l-4 border-l-indigo-500 shadow-lg">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                            <Target className="h-4 w-4" /> Utilidad Real
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className={`text-3xl font-black ${data.summary.totalNetProfit >= 0 ? 'text-indigo-600' : 'text-red-600'}`}>
                            {money(data.summary.totalNetProfit)}
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1">Margen neto {data.summary.avgMargin.toFixed(1)}%</p>
                    </CardContent>
                </Card>

                <Card className="border-l-4 border-l-fuchsia-500 shadow-lg">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                            <Banknote className="h-4 w-4" /> Caja Cobrada
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-fuchsia-600">{money(data.summary.totalCashCollected)}</div>
                        <p className="text-[10px] text-slate-400 mt-1">Cobertura sobre cargos {data.summary.cashCoverage.toFixed(1)}%</p>
                    </CardContent>
                </Card>

                <Card className="border-l-4 border-l-red-500 shadow-lg">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                            <WalletCards className="h-4 w-4" /> Por Cobrar
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-red-600">{money(data.summary.receivables)}</div>
                        <p className="text-[10px] text-slate-400 mt-1">Saldos negativos de clientes</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Revenue vs Expenses Chart */}
                <Card className="lg:col-span-2 shadow-2xl overflow-hidden border-none bg-slate-900 text-white">
                    <CardHeader>
                        <CardTitle>Rentabilidad Devengada</CardTitle>
                        <CardDescription className="text-slate-400">Venta facturada, utilidad bruta y utilidad neta mensual.</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={data.monthlyData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                <XAxis dataKey="name" stroke="#94a3b8" />
                                <YAxis
                                    stroke="#94a3b8"
                                    tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                                />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px' }}
                                    itemStyle={{ color: '#f8fafc' }}
                                    formatter={(value: number) => money(value)}
                                    labelStyle={{ color: '#94a3b8' }}
                                />
                                <Legend />
                                <Bar dataKey="revenue" name="Facturado" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={34} />
                                <Bar dataKey="grossProfit" name="Utilidad Bruta" fill="#10b981" radius={[4, 4, 0, 0]} barSize={34} />
                                <Line type="monotone" dataKey="netProfit" name="Utilidad Neta" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4 }} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                <Card className="shadow-2xl border-slate-200 bg-white dark:bg-slate-950">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-amber-500" />
                            Calidad de Datos
                        </CardTitle>
                        <CardDescription>
                            Alertas que afectan la lectura financiera.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {qualityWarnings.length > 0 ? qualityWarnings.map((warning: string) => (
                            <div key={warning} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                                {warning}
                            </div>
                        )) : (
                            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                                No se detectaron alertas críticas en el periodo.
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-3 pt-2 text-sm">
                            <div className="rounded-md bg-slate-50 p-3 dark:bg-slate-900">
                                <p className="text-xs text-slate-500">Gasto mensual prom.</p>
                                <p className="font-black">{money(data.summary.burnRate)}</p>
                            </div>
                            <div className="rounded-md bg-slate-50 p-3 dark:bg-slate-900">
                                <p className="text-xs text-slate-500">OpEx / ingresos</p>
                                <p className="font-black">{data.summary.efficiencyRatio.toFixed(1)}%</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card className="shadow-xl">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <ReceiptText className="h-5 w-5 text-emerald-600" />
                        Caja vs Cargos Emitidos
                    </CardTitle>
                    <CardDescription>Compara lo que se cobró contra lo que se cargó a clientes.</CardDescription>
                </CardHeader>
                <CardContent className="h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data.monthlyData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="name" />
                            <YAxis tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`} />
                            <Tooltip formatter={(value: number) => money(value)} />
                            <Legend />
                            <Bar dataKey="chargesIssued" name="Cargos emitidos" fill="#f97316" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="cashCollected" name="Caja cobrada" fill="#10b981" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="manualNet" name="Manual neto" fill="#64748b" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>
        </div>
    );
}
