'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClipboardList, CreditCard, LayoutDashboard, PackagePlus, Plane, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

type MobileNavProps = {
  role?: string | null;
};

const adminRoutes = [
  { href: '/', label: 'Inicio', icon: LayoutDashboard },
  { href: '/clients', label: 'Clientes', icon: Users },
  { href: '/orders/new', label: 'Venta', icon: PackagePlus },
  { href: '/collections', label: 'Cobros', icon: CreditCard },
  { href: '/shipments', label: 'Envíos', icon: Plane },
];

const clientRoutes = [
  { href: '/', label: 'Inicio', icon: LayoutDashboard },
  { href: '/orders', label: 'Pedidos', icon: ClipboardList },
  { href: '/shipments', label: 'Envíos', icon: Plane },
  { href: '/payments', label: 'Pagos', icon: CreditCard },
];

export function MobileNav({ role }: MobileNavProps) {
  const pathname = usePathname();
  const routes = role === 'ADMIN' ? adminRoutes : clientRoutes;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-[90] grid h-16 border-t border-slate-800 bg-slate-950/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden" style={{ gridTemplateColumns: `repeat(${routes.length}, minmax(0, 1fr))` }} aria-label="Navegación móvil">
      {routes.map((route) => {
        const active = pathname === route.href || (route.href !== '/' && pathname.startsWith(`${route.href}/`));
        const Icon = route.icon;
        return (
          <Link key={route.href} href={route.href} className={cn('flex min-w-0 flex-col items-center justify-center gap-1 text-[10px] font-semibold', active ? 'text-cyan-300' : 'text-slate-400')}>
            <Icon className={cn('h-5 w-5', active && 'text-cyan-300')} />
            <span className="max-w-full truncate px-1">{route.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
