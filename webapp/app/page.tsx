
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Users, Package, CreditCard, ArrowRight, TrendingUp } from 'lucide-react';
import { SalesTrendChart } from '@/components/charts/sales-trend-chart';
import { OrderStatusPie } from '@/components/charts/order-status-pie';
import Link from 'next/link';

async function getDashboardData() {
  // 1. Total Receivables
  const allTransactions = await prisma.transaction.aggregate({
    _sum: { amount: true },
  });
  const totalReceivables = allTransactions._sum.amount || 0;

  // 2. Recent Orders & All Orders for Charts
  // Fetching all orders for last 6 months to build the chart
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const orders = await prisma.order.findMany({
    where: { date: { gte: sixMonthsAgo } },
    include: { client: true },
    orderBy: { date: 'desc' },
  });

  const recentOrders = orders.slice(0, 5);

  // 3. Calculate Monthly Sales (JS Grouping)
  const monthlyData: Record<string, number> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  orders.forEach((order: any) => {
    const date = new Date(order.date);
    const key = `${date.toLocaleString('default', { month: 'short' })}`.toUpperCase(); // e.g., DIC
    monthlyData[key] = (monthlyData[key] || 0) + order.total_amount;
  });

  // Convert to array for Recharts
  // Note: Object keys ordering might be tricky, usually we want chronological. 
  // For simplicity, let's just take the keys we found. 
  // A better approach involves generating keys for last 6 months and filling.
  const chartData = Object.entries(monthlyData).map(([name, total]) => ({ name, total })).reverse();


  // 4. Order Status Distribution using Prisma GroupBy
  const statusGroups = await prisma.order.groupBy({
    by: ['status'],
    _count: { _all: true }
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const statusData = statusGroups.map((g: any) => ({
    name: g.status,
    value: g._count._all
  }));

  const activeOrdersCount = statusData
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((d: any) => d.name !== 'ENTREGADO' && d.name !== 'CANCELADO')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .reduce((acc: number, curr: any) => acc + curr.value, 0);


  // 5. Top Debtors
  const debtors = await prisma.transaction.groupBy({
    by: ['clientId'],
    _sum: { amount: true },
    having: { amount: { _sum: { gt: 10 } } },
    orderBy: { _sum: { amount: 'desc' } },
    take: 5,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const debtorsWithNames = await Promise.all(debtors.map(async (d: any) => {
    const client = await prisma.client.findUnique({ where: { id: d.clientId } });
    return {
      name: client?.name || 'Desconocido',
      amount: d._sum.amount || 0,
      id: d.clientId
    };
  }));

  return {
    totalReceivables,
    recentOrders,
    debtorsWithNames,
    activeOrdersCount,
    chartData,
    statusData
  };
}

export default async function DashboardPage() {
  const { totalReceivables, recentOrders, debtorsWithNames, activeOrdersCount, chartData, statusData } = await getDashboardData();

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      {/* Header Section */}
      <div className="flex items-center justify-between space-y-2">
        <div>
          <h2 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-orange-600 to-indigo-600 bg-clip-text text-transparent">
            Panel de Control
          </h2>
          <p className="text-muted-foreground mt-1">Resumen ejecutivo y métricas clave.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild className="bg-orange-600 hover:bg-orange-700">
            <Link href="/orders/new">
              <Package className="mr-2 h-4 w-4" /> Nuevo Pedido
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Cobranzas */}
        <Card className="shadow-lg border-l-4 border-l-indigo-500 hover:shadow-xl transition-all dark:bg-slate-950/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Por Cobrar</CardTitle>
            <CreditCard className="h-4 w-4 text-indigo-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-indigo-600 dark:text-indigo-400">
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalReceivables)}
            </div>
          </CardContent>
        </Card>

        {/* Pedidos Activos */}
        <Card className="shadow-lg border-l-4 border-l-orange-500 hover:shadow-xl transition-all dark:bg-slate-950/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">En Proceso</CardTitle>
            <Package className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{activeOrdersCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Pedidos Activos</p>
          </CardContent>
        </Card>

        {/* Ventas Mes (Ejemplo estático o calculado si tuviéramos targets) */}
        <Card className="shadow-lg border-l-4 border-l-emerald-500 hover:shadow-xl transition-all dark:bg-slate-950/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ventas (6 Meses)</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
                chartData.reduce((acc, curr) => acc + curr.total, 0)
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Total facturado periodo</p>
          </CardContent>
        </Card>

        {/* Clientes Activos (Ejemplo) */}
        <Card className="shadow-lg border-l-4 border-l-blue-500 hover:shadow-xl transition-all dark:bg-slate-950/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Clientes</CardTitle>
            <Users className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {debtorsWithNames.length > 5 ? '5+' : debtorsWithNames.length}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Con saldo pendiente</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Section */}
      <div className="grid gap-4 md:grid-cols-7">
        <SalesTrendChart data={chartData} />
        <OrderStatusPie data={statusData} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        {/* Recent Orders */}
        <Card className="col-span-4 shadow-md dark:bg-slate-900">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Últimos Movimientos</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/orders" className="text-xs">Ver todo <ArrowRight className="ml-1 h-3 w-3" /></Link>
            </Button>
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
                      <Badge variant={order.status === 'ENTREGADO' ? 'secondary' : 'outline'} className={
                        order.status === 'PENDIENTE' ? 'bg-yellow-100 text-yellow-800 border-yellow-200' :
                          order.status === 'EN_PROCESO' ? 'bg-blue-100 text-blue-800 border-blue-200' : ''
                      }>
                        {order.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(order.total_amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Top Debtors */}
        <Card className="col-span-3 shadow-md dark:bg-slate-900">
          <CardHeader>
            <CardTitle>Cuentas por Cobrar (Top 5)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {debtorsWithNames.map((debtor: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-bold text-xs">
                      {debtor.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="space-y-1">
                      <Link href={`/clients/${debtor.id}`} className="text-sm font-medium leading-none hover:underline">{debtor.name}</Link>
                    </div>
                  </div>
                  <div className="font-bold text-red-600 dark:text-red-400 font-mono text-sm">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(debtor.amount)}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t text-center">
              <Button variant="link" size="sm" asChild>
                <Link href="/clients?sort=balance">Ver todos los deudores</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

