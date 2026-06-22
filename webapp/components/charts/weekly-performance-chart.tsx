'use client';

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface WeeklyPerformancePoint {
  name: string;
  salesRevenue: number;
  shipmentRevenue: number;
  totalProfit: number;
}

const money = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value || 0);

export function WeeklyPerformanceChart({ data }: { data: WeeklyPerformancePoint[] }) {
  return (
    <Card className="shadow-md dark:bg-slate-900 border-l-4 border-l-indigo-600">
      <CardHeader>
        <CardTitle>Facturación y Ganancia por Semana</CardTitle>
        <CardDescription>Ventas de productos, envíos y utilidad total devengada.</CardDescription>
      </CardHeader>
      <CardContent className="h-[360px] pl-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.45} />
            <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis
              stroke="#94a3b8"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `$${(Number(value) / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', color: '#fff' }}
              formatter={(value: number) => money(value)}
              labelStyle={{ color: '#cbd5e1' }}
            />
            <Legend />
            <Bar dataKey="salesRevenue" stackId="revenue" name="Pedidos facturados" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            <Bar dataKey="shipmentRevenue" stackId="revenue" name="Envíos facturados" fill="#06b6d4" radius={[4, 4, 0, 0]} />
            <Line type="monotone" dataKey="totalProfit" name="Ganancia total" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
