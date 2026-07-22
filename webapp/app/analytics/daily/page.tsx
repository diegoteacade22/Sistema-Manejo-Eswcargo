import Link from 'next/link';
import { CalendarDays, CircleDollarSign, Package, ShoppingCart, Truck } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const BUSINESS_TIME_ZONE = 'America/New_York';
const DAY_MS = 24 * 60 * 60 * 1000;

type DayMetrics = {
  key: string;
  salesRevenue: number;
  salesProfit: number;
  serviceRevenue: number;
  serviceProfit: number;
  orderCount: number;
  serviceCount: number;
};

const money = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value || 0);

const margin = (profit: number, revenue: number) =>
  revenue > 0 ? (profit / revenue) * 100 : 0;

const dateKeyInTimeZone = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

const shiftDateKey = (key: string, days: number) => {
  const date = new Date(`${key}T12:00:00.000Z`);
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
};

const labelForDate = (key: string, long = false) =>
  new Intl.DateTimeFormat('es-AR', {
    timeZone: 'UTC',
    weekday: long ? 'long' : 'short',
    day: '2-digit',
    month: long ? 'long' : '2-digit',
  }).format(new Date(`${key}T12:00:00.000Z`));

const emptyDay = (key: string): DayMetrics => ({
  key,
  salesRevenue: 0,
  salesProfit: 0,
  serviceRevenue: 0,
  serviceProfit: 0,
  orderCount: 0,
  serviceCount: 0,
});

async function getDailyMetrics() {
  const session = await auth();
  if (!session?.user || (session.user as { role?: string }).role !== 'ADMIN') return null;

  const todayKey = dateKeyInTimeZone(new Date());
  const days = Array.from({ length: 7 }, (_, index) => emptyDay(shiftDateKey(todayKey, -index)));

  if (!(process.env.DATABASE_URL || '').trim()) return { todayKey, days };

  const oldestKey = days[days.length - 1].key;
  const rangeStart = new Date(`${oldestKey}T00:00:00.000Z`);
  const rangeEnd = new Date(`${todayKey}T23:59:59.999Z`);

  const [orders, shipments] = await Promise.all([
    prisma.order.findMany({
      where: {
        date: { gte: rangeStart, lte: rangeEnd },
        status: { not: 'CANCELADO' },
        order_number: { lt: 900000 },
      },
      include: { items: true },
    }),
    prisma.shipment.findMany({
      where: { date_shipped: { gte: rangeStart, lte: rangeEnd } },
    }),
  ]);

  const byDay = new Map(days.map((day) => [day.key, day]));

  for (const order of orders) {
    const day = byDay.get(order.date.toISOString().slice(0, 10));
    if (!day) continue;
    day.salesRevenue += order.total_amount || 0;
    day.salesProfit += order.items.reduce((sum, item) => sum + (item.profit || 0), 0);
    day.orderCount += 1;
  }

  for (const shipment of shipments) {
    if (!shipment.date_shipped) continue;
    const day = byDay.get(shipment.date_shipped.toISOString().slice(0, 10));
    if (!day) continue;
    const revenue = shipment.price_total || 0;
    day.serviceRevenue += revenue;
    day.serviceProfit += shipment.profit ?? (revenue - (shipment.cost_total || 0));
    day.serviceCount += 1;
  }

  return { todayKey, days };
}

