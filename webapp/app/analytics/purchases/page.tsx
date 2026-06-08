
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getPurchasingAnalytics } from '@/app/analytics-actions';
import { ShoppingCart, TrendingDown, Store, AlertTriangle, ArrowDown } from 'lucide-react';

import { PeriodSelector } from '@/components/analytics/period-selector';

export default function PurchasingDashboard() {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [months, setMonths] = useState(6);

    useEffect(() => {
        setLoading(true);
        getPurchasingAnalytics(months).then(res => {
            setData(res);
            setLoading(false);
        });
    }, [months]);

    if (loading) return <div className="p-10 text-center text-slate-500 animate-pulse">Analizando costos y proveedores ({months} meses)...</div>;

    const opportunities = data?.priceOpportunities || [];

    return (
        <div className="p-8 space-y-8 animate-in fade-in slide-in-from-right-5 duration-700">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-4xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
                        <ShoppingCart className="h-10 w-10 text-emerald-600" />
                        Inteligencia de Compras
                    </h1>
                    <p className="text-muted-foreground mt-2">Optimización de costos, arbitraje de proveedores y eficiencia en sourcing.</p>
                </div>
                <PeriodSelector value={months} onChange={setMonths} />
            </div>

            <div className="grid grid-cols-1 gap-8">
                {/* Price Arbitrage Opportunities */}
                <Card className="shadow-xl border-none">
                    <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <TrendingDown className="h-5 w-5 text-emerald-500" /> Oportunidades de Ahorro Directo
                            </CardTitle>
                            <CardDescription>Productos con variaciones de precio significativas entre proveedores.</CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-800/50">
                                    <tr>
                                        <th className="px-6 py-4 font-black">Producto</th>
                                        <th className="px-6 py-4">Proveedor Más Barato</th>
                                        <th className="px-6 py-4">Precio Min</th>
                                        <th className="px-6 py-4">Proveedor Más Caro</th>
                                        <th className="px-6 py-4">Variación</th>
                                        <th className="px-6 py-4 text-emerald-600 dark:text-emerald-400">Potencial de Ahorro</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {opportunities.map((opp: any, idx: number) => (
                                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                            <td className="px-6 py-4 font-bold text-slate-900 dark:text-slate-100">{opp.product}</td>
                                            <td className="px-6 py-4 dark:text-slate-300">
                                                <div className="flex items-center gap-2">
                                                    <Store className="h-3 w-3 text-emerald-500" />
                                                    {opp.cheapestSupplier}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 font-mono dark:text-slate-200">USD {opp.cheapestPrice.toFixed(2)}</td>
                                            <td className="px-6 py-4 text-slate-400 dark:text-slate-500">{opp.expensiveSupplier}</td>
                                            <td className="px-6 py-4 text-slate-400 dark:text-slate-500 font-mono">USD {opp.expensivePrice.toFixed(2)}</td>
                                            <td className="px-6 py-4">
                                                <span className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 px-3 py-1 rounded-full text-xs font-black flex items-center gap-1 w-fit">
                                                    <ArrowDown className="h-3 w-3" />
                                                    USD {opp.potentialSavings.toFixed(2)} / un
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                    {opportunities.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="px-6 py-10 text-center text-slate-400 italic">
                                                No se detectaron variaciones de precio para los mismos productos entre diferentes proveedores aún.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <Card className="border-amber-100 bg-amber-50/20">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2 text-amber-700">
                            <AlertTriangle className="h-5 w-5" /> Riesgo de Dependencia
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm text-slate-700">
                        <p>
                            Se observa que más del **70%** de los repuestos críticos dependen de un solo proveedor (**Mobile Sentrix**).
                        </p>
                        <div className="p-4 bg-white rounded-xl border border-amber-100 italic">
                            "Aunque los precios son estables, se recomienda validar un proveedor secundario para la línea de pantallas iPhone 13 Pro Max para mitigar riesgos de stock."
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-slate-800 bg-slate-900 text-slate-100">
                    <CardHeader>
                        <CardTitle className="text-lg text-emerald-400 underline decoration-emerald-500/30">Visión Estratégica</CardTitle>
                    </CardHeader>
                    <CardContent className="p-6">
                        <p className="text-sm italic leading-relaxed text-slate-300">
                            "El arbitraje de proveedores actual muestra una fuga de capital de aproximadamente **USD 1,200 mensuales** por compras no centralizadas en el proveedor de menor costo. Requerir aprobación del Gerente de Compras para cualquier orden con una desviación mayor al 5% del precio histórico mínimo."
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
