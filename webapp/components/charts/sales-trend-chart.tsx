'use client';

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface SalesTrendChartProps {
    data: { name: string; chargesIssued?: number; cashCollected?: number; cashGap?: number; total?: number }[];
}

export function SalesTrendChart({ data }: SalesTrendChartProps) {
    return (
        <Card className="col-span-full dark:bg-slate-900 border-indigo-100 dark:border-indigo-900">
            <CardHeader>
                <CardTitle>Facturado vs Cobrado</CardTitle>
                <CardDescription>Comparación mensual entre cargos emitidos y caja efectivamente cobrada</CardDescription>
            </CardHeader>
            <CardContent className="pl-2">
                <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={data}>
                        <XAxis
                            dataKey="name"
                            stroke="#888888"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis
                            stroke="#888888"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => `$${value}`}
                        />
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#374151" opacity={0.2} />
                        <Tooltip 
                            contentStyle={{ backgroundColor: 'rgba(17, 24, 39, 0.9)', border: 'none', borderRadius: '8px', color: '#fff' }}
                            formatter={(value: number, name: string) => [`$${value.toLocaleString()}`, name]}
                        />
                        <Legend wrapperStyle={{ paddingTop: '16px' }} />
                        <Bar dataKey="chargesIssued" name="Facturado/Cargado" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="cashCollected" name="Cobrado" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    );
}