function MetricCard({
  title,
  icon: Icon,
  revenue,
  profit,
  countLabel,
  color,
}: {
  title: string;
  icon: typeof ShoppingCart;
  revenue: number;
  profit: number;
  countLabel: string;
  color: 'blue' | 'orange' | 'emerald';
}) {
  const styles = {
    blue: 'border-l-blue-500 text-blue-500',
    orange: 'border-l-orange-500 text-orange-500',
    emerald: 'border-l-emerald-500 text-emerald-500',
  }[color];

  return (
    <Card className={`border-l-4 shadow-md dark:bg-slate-950/50 ${styles}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg text-foreground">
          <Icon className={`h-5 w-5 ${styles.split(' ')[1]}`} /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Facturado</p>
          <p className="mt-1 text-3xl font-black text-foreground">{money(revenue)}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Ganado</p>
          <p className="mt-1 text-2xl font-black text-emerald-500">{money(profit)}</p>
        </div>
        <div className="flex items-center justify-between border-t pt-3 text-sm">
          <span className="text-muted-foreground">{countLabel}</span>
          <Badge variant="outline">Margen {margin(profit, revenue).toFixed(1)}%</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

export default async function DailyAnalyticsPage(props: { searchParams: Promise<{ date?: string }> }) {
  const searchParams = await props.searchParams;
  const data = await getDailyMetrics();

  if (!data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <CalendarDays className="h-12 w-12 text-cyan-500" />
        <h1 className="text-2xl font-bold">Acceso solo para administradores</h1>
        <Button asChild><Link href="/">Volver al Menu Principal</Link></Button>
      </div>
    );
  }

  const selected = data.days.find((day) => day.key === searchParams.date) || data.days[0];
  const totalRevenue = selected.salesRevenue + selected.serviceRevenue;
  const totalProfit = selected.salesProfit + selected.serviceProfit;
  const isToday = selected.key === data.todayKey;

  return (
    <div className="space-y-8 p-5 animate-in fade-in duration-500 md:p-8">
      <div>
        <Button variant="outline" size="sm" asChild className="mb-4">
          <Link href="/">Volver al Menu Principal</Link>
        </Button>
        <h1 className="flex items-center gap-3 text-3xl font-black tracking-tight text-foreground md:text-4xl">
          <CalendarDays className="h-9 w-9 text-cyan-500" /> Rendimiento Diario
        </h1>
        <p className="mt-1 text-muted-foreground">Facturación y ganancia diaria de ventas, servicios y total.</p>
      </div>

      <Card className="dark:bg-slate-950/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Elegir día</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {data.days.map((day) => {
            const active = day.key === selected.key;
            return (
              <Button key={day.key} variant={active ? 'default' : 'outline'} asChild className="h-auto py-3">
                <Link href={`/analytics/daily?date=${day.key}`} className="flex flex-col">
                  <span className="font-bold">{day.key === data.todayKey ? 'Hoy' : labelForDate(day.key).split(' ')[0]}</span>
                  <span className={active ? 'text-primary-foreground/75' : 'text-muted-foreground'}>{day.key.slice(5).split('-').reverse().join('/')}</span>
                </Link>
              </Button>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-black capitalize">{isToday ? 'Hoy' : labelForDate(selected.key, true)}</h2>
        <Badge variant="secondary">{selected.key.slice(5).split('-').reverse().join('/')}/{selected.key.slice(0, 4)}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <MetricCard
          title="Ventas"
          icon={ShoppingCart}
          revenue={selected.salesRevenue}
          profit={selected.salesProfit}
          countLabel={`${selected.orderCount} pedido${selected.orderCount === 1 ? '' : 's'}`}
          color="blue"
        />
        <MetricCard
          title="Servicios"
          icon={Truck}
          revenue={selected.serviceRevenue}
          profit={selected.serviceProfit}
          countLabel={`${selected.serviceCount} envío${selected.serviceCount === 1 ? '' : 's'}`}
          color="orange"
        />
        <MetricCard
          title="Total"
          icon={CircleDollarSign}
          revenue={totalRevenue}
          profit={totalProfit}
          countLabel={`${selected.orderCount + selected.serviceCount} operaciones`}
          color="emerald"
        />
      </div>

      <Card className="border-l-4 border-l-cyan-500 dark:bg-slate-950/50">
        <CardContent className="grid gap-5 p-6 sm:grid-cols-3">
          <div className="flex items-center gap-3">
            <Package className="h-8 w-8 text-blue-500" />
            <div><p className="text-xs text-muted-foreground">Ventas facturadas</p><p className="text-xl font-black">{money(selected.salesRevenue)}</p></div>
          </div>
          <div className="flex items-center gap-3">
            <Truck className="h-8 w-8 text-orange-500" />
            <div><p className="text-xs text-muted-foreground">Servicios facturados</p><p className="text-xl font-black">{money(selected.serviceRevenue)}</p></div>
          </div>
          <div className="flex items-center gap-3">
            <CircleDollarSign className="h-8 w-8 text-emerald-500" />
            <div><p className="text-xs text-muted-foreground">Ganancia total</p><p className="text-xl font-black text-emerald-500">{money(totalProfit)}</p></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
