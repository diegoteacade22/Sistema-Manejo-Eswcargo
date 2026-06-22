import Link from 'next/link';
import { addDays, differenceInCalendarDays, endOfDay, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek, subMonths, subWeeks } from 'date-fns';
import { ArrowLeft, BarChart3, CalendarRange, Package, ReceiptText, TrendingDown, TrendingUp, Truck } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { WeekRangeSelector } from '@/components/analytics/week-range-selector';
import { WeeklyPerformanceChart } from '@/components/charts/weekly-performance-chart';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type WeekBucket = {
  key: string;
  label: string;
  rangeLabel: string;
  start: Date;
  end: Date;
  salesRevenue: number;
  salesProfit: number;
  shipmentRevenue: number;
  shipmentProfit: number;
  orderCount: number;
  shipmentCount: number;
};

const money = (value: number, digits = 0) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits }).format(value || 0);

const pct = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;

const percentChange = (current: number, previous: number) => {
  if (!previous && !current) return 0;
  if (!previous) return 100;
  return ((current - previous) / Math.abs(previous)) * 100;
};

const margin = (profit: number, revenue: number) => (revenue > 0 ? (profit / revenue) * 100 : 0);

const clampWeeks = (value?: string) => {
  const parsed = Number(value || 4);
  return [1, 2, 4, 8].includes(parsed) ? parsed : 4;
};

const emptyWeek = (start: Date, end: Date): WeekBucket => ({
  key: format(start, 'yyyy-MM-dd'),
  label: `Sem. ${format(start, 'MM/dd')}`,
  rangeLabel: `${format(start, 'MM/dd')} - ${format(end, 'MM/dd')}`,
  start,
  end,
  salesRevenue: 0,
  salesProfit: 0,
  shipmentRevenue: 0,
  shipmentProfit: 0,
  orderCount: 0,
  shipmentCount: 0,
});

const totals = (rows: WeekBucket[]) => rows.reduce(
  (acc, row) => {
    acc.salesRevenue += row.salesRevenue;
    acc.salesProfit += row.salesProfit;
    acc.shipmentRevenue += row.shipmentRevenue;
    acc.shipmentProfit += row.shipmentProfit;
    acc.orderCount += row.orderCount;
    acc.shipmentCount += row.shipmentCount;
    return acc;
  },
  { salesRevenue: 0, salesProfit: 0, shipmentRevenue: 0, shipmentProfit: 0, orderCount: 0, shipmentCount: 0 }
);

const bucketTotalRevenue = (row: Pick<WeekBucket, 'salesRevenue' | 'shipmentRevenue'>) => row.salesRevenue + row.shipmentRevenue;
const bucketTotalProfit = (row: Pick<WeekBucket, 'salesProfit' | 'shipmentProfit'>) => row.salesProfit + row.shipmentProfit;

function findBucket(date: Date, buckets: WeekBucket[]) {
  return buckets.find((bucket) => date >= bucket.start && date <= bucket.end);
}

async function getWeeklyAnalytics(weeks: number) {
  const session = await auth();
  if (!session?.user || (session.user as any).role !== 'ADMIN') return null;

  if (!(process.env.DATABASE_URL || '').trim()) {
    return {
      weeks,
      rows: [] as WeekBucket[],
      previousWeek: emptyWeek(new Date(), new Date()),
      selectedTotals: totals([]),
      currentMonth: totals([]),
      previousMonth: totals([]),
    };
  }

  const now = new Date();
  const todayEnd = endOfDay(now);
  const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 });
  const allWeeks = Array.from({ length: weeks + 1 }, (_, index) => {
    const start = subWeeks(currentWeekStart, weeks - index);
    const end = index === weeks ? todayEnd : endOfWeek(start, { weekStartsOn: 1 });
    return emptyWeek(start, end);
  });

  const visibleWeeks = allWeeks.slice(1);
  const previousWeek = allWeeks[0];

  const currentMonthStart = startOfMonth(now);
  const previousMonthStart = subMonths(currentMonthStart, 1);
  const monthDayOffset = differenceInCalendarDays(now, currentMonthStart);
  const previousMonthEnd = endOfDay(new Date(Math.min(addDays(previousMonthStart, monthDayOffset).getTime(), endOfMonth(previousMonthStart).getTime())));
  const queryStart = previousMonthStart < allWeeks[0].start ? previousMonthStart : allWeeks[0].start;

  const orders = await prisma.order.findMany({
    where: {
      date: { gte: queryStart, lte: todayEnd },
      status: { not: 'CANCELADO' },
      order_number: { lt: 900000 },
    },
    include: { items: true },
  });

  const shipments = await prisma.shipment.findMany({
    where: {
      date_shipped: { gte: queryStart, lte: todayEnd },
    },
  });

  const currentMonthRows = [emptyWeek(currentMonthStart, todayEnd)];
  const previousMonthRows = [emptyWeek(previousMonthStart, previousMonthEnd)];

  for (const order of orders) {
    const date = new Date(order.date);
    const revenue = order.total_amount || 0;
    const profit = order.items.reduce((sum, item) => sum + (item.profit || 0), 0);

    const weekBucket = findBucket(date, allWeeks);
    if (weekBucket) {
      weekBucket.salesRevenue += revenue;
      weekBucket.salesProfit += profit;
      weekBucket.orderCount += 1;
    }

    const monthBucket = findBucket(date, currentMonthRows) || findBucket(date, previousMonthRows);
    if (monthBucket) {
      monthBucket.salesRevenue += revenue;
      monthBucket.salesProfit += profit;
      monthBucket.orderCount += 1;
    }
  }

  for (const shipment of shipments) {
    if (!shipment.date_shipped) continue;
    const date = new Date(shipment.date_shipped);
    const revenue = shipment.price_total || 0;
    const profit = shipment.profit ?? ((shipment.price_total || 0) - (shipment.cost_total || 0));

    const weekBucket = findBucket(date, allWeeks);
    if (weekBucket) {
      weekBucket.shipmentRevenue += revenue;
      weekBucket.shipmentProfit += profit;
      weekBucket.shipmentCount += 1;
    }

    const monthBucket = findBucket(date, currentMonthRows) || findBucket(date, previousMonthRows);
    if (monthBucket) {
      monthBucket.shipmentRevenue += revenue;
      monthBucket.shipmentProfit += profit;
      monthBucket.shipmentCount += 1;
    }
  }

  return {
    weeks,
    rows: visibleWeeks,
    previousWeek,
    selectedTotals: totals(visibleWeeks),
    currentMonth: totals(currentMonthRows),
    previousMonth: totals(previousMonthRows),
  };
}

