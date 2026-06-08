
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Users, Package, CreditCard, ArrowRight, DollarSign, AlertCircle, Lock, Banknote, Truck, ReceiptText, ClipboardList } from 'lucide-react';
import { SalesTrendChart } from '@/components/charts/sales-trend-chart';
import { ProfitChart } from '@/components/charts/profit-chart'; // New Component
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { DashboardPeriodSelector } from '@/components/analytics/dashboard-period-selector';

async function getDashboardData(monthsToAnalyze: number = 6) {
  const session = await auth();
  if (!session?.user) return null;

  const userRole = (session.user as any).role;
  const userId = (session.user as any).id;

  // En local sin base de datos configurada, evitamos consultas Prisma
  // y devolvemos un dashboard vacío para permitir navegación de desarrollo.
  if (!(process.env.DATABASE_URL || '').trim()) {
    return {
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
      clientShipments: [],
      cashCollectedPeriod: 0,
      chargesIssuedPeriod: 0,
      cashCoverage: 0,
      shipmentInTransitCount: 0,
      ordersToBuyCount: 0,
      pendingPurchaseQty: 0,
      dataIssues: [],
      clientId: userRole === 'CLIENT' ? null : undefined,
    };
  }

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
      clientShipments: [],
      cashCollectedPeriod: 0,
      chargesIssuedPeriod: 0,
      cashCoverage: 0,
      shipmentInTransitCount: 0,
      ordersToBuyCount: 0,
      pendingPurchaseQty: 0,
      dataIssues: []
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

  let adminClientBalances: any[] = [];

  // 1. Total Receivables (Excluya a clientes de ver el total global)
  let totalReceivables = 0;
  if (userRole === 'ADMIN') {
    const clientBalances = await prisma.transaction.groupBy({
      by: ['clientId'],
      where: { clientId: { not: null } },
      _sum: { amount: true },
    });
    adminClientBalances = clientBalances as any[];
    totalReceivables = adminClientBalances.reduce((acc, curr) => {
      const balance = curr._sum.amount || 0;
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
      order_number: { lt: 900000 },
      ...(clientId ? { clientId } : {})
    },
    include: {
      client: true,
      items: {
        include: { product: true }
      }
    },
    orderBy: [
      { date: 'desc' },
      { order_number: 'desc' }
    ],
  });

  const recentOrders = orders.slice(0, 5);

  const periodTransactions = await prisma.transaction.findMany({
    where: {
      date: { gte: rangeStart },
      ...(clientId ? { clientId } : { clientId: { not: null } })
    }
  });

  const cashCollectedPeriod = periodTransactions
    .filter(tx => tx.type === 'PAGO' && tx.amount > 0)
    .reduce((sum, tx) => sum + tx.amount, 0);

  const chargesIssuedPeriod = periodTransactions
    .filter(tx => tx.type === 'CARGO' && tx.amount < 0)
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

  const cashCoverage = chargesIssuedPeriod > 0 ? (cashCollectedPeriod / chargesIssuedPeriod) * 100 : 0;

  // 4. Fetch Shipments
  const shipments = await (prisma as any).shipment.findMany({
    where: {
      date_shipped: { gte: rangeStart },
      ...(clientId ? { clientId } : {})
    },
    include: { client: true },
    orderBy: { date_shipped: 'desc' }
  });

  const shipmentInTransitCount = shipments.filter((shipment: any) =>
    ['SALIENDO', 'LLEGANDO', 'EN TRANSITO', 'EN 🇦🇷', 'MIAMI', 'PARCIAL'].includes(String(shipment.status || '').toUpperCase())
  ).length;

  const ordersToBuyCount = orders.filter((order) => ['COMPRAR', 'RESERVADO'].includes(String(order.status || '').toUpperCase())).length;

  let pendingPurchaseQty = 0;
  if (userRole === 'ADMIN') {
    const purchases = await (prisma as any).purchase.findMany({
      include: {
        items: {
          include: {
            allocations: { select: { quantity: true } }
          }
        }
      }
    });
    pendingPurchaseQty = purchases.reduce((sum: number, purchase: any) => {
      const purchasePending = purchase.items.reduce((itemSum: number, item: any) => {
        const allocated = item.allocations.reduce((acc: number, allocation: any) => acc + allocation.quantity, 0);
        return itemSum + Math.max(0, item.quantity - allocated);
      }, 0);
      return sum + purchasePending;
    }, 0);
  }

  // 5. Data Processing for Charts
  const monthlyStats: Record<string, { sales: number; salesProfit: number; shipmentProfit: number; chargesIssued: number; cashCollected: number; label: string }> = {};

  for (let i = 0; i < monthsToAnalyze; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleString('default', { month: 'short', year: '2-digit' }).toUpperCase();
    monthlyStats[key] = { sales: 0, salesProfit: 0, shipmentProfit: 0, chargesIssued: 0, cashCollected: 0, label };
  }

  orders.forEach((order: any) => {
    const date = new Date(order.date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!monthlyStats[key]) {
      const label = date.toLocaleString('default', { month: 'short', year: '2-digit' }).toUpperCase();
      monthlyStats[key] = { sales: 0, salesProfit: 0, shipmentProfit: 0, chargesIssued: 0, cashCollected: 0, label };
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
      monthlyStats[key] = { sales: 0, salesProfit: 0, shipmentProfit: 0, chargesIssued: 0, cashCollected: 0, label };
    }
    const profit = userRole === 'ADMIN'
      ? (shipment.profit ?? ((shipment.price_total || 0) - (shipment.cost_total || 0)))
      : 0;
    monthlyStats[key].shipmentProfit += profit;
  });

  periodTransactions.forEach((tx) => {
    const date = new Date(tx.date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!monthlyStats[key]) {
      const label = date.toLocaleString('default', { month: 'short', year: '2-digit' }).toUpperCase();
      monthlyStats[key] = { sales: 0, salesProfit: 0, shipmentProfit: 0, chargesIssued: 0, cashCollected: 0, label };
    }
    if (tx.type === 'PAGO' && tx.amount > 0) monthlyStats[key].cashCollected += tx.amount;
    if (tx.type === 'CARGO' && tx.amount < 0) monthlyStats[key].chargesIssued += Math.abs(tx.amount);
  });

  const chartData = [];
  for (let i = monthsToAnalyze - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const stats = monthlyStats[key] || { sales: 0, salesProfit: 0, shipmentProfit: 0, chargesIssued: 0, cashCollected: 0, label: d.toLocaleString('default', { month: 'short', year: '2-digit' }).toUpperCase() };
    chartData.push({
      name: stats.label || key,
      total: stats.sales,
      chargesIssued: stats.chargesIssued,
      cashCollected: stats.cashCollected,
      cashGap: stats.cashCollected - stats.chargesIssued,
      salesProfit: userRole === 'ADMIN' ? stats.salesProfit : 0,
      shipmentProfit: userRole === 'ADMIN' ? stats.shipmentProfit : 0,
      totalProfit: userRole === 'ADMIN' ? (stats.salesProfit + stats.shipmentProfit) : 0
    });
  }

  const statusGroups = await prisma.order.groupBy({
    where: { order_number: { lt: 900000 }, ...(clientId ? { clientId } : {}) },
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
    const topDebtors = adminClientBalances
      .filter((row) => typeof row.clientId === 'number' && (row._sum.amount || 0) < -10)
      .sort((a, b) => (a._sum.amount || 0) - (b._sum.amount || 0))
      .slice(0, 5);

    const debtorIds = topDebtors
      .map((row) => row.clientId)
      .filter((id): id is number => typeof id === 'number');

    const debtorClients = debtorIds.length > 0
      ? await prisma.client.findMany({
        where: { id: { in: debtorIds } },
        select: { id: true, name: true }
      })
      : [];

    const debtorNameMap = new Map(debtorClients.map((client) => [client.id, client.name]));

    debtorsWithNames = topDebtors.map((debtor) => ({
      name: debtorNameMap.get(debtor.clientId as number) || 'Desconocido',
      amount: Math.abs(debtor._sum.amount || 0),
      id: debtor.clientId
    }));
  }

  const totalProfitPeriod = chartData.reduce((acc, curr) => acc + (curr.totalProfit || 0), 0);

  const futureTransactions = userRole === 'ADMIN'
    ? await prisma.transaction.count({ where: { date: { gt: new Date() } } })
    : 0;

  const dataIssues = [];
  const shipmentsMissingFinancials = shipments.filter((shipment: any) =>
    (shipment.price_total || 0) === 0 || (shipment.cost_total || 0) === 0
  ).length;
  if (shipmentsMissingFinancials > 0) dataIssues.push(`${shipmentsMissingFinancials} envíos sin costo/precio`);
  if (futureTransactions > 0) dataIssues.push(`${futureTransactions} movimientos con fecha futura`);

  return {
    totalReceivables,
    recentOrders,
    debtorsWithNames,
    activeOrdersCount,
    chartData,
    statusData,
    totalProfitPeriod,
    cashCollectedPeriod,
    chargesIssuedPeriod,
    cashCoverage,
    userRole,
    shipmentInTransitCount,
    ordersToBuyCount,
    pendingPurchaseQty,
    dataIssues,
    clientHistory,
    clientShipments: shipments.slice(0, 5),
    recentShipments: shipments.slice(0, 6),
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
        <Button asChild><Link href="/">Reintentar</Link></Button>
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
    cashCollectedPeriod,
    chargesIssuedPeriod,
    cashCoverage,
    userRole,
    shipmentInTransitCount,
    ordersToBuyCount,
    pendingPurchaseQty,
    dataIssues,
    clientHistory,
    clientShipments,
    recentShipments,
    clientId
  } = data;

  const isAdmin = userRole === 'ADMIN';

  if (!isAdmin) {
    redirect('/login');
  }

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
        <Button asChild><Link href="/login">Cambiar de Usuario</Link></Button>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between space-y-2">
        <div>
          <h2 className="text-4xl font-bold tracking-tight text-foreground">
            {isAdmin ? 'Dashboard Operativo' : 'Mi Portal de Cliente'}
          </h2>
          <p className="text-muted-foreground mt-1">
            {isAdmin ? 'Caja, cuentas corrientes, compras y operación para decidir rápido.' : 'Tu resumen de pedidos y cuenta corriente.'}
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
        <Card className="shadow-lg border-l-4 border-l-red-500 hover:shadow-xl transition-all dark:bg-slate-950/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {isAdmin ? 'Por Cobrar Real' : 'Mi Saldo Actual'}
            </CardTitle>
            <CreditCard className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold font-mono ${isAdmin || totalReceivables < -10 ? 'text-red-500' : 'text-emerald-500'}`}>
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalReceivables)}
            </div>
            {isAdmin && <p className="text-xs text-muted-foreground mt-1">Suma de saldos negativos de clientes</p>}
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
              <CardTitle className="text-sm font-medium text-muted-foreground">Caja Cobrada</CardTitle>
              <Banknote className="h-4 w-4 text-emerald-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cashCollectedPeriod)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{months} meses · cobertura {cashCoverage.toFixed(0)}%</p>
            </CardContent>
          </Card>
        )}

        <Card className="shadow-lg border-l-4 border-l-blue-500 hover:shadow-xl transition-all dark:bg-slate-950/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {isAdmin ? 'Cargos Emitidos' : 'Mis Compras'}
            </CardTitle>
            <ReceiptText className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
                isAdmin ? chargesIssuedPeriod : chartData.reduce((acc, curr) => acc + curr.total, 0)
              )}
            </div>
            {isAdmin && <p className="text-xs text-muted-foreground mt-1">Ventas, envíos y cargos del periodo</p>}
          </CardContent>
        </Card>

        <Card className="shadow-lg border-l-4 border-l-orange-500 hover:shadow-xl transition-all dark:bg-slate-950/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">En Proceso</CardTitle>
            <Package className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{activeOrdersCount}</div>
            <p className="text-xs text-muted-foreground mt-1">{isAdmin ? `${ordersToBuyCount} por comprar/reservar` : 'Pedidos activos'}</p>
          </CardContent>
        </Card>
      </div>

      {isAdmin && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="border-l-4 border-l-emerald-500 shadow-md dark:bg-slate-950/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-emerald-500" /> Utilidad Estimada
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-black text-emerald-600">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalProfitPeriod)}
              </p>
              <p className="text-xs text-muted-foreground">Ventas + logística del periodo</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-blue-500 shadow-md dark:bg-slate-950/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Truck className="h-4 w-4 text-blue-500" /> Envíos en Movimiento
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-black text-blue-600">{shipmentInTransitCount}</p>
              <p className="text-xs text-muted-foreground">Saliendo, llegando o en tránsito</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-amber-500 shadow-md dark:bg-slate-950/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-amber-500" /> Stock/Compras Pendiente
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-black text-amber-600">{pendingPurchaseQty}</p>
              <p className="text-xs text-muted-foreground">Unidades compradas sin asignar</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-red-500 shadow-md dark:bg-slate-950/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-500" /> Datos a Corregir
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-black text-red-600">{dataIssues.length}</p>
              <p className="text-xs text-muted-foreground">{dataIssues[0] || 'Sin alertas críticas'}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {isAdmin && <ProfitChart data={chartData} />}
        <SalesTrendChart data={chartData} />
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
                    <TableCell className="font-bold text-indigo-500">
                      <Link href={`/orders/${order.id}`} className="hover:underline">#{order.order_number}</Link>
                    </TableCell>
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

      {isAdmin && (
        <Card className="shadow-md dark:bg-slate-900 border-l-4 border-l-blue-600">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Últimos Envíos</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/shipments" className="text-xs">Ver todo <ArrowRight className="ml-1 h-3 w-3" /></Link>
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Envío</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Venta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentShipments.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No hay envíos recientes.</TableCell></TableRow>
                ) : recentShipments.map((shipment: any) => (
                  <TableRow key={shipment.id}>
                    <TableCell className="font-bold text-blue-600">
                      <Link href={`/shipments/${shipment.id}`} className="hover:underline">#{shipment.shipment_number || shipment.id}</Link>
                    </TableCell>
                    <TableCell>{shipment.client?.name || 'Sin cliente'}</TableCell>
                    <TableCell>
                      <Badge className={shipment.status === 'ENTREGADO' || shipment.status === 'RECIBIDO' ? 'bg-emerald-500' : 'bg-blue-500'}>
                        {shipment.status || 'SIN ESTADO'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {shipment.date_shipped ? new Date(shipment.date_shipped).toLocaleDateString() : '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(shipment.price_total || 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

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
                      <TableCell className="font-bold">
                        <Link href={`/shipments/${s.id}`} className="hover:underline">#{s.shipment_number}</Link>
                      </TableCell>
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
