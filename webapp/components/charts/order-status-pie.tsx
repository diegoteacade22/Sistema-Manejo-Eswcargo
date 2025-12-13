'use client';

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface OrderStatusPieProps {
    data: { name: string; value: number }[];
}

const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#3b82f6']; // Green, Amber, Red, Blue

export function OrderStatusPie({ data }: OrderStatusPieProps) {
    return (
        <Card className="col-span-3 dark:bg-slate-900 border-pink-100 dark:border-pink-900">
            <CardHeader>
                <CardTitle>Estado de Pedidos</CardTitle>
                <CardDescription>Distribución actual</CardDescription>
            </CardHeader>
            <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            fill="#8884d8"
                            paddingAngle={5}
                            dataKey="value"
                        >
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip
                            contentStyle={{ backgroundColor: 'rgba(17, 24, 39, 0.9)', border: 'none', borderRadius: '8px', color: '#fff' }}
                        />
                        <Legend verticalAlign="bottom" height={36} />
                    </PieChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    );
}
