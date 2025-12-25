
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Users, Package, CreditCard, ArrowRight, TrendingUp, DollarSign } from 'lucide-react';
import { SalesTrendChart } from '@/components/charts/sales-trend-chart';
import { OrderStatusPie } from '@/components/charts/order-status-pie';
import { ProfitChart } from '@/components/charts/profit-chart'; // New Component
import Link from 'next/link';

import { auth } from '@/lib/auth';

async function getDashboardData() {
  const session = await auth();
  if (!session?.user) return null;

  const userRole = (session.user as any).role;
  const userId = (session.user as any).id;

  // If Client, we need their internal Client record
  let clientId: number | null = null;
  if (userRole === 'CLIENT') {
    const client = await (prisma.client as any).findFirst({
      where: { userId: userId },
      select: { id: true }
    });
    clientId = client?.id || null;
  }

  // 1. Total Receivables (Excluya a clientes de ver el total global)
  let totalReceivables = 0;
  if (userRole === 'ADMIN') {
    const clientBalances = await prisma.transaction.groupBy({
      by: ['clientId'],
      _sum: { amount: true },
    });
    totalReceivables = clientBalances
      .reduce((acc, curr) => {
        const balance = curr._sum.amount || 0;
        return balance > 0 ? acc + balance : acc;
      }, 0);
  } else if (clientId) {
    // Para el cliente, su propio balance (deuda)
    const balance = await prisma.transaction.aggregate({
      where: { clientId: clientId },
      _sum: { amount: true }
    });
    totalReceivables = balance._sum.amount || 0;
  }

  // 2. Date Range (Last 6 Months)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  // 3. Fetch Orders
  const orders = await prisma.order.findMany({
    where: {
      date: { gte: sixMonthsAgo },
      status: { not: 'CANCELADO' },
      ...(clientId ? { clientId } : {})
    },
    include: {
      client: true,
      items: {
        include: { product: true }
      }
    },
    orderBy: { date: 'desc' },
  });

  const recentOrders = orders.slice(0, 5);

  // 4. Fetch Shipments
  const shipments = await (prisma as any).shipment.findMany({
    where: {
      date_shipped: { gte: sixMonthsAgo },
      ...(clientId ? { clientId } : {})
    }
  });

  // 5. Data Processing for Charts
  const monthlyStats: Record<string, { sales: number; salesProfit: number; shipmentProfit: number }> = {};
  // ... rest of processing is the same, but using the filtered orders/shipments

  // Initialize months to ensure continuity
  for (let i = 0; i < 6; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = d.toLocaleString('default', { month: 'short' }).toUpperCase();
    monthlyStats[key] = { sales: 0, salesProfit: 0, shipmentProfit: 0 };
  }

  // Process Orders
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  orders.forEach((order: any) => {
    const date = new Date(order.date);
    const key = date.toLocaleString('default', { month: 'short' }).toUpperCase();

    if (!monthlyStats[key]) monthlyStats[key] = { sales: 0, salesProfit: 0, shipmentProfit: 0 };

    // Total Sales
    monthlyStats[key].sales += order.total_amount;

    // Sales Profit Calculation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderProfit = order.items.reduce((acc: number, item: any) => {
      return acc + (item.profit || 0); // Use explicit profit from Excel
    }, 0);

    monthlyStats[key].salesProfit += orderProfit;
  });

  // Process Shipments
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shipments.forEach((shipment: any) => {
    if (!shipment.date_shipped) return;
    const date = new Date(shipment.date_shipped);
    const key = date.toLocaleString('default', { month: 'short' }).toUpperCase();

    if (!monthlyStats[key]) monthlyStats[key] = { sales: 0, salesProfit: 0, shipmentProfit: 0 };

    // Shipment Profit: Use 'profit' field first, then fallback to calculation
    const profit = shipment.profit ?? ((shipment.price_total || 0) - (shipment.cost_total || 0));
    monthlyStats[key].shipmentProfit += profit;
  });

  // Convert to Array and Reverse (Chronological)
  const chartData = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = d.toLocaleString('default', { month: 'short' }).toUpperCase();

    const stats = monthlyStats[key] || { sales: 0, salesProfit: 0, shipmentProfit: 0 };

    chartData.push({
      name: key,
      total: stats.sales, // For SalesTrendChart (legacy)
      salesProfit: stats.salesProfit,
      shipmentProfit: stats.shipmentProfit,
      totalProfit: stats.salesProfit + stats.shipmentProfit
    });
  }


  // 6. Order Status Distribution using Prisma GroupBy
  // 6. Order Status Groups (Filtered)
  const statusGroups = await prisma.order.groupBy({
    where: { ...(clientId ? { clientId } : {}) },
    by: ['status'],
    _count: { _all: true }
  });

  const statusData = statusGroups.map((g: any) => ({
    name: g.status,
    value: g._count._all
  }));

  const activeOrdersCount = statusData
    .filter((d: any) => d.name !== 'ENTREGADO' && d.name !== 'CANCELADO')
    .reduce((acc: number, curr: any) => acc + curr.value, 0);

  // 7. Top Debtors (Hide for clients or show only themselves?)
  // For clients, it makes more sense to hide the "Top Debtors" section entirely.
  let debtorsWithNames: any[] = [];
  if (userRole === 'ADMIN') {
    const debtors = await prisma.transaction.groupBy({
      by: ['clientId'],
      _sum: { amount: true },
      having: { amount: { _sum: { gt: 10 } } },
      orderBy: { _sum: { amount: 'desc' } },
      take: 5,
    });

    debtorsWithNames = await Promise.all(debtors.map(async (d: any) => {
      const client = await prisma.client.findUnique({ where: { id: d.clientId } });
      return {
        name: client?.name || 'Desconocido',
        amount: d._sum.amount || 0,
        id: d.clientId
      };
    }));
  }

  // Calculate Total Profit for KPI Card (Sum of last 6 months)
  const totalProfitPeriod = chartData.reduce((acc, curr) => acc + (curr.totalProfit || 0), 0);

  return {
    totalReceivables,
    recentOrders,
    debtorsWithNames,
    activeOrdersCount,
    chartData,
    statusData,
    totalProfitPeriod,
    userRole
  };
}

