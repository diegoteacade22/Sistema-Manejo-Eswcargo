
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell
} from 'recharts';
import { getSalesAnalytics } from '@/app/analytics-actions';
import { Users, UserCheck, BarChart3, Magnet, Trophy } from 'lucide-react';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4'];

export default function SalesDashboard() {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getSalesAnalytics().then(res => {
            setData(res);
            setLoading(false);
        });
    }, []);

    if (loading) return <div className="p-10 text-center">Analizando comportamiento de clientes...</div>;

    const topClients = data.topClients;

    return (
        <div className="p-8 space-y-8 animate-in fade-in slide-in-from-right-5 duration-700">
            <div>
                <h1 className="text-4xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
                    <Users className="h-10 w-10 text-indigo-600" />
                    Inteligencia Comercial
                </h1>
                <p className="text-muted-foreground mt-2">Análisis de segmentos, valor de por vida del cliente (LTV) y fuentes de adquisición.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Ranking of top clients by LTV */}
                <Card className="lg:col-span-2 shadow-xl border-none">
                    <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <Trophy className="h-5 w-5 text-yellow-500" /> Top 10 Clientes (LTV)
                            </CardTitle>
                            <CardDescription>Clientes con mayor facturación histórica.</CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent className="h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={topClients} layout="vertical" margin={{ left: 40, right: 40 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={100} fontSize={10} />
                                <Tooltip
                                    formatter={(value: any) => [`USD ${value.toFixed(0)}`, 'LTV']}
                                    cursor={{ fill: 'transparent' }}
                                />
                                <Bar dataKey="LTV" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={25} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Source Distribution */}
                <Card className="shadow-xl bg-slate-900 text-white border-none">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Magnet className="h-5 w-5 text-indigo-400" /> Canales de Origen
                        </CardTitle>
                        <CardDescription className="text-slate-400">¿De dónde vienen tus ventas?</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[300px] flex flex-col items-center justify-center">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={data.sourceSummary}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {data.sourceSummary.map((entry: any, index: number) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="grid grid-cols-2 gap-4 mt-4 w-full px-4">
                            {data.sourceSummary.map((s: any, i: number) => (
                                <div key={s.name} className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                                    <span className="text-[10px] uppercase font-bold text-slate-400 truncate">{s.name}</span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Client Intelligence Matrix */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <Card className="border-indigo-100 bg-indigo-50/20">
                    <CardHeader>
                        <CardTitle className="text-lg">Matriz de Segmentos</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {['VIP', 'REGULAR', 'NUEVO'].map(seg => {
                            const count = topClients.filter((c: any) => (c.segment || '').toUpperCase() === seg).length;
                            return (
                                <div key={seg} className="flex justify-between items-center bg-white p-3 rounded-xl border border-indigo-100">
                                    <span className="font-black text-indigo-600 text-xs tracking-widest">{seg}</span>
                                    <span className="text-sm font-medium">{count} Clientes detectados en Top 10</span>
                                </div>
                            );
                        })}
                    </CardContent>
                </Card>

                <Card className="border-emerald-100 bg-emerald-50/20">
                    <CardHeader>
                        <CardTitle className="text-lg">Clave Estratégica</CardTitle>
                    </CardHeader>
                    <CardContent className="p-6">
                        <p className="text-sm text-slate-700 italic leading-relaxed">
                            "El Ticket Promedio general es de **USD {(topClients.reduce((sum: number, c: any) => sum + c.avgOrderValue, 0) / topClients.length).toFixed(0)}**.
                            Cualquier cliente con una rentabilidad menor al **10%** debería ser re-calificado para servicios logísticos 'Flat' en lugar de 'Premium' para proteger los márgenes generales."
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
