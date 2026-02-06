
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Users, Package, CreditCard, ArrowRight, TrendingUp, DollarSign, AlertCircle, Lightbulb, Lock } from 'lucide-react';
import { SalesTrendChart } from '@/components/charts/sales-trend-chart';
import { OrderStatusPie } from '@/components/charts/order-status-pie';
import { ProfitChart } from '@/components/charts/profit-chart'; // New Component
import Link from 'next/link';

import { auth } from '@/lib/auth';
import { DashboardPeriodSelector } from '@/components/analytics/dashboard-period-selector';

async function getDashboardData(monthsToAnalyze: number = 6) {
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

    if (!client) return {
      totalReceivables: 0,
      recentOrders: [],
      debtorsWithNames: [],
      activeOrdersCount: 0,
      chartData: [],
      statusData: [],
      totalProfitPeriod: 0,
      userRole,
      atRiskCount: 0,
      savingsOpportunities: 0,
      clientHistory: [],
      clientShipments: []
    };

    clientId = client.id;
  }

  // 0.5 Client Transactions (Last 10 for portal)
  let clientHistory: any[] = [];
  if (clientId) {
    clientHistory = await prisma.transaction.findMany({
      where: { clientId },
      orderBy: { date: 'desc' },
      take: 10
    });
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
        // Receivables are the sum of debts (negative balances)
        return balance < 0 ? acc + Math.abs(balance) : acc;
      }, 0);
  } else if (clientId) {
    // Para el cliente, su propio balance (deuda)
    const balanceResult = await prisma.transaction.aggregate({
      where: { clientId: clientId },
      _sum: { amount: true }
    });
    totalReceivables = balanceResult._sum.amount || 0;
  }

  // 2. Date Range
  const rangeStart = new Date();
  rangeStart.setMonth(rangeStart.getMonth() - monthsToAnalyze);
  rangeStart.setHours(0, 0, 0, 0);

  // 3. Fetch Orders
  const orders = await prisma.order.findMany({
    where: {
      date: { gte: rangeStart },
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
      date_shipped: { gte: rangeStart },
      ...(clientId ? { clientId } : {})
    },
    orderBy: { date_shipped: 'desc' }
  });

  // 5. Data Processing for Charts
  const monthlyStats: Record<string, { sales: number; salesProfit: number; shipmentProfit: number; label: string }> = {};

  for (let i = 0; i < monthsToAnalyze; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleString('default', { month: 'short', year: '2-digit' }).toUpperCase();
    monthlyStats[key] = { sales: 0, salesProfit: 0, shipmentProfit: 0, label };
  }

  orders.forEach((order: any) => {
    const date = new Date(order.date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!monthlyStats[key]) {
      const label = date.toLocaleString('default', { month: 'short', year: '2-digit' }).toUpperCase();
      monthlyStats[key] = { sales: 0, salesProfit: 0, shipmentProfit: 0, label };
    }
    monthlyStats[key].sales += order.total_amount;
    const orderProfit = userRole === 'ADMIN'
      ? order.items.reduce((acc: number, item: any) => acc + (item.profit || 0), 0)
      : 0;
    monthlyStats[key].salesProfit += orderProfit;
  });

  shipments.forEach((shipment: any) => {
    if (!shipment.date_shipped) return;
    const date = new Date(shipment.date_shipped);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!monthlyStats[key]) {
      const label = date.toLocaleString('default', { month: 'short', year: '2-digit' }).toUpperCase();
      monthlyStats[key] = { sales: 0, salesProfit: 0, shipmentProfit: 0, label };
    }
    const profit = userRole === 'ADMIN'
      ? (shipment.profit ?? ((shipment.price_total || 0) - (shipment.cost_total || 0)))
      : 0;
    monthlyStats[key].shipmentProfit += profit;
  });

  const chartData = [];
  for (let i = monthsToAnalyze - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const stats = monthlyStats[key] || { sales: 0, salesProfit: 0, shipmentProfit: 0, label: d.toLocaleString('default', { month: 'short', year: '2-digit' }).toUpperCase() };
    chartData.push({
      name: stats.label || key,
      total: stats.sales,
      salesProfit: userRole === 'ADMIN' ? stats.salesProfit : 0,
      shipmentProfit: userRole === 'ADMIN' ? stats.shipmentProfit : 0,
      totalProfit: userRole === 'ADMIN' ? (stats.salesProfit + stats.shipmentProfit) : 0
    });
  }

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

  const totalProfitPeriod = chartData.reduce((acc, curr) => acc + (curr.totalProfit || 0), 0);

  let atRiskCount = 0;
  let savingsOpportunities = 0;
  if (userRole === 'ADMIN') {
    const atRiskClients = await prisma.client.findMany({
      where: { orders: { some: {} } },
      include: { orders: { orderBy: { date: 'desc' }, take: 1 } }
    });
    atRiskCount = atRiskClients.filter(c => {
      const lastOrder = c.orders[0];
      if (!lastOrder) return false;
      const days = Math.floor((new Date().getTime() - lastOrder.date.getTime()) / (1000 * 3600 * 24));
      return days > 60;
    }).length;

    const priceVariations = await prisma.orderItem.groupBy({
      by: ['productName'],
      _count: { supplierId: true },
      having: { supplierId: { _count: { gt: 1 } } }
    });
    savingsOpportunities = priceVariations.length;
  }

  return {
    totalReceivables,
    recentOrders,
    debtorsWithNames,
    activeOrdersCount,
    chartData,
    statusData,
    totalProfitPeriod,
    userRole,
    atRiskCount,
    savingsOpportunities,
    clientHistory,
    clientShipments: shipments.slice(0, 5),
    clientId
  };
}