export default async function DashboardPage() {
  const data = await getDashboardData();
  if (!data) return null;

  const {
    totalReceivables,
    recentOrders,
    debtorsWithNames,
    activeOrdersCount,
    chartData,
    statusData,
    totalProfitPeriod,
    userRole
  } = data;

  const isAdmin = userRole === 'ADMIN';

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      {/* Header Section */}
      <div className="flex items-center justify-between space-y-2">
        <div>
          <h2 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-orange-600 to-indigo-600 bg-clip-text text-transparent">
            {isAdmin ? 'Panel de Control' : 'Mi Portal de Cliente'}
          </h2>
          <p className="text-muted-foreground mt-1">
            {isAdmin ? 'Resumen ejecutivo y métricas clave.' : 'Tu resumen de pedidos y cuenta corriente.'}
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button asChild className="bg-orange-600 hover:bg-orange-700">
              <Link href="/orders/new">
                <Package className="mr-2 h-4 w-4" /> Nuevo Pedido
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Cobranzas / Saldo */}
        <Card className="shadow-lg border-l-4 border-l-indigo-500 hover:shadow-xl transition-all dark:bg-slate-950/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {isAdmin ? 'Por Cobrar Global' : 'Mi Saldo Pendiente'}
            </CardTitle>
            <CreditCard className="h-4 w-4 text-indigo-500" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold font-mono ${totalReceivables > 10 ? 'text-red-500' : 'text-emerald-500'}`}>
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalReceivables)}
            </div>
            {!isAdmin && totalReceivables > 0 && <p className="text-xs text-red-400 mt-1">Saldo a favor del sistema</p>}
          </CardContent>
        </Card>

        {/* Ganancia NETA (Admin ONLY) */}
        {isAdmin && (
          <Card className="shadow-lg border-l-4 border-l-emerald-600 hover:shadow-xl transition-all dark:bg-slate-950/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Ganancia Neta (6m)</CardTitle>
              <DollarSign className="h-4 w-4 text-emerald-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalProfitPeriod)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Ventas + Envíos</p>
            </CardContent>
          </Card>
        )}

        {/* Ventas Mes */}
        <Card className="shadow-lg border-l-4 border-l-blue-500 hover:shadow-xl transition-all dark:bg-slate-950/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {isAdmin ? 'Ventas (6m)' : 'Mis Compras (6m)'}
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
                chartData.reduce((acc, curr) => acc + curr.total, 0)
              )}
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
      </div>

      {/* Main Charts Section */}
      <div className="grid gap-4 md:grid-cols-2">
        {isAdmin && <ProfitChart data={chartData} />}
        <SalesTrendChart data={chartData} />
      </div>

      <div className="grid gap-4 md:grid-cols-7">
        <div className={isAdmin ? "col-span-4" : "col-span-7"}>
          <OrderStatusPie data={statusData} />
        </div>
        {isAdmin && (
          <div className="col-span-3">
            {/* This could be another admin-only chart or the debtors list moved here */}
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        {/* Recent Orders */}
        <Card className={`${isAdmin ? 'col-span-4' : 'col-span-7'} shadow-md dark:bg-slate-900 border-l-4 border-l-slate-700`}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{isAdmin ? 'Últimos Movimientos Globales' : 'Mis Últimos Pedidos'}</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/orders" className="text-xs">Ver todo <ArrowRight className="ml-1 h-3 w-3" /></Link>
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  {isAdmin && <TableHead>Cliente</TableHead>}
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentOrders.map((order: any) => (
                  <TableRow key={order.id} className="hover:bg-muted/50">
                    <TableCell className="font-bold text-indigo-500">#{order.order_number}</TableCell>
                    {isAdmin && <TableCell className="font-medium">{order.client.name}</TableCell>}
                    <TableCell>
                      <Badge variant="outline" className={
                        order.status === 'PENDIENTE' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20 font-bold' :
                          order.status === 'ENTREGADO' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-bold' :
                            'bg-blue-500/10 text-blue-500 border-blue-500/20 font-bold'
                      }>
                        {order.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-black text-slate-900 dark:text-white font-mono">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(order.total_amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Top Debtors (Admin ONLY) */}
        {isAdmin && (
          <Card className="col-span-3 shadow-md dark:bg-slate-900 border-l-4 border-l-red-600">
            <CardHeader>
              <CardTitle>Cuentas por Cobrar (Top 5)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {debtorsWithNames.map((debtor: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-black text-xs">
                        {debtor.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="space-y-1">
                        <Link href={`/clients/${debtor.id}`} className="text-sm font-bold leading-none hover:underline">{debtor.name}</Link>
                      </div>
                    </div>
                    <div className="font-black text-red-600 dark:text-red-400 font-mono text-sm">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(debtor.amount)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-slate-800 text-center">
                <Button variant="link" size="sm" asChild>
                  <Link href="/clients?sort=balance">Ver todos los deudores</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Detalle de Ganancias (Admin ONLY) */}
      {isAdmin && (
        <Card className="shadow-md dark:bg-slate-900 border-t-4 border-t-emerald-600">
          <CardHeader>
            <CardTitle>Detalle de Rentabilidad Mensual</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader className="bg-slate-100 dark:bg-slate-900">
                <TableRow className="border-slate-300 dark:border-slate-700">
                  <TableHead className="text-slate-900 dark:text-white font-black text-xs uppercase tracking-widest">Mes</TableHead>
                  <TableHead className="text-right text-slate-900 dark:text-slate-100 font-bold text-xs uppercase tracking-widest">Ganancia Ventas</TableHead>
                  <TableHead className="text-right text-slate-900 dark:text-slate-100 font-bold text-xs uppercase tracking-widest">Ganancia Envíos</TableHead>
                  <TableHead className="text-right font-black text-slate-950 dark:text-white text-xs uppercase tracking-widest">Total Ganancia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chartData.map((data: any) => (
                  <TableRow key={data.name} className="hover:bg-muted/50 border-slate-200 dark:border-slate-800 h-16 transition-colors">
                    <TableCell className="font-black capitalize text-slate-950 dark:text-white text-base">{data.name}</TableCell>
                    <TableCell className="text-right text-emerald-600 dark:text-emerald-400 font-mono font-black text-lg">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(data.salesProfit)}
                    </TableCell>
                    <TableCell className="text-right text-blue-600 dark:text-blue-400 font-mono font-black text-lg">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(data.shipmentProfit)}
                    </TableCell>
                    <TableCell className="text-right font-black text-slate-950 dark:text-white font-mono text-xl bg-slate-50 dark:bg-slate-900/50">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(data.totalProfit)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
