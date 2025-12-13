
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Users, Package, CreditCard, ArrowRight } from 'lucide-react';

async function getDashboardData() {
  // 1. Total Receivables (Sum of all transactions)
  // Note: Optimally we should have a 'balance' field on Client, but calculating sum is fine for now with small data.
  const allTransactions = await prisma.transaction.aggregate({
    _sum: {
      amount: true,
    },
  });
  const totalReceivables = allTransactions._sum.amount || 0;

  // 2. Recent Orders
  const recentOrders = await prisma.order.findMany({
    take: 5,
    orderBy: { date: 'desc' },
    include: { client: true },
  });

  // 3. Top Debtors
  // This is expensive to do in JS if meaningful data size, but for <1000 clients it's instant.
  // Group transactions by client.
  const debtors = await prisma.transaction.groupBy({
    by: ['clientId'],
    _sum: {
      amount: true,
    },
    having: {
      amount: {
        _sum: {
          gt: 10, // Only show meaningful debt
        },
      },
    },
    orderBy: {
      _sum: {
        amount: 'desc',
      },
    },
    take: 5,
  });

  // Fetch client names for debtors
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const debtorsWithNames = await Promise.all(debtors.map(async (d: any) => {
    const client = await prisma.client.findUnique({ where: { id: d.clientId } });
    return {
      name: client?.name || 'Desconocido',
      amount: d._sum.amount || 0,
    };
  }));

  // 4. Active Orders Count
  const activeOrdersCount = await prisma.order.count({
    where: {
      status: {
        not: 'ENTREGADO'
      }
    }
  });

  return {
    totalReceivables,
    recentOrders,
    debtorsWithNames,
    activeOrdersCount
  };
}

export default async function DashboardPage() {
  const { totalReceivables, recentOrders, debtorsWithNames, activeOrdersCount } = await getDashboardData();

  return (
    <div className="p-8 space-y-8">
      {/* Header Section */}
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
          Dashboard
        </h2>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-lg border-l-4 border-l-indigo-500 transition hover:scale-105 dark:bg-slate-900 dark:border-l-indigo-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total por Cobrar</CardTitle>
            <div className="text-2xl font-bold font-mono text-indigo-700 dark:text-indigo-400">
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalReceivables)}
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mt-2">
              Deuda acumulada de clientes
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-l-4 border-l-pink-500 transition hover:scale-105 dark:bg-slate-900 dark:border-l-pink-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pedidos Activos</CardTitle>
            <Package className="h-4 w-4 text-pink-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-pink-700 dark:text-pink-400">{activeOrdersCount}</div>
            <p className="text-xs text-muted-foreground mt-2">
              En tránsito actualmente
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">

        {/* Recent Orders */}
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Últimos Envíos</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {recentOrders.map((order: any) => (
                  <TableRow key={order.id} className="hover:bg-muted/50">
                    <TableCell className="font-medium">#{order.order_number}</TableCell>
                    <TableCell>{order.client.name}</TableCell>
                    <TableCell>
                      <Badge variant={order.status === 'ENTREGADO' ? 'secondary' : 'default'}>
                        {order.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(order.total_amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Top Debtors */}
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Mayores Deudores</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {debtorsWithNames.map((debtor: any, i: number) => (
                <div key={i} className="flex items-center">
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">{debtor.name}</p>
                  </div>
                  <div className="ml-auto font-bold text-red-600">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(debtor.amount)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