export default async function DashboardPage(props: { searchParams: Promise<{ months?: string }> }) {
  const searchParams = await props.searchParams;
  const months = searchParams?.months ? parseInt(searchParams.months) : 6;

  let data;
  try {
    data = await getDashboardData(months);
  } catch (error) {
    console.error("Dashboard Error:", error);
    return (
      <div className="p-8 text-center bg-slate-950 min-h-screen flex items-center justify-center flex-col gap-4">
        <AlertCircle className="h-12 w-12 text-red-500" />
        <h1 className="text-2xl font-bold text-white">Error al cargar el panel</h1>
        <p className="text-slate-400">Hubo un problema de conexión con la base de datos.</p>
        <Button onClick={() => window.location.reload()}>Reintentar</Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center bg-slate-950 min-h-screen flex items-center justify-center flex-col gap-4">
        <Lock className="h-12 w-12 text-orange-500" />
        <h1 className="text-2xl font-bold text-white">Sesión no válida</h1>
        <p className="text-slate-400">No hemos podido identificar tu sesión. Por favor, vuelve a ingresar.</p>
        <Button asChild><Link href="/login">Ir al Login</Link></Button>
      </div>
    );
  }

  const {
    totalReceivables,
    recentOrders,
    debtorsWithNames,
    activeOrdersCount,
    chartData,
    statusData,
    totalProfitPeriod,
    userRole,
    atRiskCount,
    savingsOpportunities,
    clientHistory,
    clientShipments,
    clientId
  } = data;

  const isAdmin = userRole === 'ADMIN';

  // Si es un cliente y no tiene ID vinculado, mostrar mensaje amigable
  if (!isAdmin && !clientId) {
    return (
      <div className="p-8 text-center bg-slate-950 min-h-screen flex items-center justify-center flex-col gap-4 text-white">
        <Users className="h-12 w-12 text-indigo-500" />
        <h1 className="text-2xl font-bold">Bienvenido a ImportSys</h1>
        <p className="text-slate-400 max-w-md mx-auto">
          Tu cuenta aún no está vinculada a un registro de cliente en nuestra base de datos administrativa.
          Contacta con soporte para habilitar tu acceso a pedidos y tracking.
        </p>
        <Button onClick={() => window.location.href = '/login'}>Cambiar de Usuario</Button>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
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
          <div className="flex gap-2 items-center">
            <DashboardPeriodSelector initialValue={months} />
            <Button asChild className="bg-orange-600 hover:bg-orange-700">
              <Link href="/orders/new">
                <Package className="mr-2 h-4 w-4" /> Nuevo Pedido
              </Link>
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-lg border-l-4 border-l-indigo-500 hover:shadow-xl transition-all dark:bg-slate-950/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {isAdmin ? 'Por Cobrar Global' : 'Mi Saldo Actual'}
            </CardTitle>
            <CreditCard className="h-4 w-4 text-indigo-500" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold font-mono ${totalReceivables < -10 ? 'text-red-500' : 'text-emerald-500'}`}>
              {totalReceivables > 0 ? '+' : ''}{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalReceivables)}
            </div>
            {!isAdmin && (
              <p className={`text-xs mt-1 ${totalReceivables < -10 ? 'text-red-400' : 'text-emerald-400'}`}>
                {totalReceivables < -10 ? '🔴 Tienes un saldo pendiente' : '🟢 Tienes saldo a favor'}
              </p>
            )}
          </CardContent>
        </Card>

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

      {isAdmin && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="bg-red-500/10 border-red-500/20 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-black text-red-600 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" /> ALERTA DE CLIENTES
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-black text-red-700">{atRiskCount}</p>
                  <p className="text-xs text-red-600/80 font-medium">Clientes VIP inactivos (+60 días)</p>
                </div>
                <Button size="sm" variant="outline" className="border-red-500/30 text-red-600 hover:bg-red-500 hover:text-white" asChild>
                  <Link href="/analytics/sales">Ver Detalles</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-emerald-500/10 border-emerald-500/20 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-black text-emerald-600 flex items-center gap-2">
                <Lightbulb className="h-4 w-4" /> COMPRAS INTELIGENTES
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-black text-emerald-700">{savingsOpportunities}</p>
                  <p className="text-xs text-emerald-600/80 font-medium">Oportunidades de ahorro detectadas</p>
                </div>
                <Button size="sm" variant="outline" className="border-emerald-500/30 text-emerald-600 hover:bg-emerald-500 hover:text-white" asChild>
                  <Link href="/analytics/purchases">Optimizar Costos</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {isAdmin && <ProfitChart data={chartData} />}
        <SalesTrendChart data={chartData} />
      </div>

      <div className="grid gap-4 md:grid-cols-7">
        <div className={isAdmin ? "col-span-4" : "col-span-7"}>
          <OrderStatusPie data={statusData} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
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
                    {isAdmin && <TableCell className="font-medium">{order.client?.name || 'S/N'}</TableCell>}
                    <TableCell>
                      <Badge variant="outline" className={
                        order.status === 'PENDIENTE' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20 font-bold' :
                          order.status === 'ENTREGADO' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-bold' :
                            'bg-blue-500/10 text-blue-500 border-blue-500/20 font-bold'
                      }>
                        {order.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-black font-mono">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(order.total_amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

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
                      <Link href={`/clients/${debtor.id}`} className="text-sm font-bold hover:underline">{debtor.name}</Link>
                    </div>
                    <div className="font-black text-red-600 font-mono text-sm">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(debtor.amount)}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {!isAdmin && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="shadow-md dark:bg-slate-900 border-l-4 border-l-blue-600">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Mis Envíos Recientes</CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/shipments" className="text-xs">Ver todo <ArrowRight className="ml-1 h-3 w-3" /></Link>
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nro</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientShipments.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No hay envíos registrados.</TableCell></TableRow>
                  ) : clientShipments.map((s: any) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-bold">#{s.shipment_number}</TableCell>
                      <TableCell>
                        <Badge className={s.status === 'RECIBIDO' || s.status === 'ENTREGADO' ? 'bg-emerald-500' : 'bg-blue-500'}>
                          {s.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {s.date_shipped ? new Date(s.date_shipped).toLocaleDateString() : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="shadow-md dark:bg-slate-900 border-l-4 border-l-orange-600">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Cuenta Corriente (Reciente)</CardTitle>
              <Button variant="secondary" size="sm" asChild>
                <Link href={`/clients/${clientId}`} className="text-xs font-bold whitespace-nowrap">📜 Ver Todo</Link>
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Detalle</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientHistory.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No hay movimientos.</TableCell></TableRow>
                  ) : clientHistory.map((tx: any) => (
                    <TableRow key={tx.id}>
                      <TableCell className="text-xs text-muted-foreground">{tx.date.toLocaleDateString()}</TableCell>
                      <TableCell className="text-xs font-medium truncate max-w-[150px]">{tx.description}</TableCell>
                      <TableCell className={`text-right font-bold font-mono text-sm ${tx.amount < 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                        {tx.amount > 0 ? '+' : ''}{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(tx.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
