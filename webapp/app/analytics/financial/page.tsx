
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    LineChart, Line, AreaChart, Area, ComposedChart
} from 'recharts';
import { getFinancialAnalytics } from '@/app/analytics-actions';
import { DollarSign, TrendingUp, TrendingDown, Target, BrainCircuit, Wallet, Activity, Zap, Clock3 } from 'lucide-react';

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

    // Financial Analysis Logic (as an analyst)
    // Ensure we have enough data points, though with variable months array length handles itself mostly
    const lastMonth = data.monthlyData[data.monthlyData.length - 1];
    const prevMonth = data.monthlyData[data.monthlyData.length - 2];
    const profitGrowth = prevMonth && prevMonth.netProfit !== 0 ? ((lastMonth.netProfit - prevMonth.netProfit) / Math.abs(prevMonth.netProfit)) * 100 : 0;
    const formatDateTime = (value: string | null | undefined) => value
        ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(value))
        : 'Sin sincronización validada';

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
                            <Activity className="h-4 w-4" /> Crecimiento MoM
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className={`text-3xl font-black ${data.summary.momGrowth >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {data.summary.momGrowth >= 0 ? '+' : ''}{data.summary.momGrowth.toFixed(1)}%
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1">Crecimiento de ingresos vs mes anterior</p>
                    </CardContent>
                </Card>

                <Card className="border-l-4 border-l-indigo-500 shadow-lg">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                            <Target className="h-4 w-4" /> Margen Neto
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black">{data.summary.avgMargin.toFixed(1)}%</div>
                        <p className="text-[10px] text-slate-400 mt-1">Rentabilidad final del periodo</p>
                    </CardContent>
                </Card>

                <Card className="border-l-4 border-l-fuchsia-500 shadow-lg">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                            <Zap className="h-4 w-4" /> Efficiency Ratio
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-fuchsia-600">{data.summary.efficiencyRatio.toFixed(1)}%</div>
                        <p className="text-[10px] text-slate-400 mt-1">Gasto OpEx / Ingresos Totales</p>
                    </CardContent>
                </Card>

                <Card className="border-l-4 border-l-red-500 shadow-lg">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                            <Wallet className="h-4 w-4" /> Burn Rate
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-red-600">USD {new Intl.NumberFormat('en-US').format(data.summary.burnRate)}</div>
                        <p className="text-[10px] text-slate-400 mt-1">Costo de estructura mensual</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Revenue vs Expenses Chart */}
                <Card className="lg:col-span-2 shadow-2xl overflow-hidden border-none bg-slate-900 text-white">
                    <CardHeader>
                        <CardTitle>Ingresos vs Egresos</CardTitle>
                        <CardDescription className="text-slate-400">Comparativa histórica de flujo operativo mensual.</CardDescription>
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
                                    formatter={(value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)}
                                    labelStyle={{ color: '#94a3b8' }}
                                />
                                <Legend />
                                <Bar dataKey="revenue" name="Ingresos Totales" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={40} />
                                <Bar dataKey="expenses" name="Costos y Gastos Totales" fill="#f43f5e" radius={[4, 4, 0, 0]} barSize={40} />
                                <Line type="monotone" dataKey="netProfit" name="Ganancia Neta" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* AI / Financial Analyst Insights */}
                <Card className="bg-gradient-to-br from-indigo-900 to-slate-900 text-white border-none shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <BrainCircuit className="h-32 w-32" />
                    </div>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-indigo-300">
                            Auditoría Financiera
                        </CardTitle>
                        <CardDescription className="text-indigo-400/60 font-mono text-[10px] uppercase tracking-widest">
                            Análisis basado en heurística de negocio
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6 relative z-10">
                        <div className="space-y-2">
                            <h4 className="text-sm font-bold text-indigo-200 border-b border-indigo-500/30 pb-1">Análisis de Estructura</h4>
                            <p className="text-xs text-slate-300 leading-relaxed">
                                {data.summary.avgMargin > 20
                                    ? "Excelente eficiencia operativa. Tu margen neto del " + data.summary.avgMargin.toFixed(1) + "% sugiere un fuerte poder de fijación de precios o costos controlados."
                                    : "Margen ajustado. Con un " + data.summary.avgMargin.toFixed(1) + "%, el negocio es vulnerable a variaciones en costos logísticos. Recomendamos revisar el pricing."}
                            </p>
                        </div>
                        <div className="space-y-2">
                            <h4 className="text-sm font-bold text-indigo-200 border-b border-indigo-500/30 pb-1">Recomendación Estratégica</h4>
                            <p className="text-xs text-slate-300 leading-relaxed italic">
                                "{data.summary.burnRate > (data.summary.totalRevenue / 12)
                                    ? "Los gastos operativos superan el promedio mensual de ventas de los últimos años. Considerar optimización en categorías no críticas."
                                    : "Crecimiento sustentable detectado. Capacidad operativa para escalar volumen sin incrementar proporcionalmente el OpEx."}"
                            </p>
                        </div>
                        <div className="pt-4 mt-4 border-t border-indigo-500/30">
                            <div className="flex justify-between items-center bg-white/5 p-3 rounded-lg border border-white/10">
                                <div>
                                    <p className="text-[10px] text-indigo-300 uppercase font-bold">Health Score</p>
                                    <p className="text-lg font-black">{data.summary.avgMargin > 15 ? 'A+' : 'B'}</p>
                                </div>
                                <div className="text-right text-[10px] text-slate-400">
                                    <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" /> Fuente validada</span><br />
                                    {formatDateTime(data.metadata?.lastVerifiedSyncAt)}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
            <p className="text-xs text-muted-foreground">
                Informe calculado {formatDateTime(data.metadata?.generatedAt)}. Fuente: {data.metadata?.source || 'Sistema operativo'}.
            </p>
        </div>
    );
}
