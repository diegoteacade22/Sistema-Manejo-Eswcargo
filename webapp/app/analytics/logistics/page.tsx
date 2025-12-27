
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell, ScatterChart, Scatter, ZAxis
} from 'recharts';
import { getLogisticsAnalytics } from '@/app/analytics-actions';
import { Truck, Scale, Anchor, Zap, AlertCircle } from 'lucide-react';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function LogisticsDashboard() {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getLogisticsAnalytics().then(res => {
            setData(res);
            setLoading(false);
        });
    }, []);

    if (loading) return <div className="p-10 text-center">Calculando métricas de carga...</div>;
    if (!data) return <div className="p-10 text-center text-slate-400">No hay suficientes datos de envíos entregados para generar analítica.</div>;

    const kpis = data.kpis;

    return (
        <div className="p-8 space-y-8 animate-in fade-in zoom-in-95 duration-700">
            <div>
                <h1 className="text-4xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
                    <Anchor className="h-10 w-10 text-blue-600" />
                    Operaciones Logísticas
                </h1>
                <p className="text-muted-foreground mt-2">Eficiencia de transporte, costos por kilo y análisis de carga.</p>
            </div>

            {/* Logistics KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="shadow-lg border-2 border-blue-50">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                            <Scale className="h-4 w-4" /> Costo Promedio / KG
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-blue-700">USD {kpis.avgCostPerKg.toFixed(2)}</div>
                        <p className="text-[10px] text-slate-400 mt-1">Gasto logístico directo</p>
                    </CardContent>
                </Card>

                <Card className="shadow-lg border-2 border-emerald-50">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                            <Zap className="h-4 w-4" /> Ingreso Promedio / KG
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-emerald-700">USD {kpis.avgRevPerKg.toFixed(2)}</div>
                        <p className="text-[10px] text-slate-400 mt-1">Facturación al cliente</p>
                    </CardContent>
                </Card>

                <Card className="shadow-lg border-2 border-indigo-50">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                            <Truck className="h-4 w-4" /> Margen Logístico
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-indigo-700">{kpis.logisticsMargin.toFixed(1)}%</div>
                        <p className="text-[10px] text-slate-400 mt-1">Eficiencia de intermediación</p>
                    </CardContent>
                </Card>

                <Card className="shadow-lg border-2 border-slate-50">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-bold text-slate-500 uppercase">Total KG Procesados</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800">{new Intl.NumberFormat().format(kpis.totalKgProcessed)} KG</div>
                        <p className="text-[10px] text-slate-400 mt-1">Volumen histórico analizado</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Distribution by Type */}
                <Card className="shadow-xl">
                    <CardHeader>
                        <CardTitle>Rentabilidad por Tipo de Carga</CardTitle>
                        <CardDescription>Comparativa de ganancia neta según categoría de importación.</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[350px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.typeSummary}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="name" />
                                <YAxis />
                                <Tooltip />
                                <Bar dataKey="profit" name="Ganancia USD" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Logistics Strategy Advice */}
                <Card className="bg-slate-50 border-dashed border-2 border-slate-200 shadow-none flex flex-col justify-center p-8">
                    <div className="flex items-start gap-4">
                        <div className="bg-blue-600 p-3 rounded-2xl text-white">
                            <AlertCircle className="h-8 w-8" />
                        </div>
                        <div className="space-y-4">
                            <h3 className="text-xl font-bold text-slate-900">Pauta Estratégica Logística</h3>
                            <div className="space-y-2">
                                <p className="text-sm text-slate-600 leading-relaxed">
                                    Tu factor de eficiencia actual es de **{(kpis.avgRevPerKg / kpis.avgCostPerKg).toFixed(1)}x**.
                                    Cada dólar invertido en flete genera **USD {(kpis.avgRevPerKg - kpis.avgCostPerKg).toFixed(2)}** de ganancia bruta por kilo.
                                </p>
                                <ul className="text-xs text-slate-500 space-y-2 list-disc pl-4">
                                    <li>Optimizar consolidación de cargas menores a 5kg para mejorar margen.</li>
                                    <li>Revisar acuerdos con Forwarder si el costo/kg supera los USD {(kpis.avgCostPerKg * 1.1).toFixed(0)}.</li>
                                    <li>Incrementar volumen en categorías con margen superior al {(kpis.logisticsMargin * 1.2).toFixed(0)}%.</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
}
