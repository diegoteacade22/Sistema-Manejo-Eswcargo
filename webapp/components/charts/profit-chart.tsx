
'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface ProfitChartProps {
    data: {
        name: string;
        salesProfit: number;
        shipmentProfit: number;
        totalProfit: number
    }[];
}

export function ProfitChart({ data }: ProfitChartProps) {
    return (
        <Card className="col-span-full border-emerald-100 dark:border-emerald-900 dark:bg-slate-900 border-l-4 border-l-emerald-500 shadow-md">
            <CardHeader>
                <CardTitle>Rentabilidad Mensual</CardTitle>
                <CardDescription>Ganancias netas por Ventas y Envíos (Últimos 6 Meses)</CardDescription>
            </CardHeader>
            <CardContent className="pl-2">
                <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#374151" opacity={0.2} />
                        <XAxis
                            dataKey="name"
                            stroke="#94a3b8"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis
                            stroke="#94a3b8"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => `$${value}`}
                        />
                        <Tooltip
                            contentStyle={{ backgroundColor: 'rgba(17, 24, 39, 0.95)', border: 'none', borderRadius: '8px', color: '#fff' }}
                            formatter={(value: number) => [`$${new Intl.NumberFormat('en-US').format(value)}`, '']}
                            cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }}
                        />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        <Bar
                            dataKey="salesProfit"
                            name="Ganancia Ventas"
                            stackId="a"
                            fill="#10b981"
                            radius={[0, 0, 4, 4]}
                        />
                        <Bar
                            dataKey="shipmentProfit"
                            name="Ganancia Envíos"
                            stackId="a"
                            fill="#3b82f6"
                            radius={[4, 4, 0, 0]}
                        />
                    </BarChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    );
}
