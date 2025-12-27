
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
    LayoutDashboard,
    Users,
    Package,
    ShoppingCart,
    Truck,
    Plane,
    Moon,
    Sun,
    DollarSign,
    Wrench,
    PlusCircle,
    LogOut,
    ChevronRight,
    Briefcase
} from 'lucide-react';
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";

interface Route {
    label: string;
    icon: any;
    href: string;
    color: string;
    roles: string[];
}

interface RouteGroup {
    label: string;
    icon: any;
    routes: Route[];
    roles: string[];
}

const groups: RouteGroup[] = [
    {
        label: 'Operaciones',
        icon: Truck,
        roles: ['ADMIN'],
        routes: [
            { label: 'Mis Envíos', icon: Plane, href: '/shipments', color: 'text-fuchsia-500', roles: ['ADMIN'] },
            { label: 'Artículos', icon: Package, href: '/products', color: 'text-cyan-500', roles: ['ADMIN'] },
            { label: 'Proveedores', icon: Truck, href: '/suppliers', color: 'text-orange-600', roles: ['ADMIN'] },
            { label: 'BI: Logística', icon: Truck, href: '/analytics/logistics', color: 'text-orange-400', roles: ['ADMIN'] },
        ]
    },
    {
        label: 'Comercial',
        icon: ShoppingCart,
        roles: ['ADMIN'],
        routes: [
            { label: 'Clientes', icon: Users, href: '/clients', color: 'text-violet-500', roles: ['ADMIN'] },
            { label: 'Nueva Venta', icon: PlusCircle, href: '/orders/new', color: 'text-emerald-500', roles: ['ADMIN'] },
            { label: 'Mis Pedidos', icon: ShoppingCart, href: '/orders', color: 'text-pink-700', roles: ['ADMIN'] },
            { label: 'BI: Comercial', icon: Users, href: '/analytics/sales', color: 'text-indigo-400', roles: ['ADMIN'] },
        ]
    },
    {
        label: 'Finanzas',
        icon: DollarSign,
        roles: ['ADMIN'],
        routes: [
            { label: 'BI: Financiero', icon: DollarSign, href: '/analytics/financial', color: 'text-emerald-400', roles: ['ADMIN'] },
            { label: 'Gastos', icon: PlusCircle, href: '/expenses', color: 'text-red-400', roles: ['ADMIN'] },
            { label: 'Cobranzas', icon: DollarSign, href: '/collections', color: 'text-emerald-500', roles: ['ADMIN'] },
        ]
    }
];

const standaloneRoutes: Route[] = [
    {
        label: 'Dashboard',
        icon: LayoutDashboard,
        href: '/',
        color: 'text-sky-500',
        roles: ['ADMIN', 'CLIENT']
    },
    {
        label: 'Mis Envíos',
        icon: Plane,
        href: '/shipments',
        color: 'text-fuchsia-500',
        roles: ['CLIENT']
    },
    {
        label: 'Mis Pedidos',
        icon: ShoppingCart,
        href: '/orders',
        color: 'text-pink-700',
        roles: ['CLIENT']
    }
];

