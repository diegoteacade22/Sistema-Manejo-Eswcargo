
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    LineChart, Line, AreaChart, Area, ComposedChart
} from 'recharts';
import { getFinancialAnalytics } from '@/app/analytics-actions';
import { DollarSign, TrendingUp, TrendingDown, Target, BrainCircuit, Wallet } from 'lucide-react';

export default function FinancialDashboard() {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getFinancialAnalytics().then(res => {
            setData(res);
            setLoading(false);
        });
    }, []);

    if (loading) return <div className="p-10 text-center">Analizando estados financieros...</div>;

    // Financial Analysis Logic (as an analyst)
    const lastMonth = data.monthlyData[data.monthlyData.length - 1];
    const prevMonth = data.monthlyData[data.monthlyData.length - 2];
    const profitGrowth = ((lastMonth.netProfit - prevMonth.netProfit) / Math.abs(prevMonth.netProfit)) * 100;

    return (
        <div className="p-8 space-y-8 animate-in fade-in slide-in-from-bottom-5 duration-700">
            <div>
                <h1 className="text-4xl font-black tracking-tight text-slate-900 dark:text-white">
                    Estado de Resultados (P&L)
                </h1>
                <p className="text-muted-foreground mt-2">Visión ejecutiva de rentabilidad neta y salud financiera.</p>
            </div>

            {/* Top KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="border-l-4 border-l-emerald-500 shadow-lg">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                            <TrendingUp className="h-4 w-4" /> Margen Neto Promedio
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black">{data.summary.avgMargin.toFixed(1)}%</div>
                        <p className={`text-xs mt-1 font-bold ${profitGrowth >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {profitGrowth >= 0 ? '+' : ''}{profitGrowth.toFixed(1)}% vs mes anterior
                        </p>
                    </CardContent>
                </Card>

                <Card className="border-l-4 border-l-indigo-500 shadow-lg">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                            <DollarSign className="h-4 w-4" /> Ganancia Neta (Total)
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black">USD {new Intl.NumberFormat('en-US').format(data.summary.totalNetProfit)}</div>
                        <p className="text-xs text-muted-foreground mt-1 text-[10px]">Acumulado últimos 6 meses</p>
                    </CardContent>
                </Card>

                <Card className="border-l-4 border-l-red-500 shadow-lg">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                            <Wallet className="h-4 w-4" /> Burn Rate (OpEx)
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-red-600">USD {new Intl.NumberFormat('en-US').format(data.summary.burnRate)}</div>
                        <p className="text-xs text-muted-foreground mt-1 text-[10px]">Gasto operativo del último mes</p>
                    </CardContent>
                </Card>

                <Card className="border-l-4 border-l-orange-500 shadow-lg bg-orange-50/10">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                            <Target className="h-4 w-4" /> Punto de Equilibrio
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-black">USD {new Intl.NumberFormat('en-US').format(data.summary.burnRate / (data.summary.avgMargin / 100))}</div>
                        <p className="text-xs text-muted-foreground mt-1 text-[10px]">Venta necesaria para cubrir OpEx</p>
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
                                <YAxis stroke="#94a3b8" />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '8px' }}
                                    itemStyle={{ color: '#f8fafc' }}
                                />
                                <Legend />
                                <Bar dataKey="revenue" name="Ingresos Totales" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={40} />
                                <Bar dataKey="expenses" name="Gastos Operativos" fill="#f43f5e" radius={[4, 4, 0, 0]} barSize={40} />
                                <Line type="monotone" dataKey="netProfit" name="Ganancia Neta" stroke="#10b981" strokeWidth={3} dot={{ r: 6 }} />
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
                                    Actualizado hoy<br />{new Date().toLocaleDateString()}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