function TrendBadge({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <Badge className={positive ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30'}>
      {positive ? <TrendingUp className="mr-1 h-3 w-3" /> : <TrendingDown className="mr-1 h-3 w-3" />}
      {pct(value)}
    </Badge>
  );
}

export default async function WeeklyAnalyticsPage(props: { searchParams: Promise<{ weeks?: string }> }) {
  const searchParams = await props.searchParams;
  const weeks = clampWeeks(searchParams?.weeks);
  const data = await getWeeklyAnalytics(weeks);

  if (!data) {
    return (
      <div className="p-8 min-h-screen flex flex-col items-center justify-center gap-4 text-center">
        <CalendarRange className="h-12 w-12 text-orange-500" />
        <h1 className="text-2xl font-bold">Acceso solo para administradores</h1>
        <Button asChild><Link href="/">Volver al Menu Principal</Link></Button>
      </div>
    );
  }

  const currentWeek = data.rows[data.rows.length - 1] || emptyWeek(new Date(), new Date());
  const priorRows = data.rows.slice(0, -1);
  const priorTotals = totals(priorRows);
  const priorAvgRevenue = priorRows.length ? bucketTotalRevenue(priorTotals) / priorRows.length : bucketTotalRevenue(data.previousWeek);
  const priorAvgProfit = priorRows.length ? bucketTotalProfit(priorTotals) / priorRows.length : bucketTotalProfit(data.previousWeek);
  const currentRevenue = bucketTotalRevenue(currentWeek);
  const currentProfit = bucketTotalProfit(currentWeek);
  const previousRevenue = bucketTotalRevenue(data.previousWeek);
  const previousProfit = bucketTotalProfit(data.previousWeek);
  const selectedRevenue = bucketTotalRevenue(data.selectedTotals);
  const selectedProfit = bucketTotalProfit(data.selectedTotals);
  const currentMonthRevenue = bucketTotalRevenue(data.currentMonth);
  const previousMonthRevenue = bucketTotalRevenue(data.previousMonth);
  const currentMonthProfit = bucketTotalProfit(data.currentMonth);
  const previousMonthProfit = bucketTotalProfit(data.previousMonth);

  const chartData = data.rows.map((row) => ({
    name: row.label,
    salesRevenue: Math.round(row.salesRevenue),
    shipmentRevenue: Math.round(row.shipmentRevenue),
    totalProfit: Math.round(bucketTotalProfit(row)),
  }));

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <Button variant="outline" size="sm" asChild className="mb-4">
            <Link href="/"><ArrowLeft className="mr-2 h-4 w-4" /> Volver al Menu Principal</Link>
          </Button>
          <h1 className="text-4xl font-black tracking-tight text-foreground flex items-center gap-3">
            <BarChart3 className="h-9 w-9 text-indigo-500" />
            Rendimiento Semanal
          </h1>
          <p className="text-muted-foreground mt-1">Facturación, ganancia y comparación semanal de pedidos y envíos.</p>
        </div>
        <WeekRangeSelector initialValue={data.weeks} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-l-4 border-l-blue-500 shadow-md dark:bg-slate-950/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ReceiptText className="h-4 w-4 text-blue-500" /> Semana Actual Facturada
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-blue-500">{money(currentRevenue)}</div>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              vs semana anterior <TrendBadge value={percentChange(currentRevenue, previousRevenue)} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-500 shadow-md dark:bg-slate-950/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-500" /> Ganancia Semana Actual
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-emerald-500">{money(currentProfit)}</div>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              vs semana anterior <TrendBadge value={percentChange(currentProfit, previousProfit)} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-cyan-500 shadow-md dark:bg-slate-950/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package className="h-4 w-4 text-cyan-500" /> Promedio Elegido
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-cyan-500">{money(priorAvgRevenue)}</div>
            <p className="mt-2 text-xs text-muted-foreground">
              Semana actual vs promedio: <span className="font-bold"><TrendBadge value={percentChange(currentRevenue, priorAvgRevenue)} /></span>
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-orange-500 shadow-md dark:bg-slate-950/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CalendarRange className="h-4 w-4 text-orange-500" /> Mes en Curso
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-orange-500">{money(currentMonthRevenue)}</div>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              vs mes anterior mismo corte <TrendBadge value={percentChange(currentMonthRevenue, previousMonthRevenue)} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1 border-l-4 border-l-slate-500 shadow-md dark:bg-slate-950/50">
          <CardHeader>
            <CardTitle>Resumen del Periodo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Facturado total</span>
              <span className="font-black">{money(selectedRevenue)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Ganancia total</span>
              <span className="font-black text-emerald-500">{money(selectedProfit)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Margen</span>
              <span className="font-black">{margin(selectedProfit, selectedRevenue).toFixed(1)}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Pedidos / envíos</span>
              <span className="font-black">{data.selectedTotals.orderCount} / {data.selectedTotals.shipmentCount}</span>
            </div>
            <div className="rounded-md bg-slate-900/70 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Ganancia vs promedio</span>
                <TrendBadge value={percentChange(currentProfit, priorAvgProfit)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <WeeklyPerformanceChart data={chartData} />
        </div>
      </div>

      <Card className="shadow-md dark:bg-slate-900 border-l-4 border-l-emerald-600">
        <CardHeader>
          <CardTitle>Detalle por Semana</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Semana</TableHead>
                <TableHead className="text-right">Pedidos</TableHead>
                <TableHead className="text-right">Gan. Pedidos</TableHead>
                <TableHead className="text-right">Envíos</TableHead>
                <TableHead className="text-right">Gan. Envíos</TableHead>
                <TableHead className="text-right">Total Facturado</TableHead>
                <TableHead className="text-right">Ganancia</TableHead>
                <TableHead className="text-right">Margen</TableHead>
                <TableHead className="text-right">vs previa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row, index) => {
                const prior = index === 0 ? data.previousWeek : data.rows[index - 1];
                const rowRevenue = bucketTotalRevenue(row);
                const rowProfit = bucketTotalProfit(row);
                return (
                  <TableRow key={row.key}>
                    <TableCell>
                      <div className="font-bold">{row.label}</div>
                      <div className="text-xs text-muted-foreground">{row.rangeLabel}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{money(row.salesRevenue)}</TableCell>
                    <TableCell className="text-right font-mono text-emerald-500">{money(row.salesProfit)}</TableCell>
                    <TableCell className="text-right font-mono">{money(row.shipmentRevenue)}</TableCell>
                    <TableCell className="text-right font-mono text-emerald-500">{money(row.shipmentProfit)}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{money(rowRevenue)}</TableCell>
                    <TableCell className="text-right font-mono font-bold text-emerald-500">{money(rowProfit)}</TableCell>
                    <TableCell className="text-right font-mono">{margin(rowProfit, rowRevenue).toFixed(1)}%</TableCell>
                    <TableCell className="text-right"><TrendBadge value={percentChange(rowRevenue, bucketTotalRevenue(prior))} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-l-4 border-l-blue-500 shadow-md dark:bg-slate-950/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ReceiptText className="h-5 w-5 text-blue-500" /> Pedidos vs Logística</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Pedidos facturados</p>
              <p className="text-2xl font-black">{money(data.selectedTotals.salesRevenue)}</p>
              <p className="text-xs text-emerald-500">Ganancia {money(data.selectedTotals.salesProfit)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Envíos facturados</p>
              <p className="text-2xl font-black">{money(data.selectedTotals.shipmentRevenue)}</p>
              <p className="text-xs text-emerald-500">Ganancia {money(data.selectedTotals.shipmentProfit)}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-orange-500 shadow-md dark:bg-slate-950/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5 text-orange-500" /> Mes contra Mes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Facturado mes actual</span>
              <span className="font-black">{money(currentMonthRevenue)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Facturado mes anterior</span>
              <span className="font-black">{money(previousMonthRevenue)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Ganancia mes actual</span>
              <span className="font-black text-emerald-500">{money(currentMonthProfit)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Ganancia vs mes anterior</span>
              <TrendBadge value={percentChange(currentMonthProfit, previousMonthProfit)} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