function NavGroup({ group, pathname }: { group: RouteGroup, pathname: string }) {
    const [isHovered, setIsHovered] = useState(false);
    const hasActiveRoute = group.routes.some(r => r.href === pathname);

    return (
        <div
            className="relative"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div className={cn(
                "text-sm group flex p-3 w-full justify-start font-medium cursor-pointer hover:text-white hover:bg-white/10 rounded-lg transition",
                hasActiveRoute ? "text-white bg-white/5" : "text-zinc-400"
            )}>
                <div className="flex items-center flex-1">
                    <group.icon className={cn("h-5 w-5 mr-3 text-slate-400")} />
                    {group.label}
                </div>
                <ChevronRight className={cn("h-4 w-4 transition-transform", isHovered ? "rotate-90" : "")} />
            </div>

            <div className={cn(
                "overflow-hidden transition-all duration-300 ease-in-out pl-4 space-y-1",
                isHovered ? "max-h-[500px] opacity-100 mt-1" : "max-h-0 opacity-0"
            )}>
                {group.routes.map((route) => (
                    <Link
                        key={route.href}
                        href={route.href}
                        className={cn(
                            "text-xs group flex p-2 w-full justify-start font-medium cursor-pointer hover:text-white hover:bg-white/10 rounded-md transition border-l border-white/5 ml-2",
                            pathname === route.href ? "text-white bg-white/10" : "text-zinc-500"
                        )}
                    >
                        <div className="flex items-center flex-1">
                            <route.icon className={cn("h-4 w-4 mr-2", route.color)} />
                            {route.label}
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}

export function Sidebar() {
    const pathname = usePathname();
    const { setTheme, resolvedTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    const { data: session } = useSession();

    useEffect(() => {
        setMounted(true);
    }, []);

    const userRole = (session?.user as any)?.role || 'CLIENT';
    const filteredStandalone = standaloneRoutes.filter(route => route.roles.includes(userRole));
    const filteredGroups = groups.filter(group => group.roles.includes(userRole));

    return (
        <div className="space-y-4 py-4 flex flex-col h-full bg-[#0a0a0c] text-white border-r border-white/5 shadow-2xl">
            <div className="px-3 py-2 flex-1">
                <Link href="/" className="flex items-center pl-3 mb-10 group">
                    <div className="relative w-10 h-10 mr-3">
                        <div className="absolute bg-gradient-to-tr from-indigo-500 to-purple-600 rounded-xl w-full h-full flex items-center justify-center font-bold text-xl shadow-lg group-hover:scale-105 transition-transform">
                            {userRole === 'ADMIN' ? 'A' : (session?.user?.name?.[0] || 'C')}
                        </div>
                    </div>
                    <div className="flex flex-col">
                        <h1 className="text-lg font-black bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-cyan-400 tracking-tighter leading-tight">
                            {userRole === 'ADMIN' ? 'ImportSys' : 'Mi Portal'}
                        </h1>
                        <span className="text-[9px] uppercase tracking-[0.2em] font-bold text-slate-500 -mt-0.5">
                            {userRole === 'ADMIN' ? 'BI & LOGISTICS' : 'TRACKING'}
                        </span>
                    </div>
                </Link>

                <div className="space-y-1">
                    {/* Standalone items */}
                    {filteredStandalone.map((route) => (
                        <Link
                            key={route.href}
                            href={route.href}
                            className={cn(
                                "text-sm group flex p-3 w-full justify-start font-medium cursor-pointer hover:text-white hover:bg-white/10 rounded-lg transition",
                                pathname === route.href ? "text-white bg-white/10" : "text-zinc-400"
                            )}
                        >
                            <div className="flex items-center flex-1">
                                <route.icon className={cn("h-5 w-5 mr-3", route.color)} />
                                {route.label}
                            </div>
                        </Link>
                    ))}

                    {/* Grouped items for Admin */}
                    {filteredGroups.map((group) => (
                        <NavGroup key={group.label} group={group} pathname={pathname} />
                    ))}

                    {/* System item (Standalone) */}
                    {userRole === 'ADMIN' && (
                        <Link
                            href="/maintenance"
                            className={cn(
                                "text-sm group flex p-3 w-full justify-start font-medium cursor-pointer hover:text-white hover:bg-white/10 rounded-lg transition mt-4",
                                pathname === '/maintenance' ? "text-white bg-white/10" : "text-zinc-500"
                            )}
                        >
                            <div className="flex items-center flex-1">
                                <Wrench className="h-5 w-5 mr-3 text-slate-500" />
                                Mantenimiento
                            </div>
                        </Link>
                    )}
                </div>
            </div>

            <div className="px-3 py-2 space-y-4">
                {mounted && (
                    <Button
                        variant="ghost"
                        className="w-full justify-start text-zinc-500 hover:text-white hover:bg-white/10 h-10 rounded-xl"
                        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                    >
                        {resolvedTheme === "dark" ? (
                            <><Sun className="h-4 w-4 mr-3 text-yellow-500" /> Modo Claro</>
                        ) : (
                            <><Moon className="h-4 w-4 mr-3 text-indigo-400" /> Modo Oscuro</>
                        )}
                    </Button>
                )}

                <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                    <div className="flex items-center gap-x-3 mb-4">
                        <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-sm font-bold shadow-lg">
                            {session?.user?.name?.[0] || 'U'}
                        </div>
                        <div className="text-sm">
                            <p className="font-bold text-white truncate max-w-[120px]">
                                {session?.user?.name || 'Usuario'}
                            </p>
                            <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-tighter">{userRole}</p>
                        </div>
                    </div>
                    <Button
                        variant="destructive"
                        size="sm"
                        className="w-full bg-red-500/10 hover:bg-red-500 hover:text-white border border-red-500/20 text-red-500 h-9 rounded-xl font-bold transition-all"
                        onClick={() => signOut({ callbackUrl: '/login' })}
                    >
                        <LogOut className="h-4 w-4 mr-2" />
                        Salir
                    </Button>
                </div>
            </div>
        </div>
    );
}
