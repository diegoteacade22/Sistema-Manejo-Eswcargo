
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
    LogOut
} from 'lucide-react';
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";

const routes = [
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
        roles: ['ADMIN', 'CLIENT']
    },
    {
        label: 'Mis Pedidos',
        icon: ShoppingCart,
        href: '/orders',
        color: 'text-pink-700',
        roles: ['ADMIN', 'CLIENT']
    },
    {
        label: 'Clientes',
        icon: Users,
        href: '/clients',
        color: 'text-violet-500',
        roles: ['ADMIN']
    },
    {
        label: 'Cobranzas',
        icon: DollarSign,
        href: '/collections',
        color: 'text-emerald-500',
        roles: ['ADMIN']
    },
    {
        label: 'Artículos',
        icon: Package,
        href: '/products',
        color: 'text-cyan-500',
        roles: ['ADMIN']
    },
    {
        label: 'Proveedores',
        icon: Truck,
        href: '/suppliers',
        color: 'text-orange-600',
        roles: ['ADMIN']
    },
    {
        label: 'Mantenimiento',
        icon: Wrench,
        href: '/maintenance',
        color: 'text-slate-500',
        roles: ['ADMIN']
    },
    {
        label: 'Nueva Venta',
        icon: PlusCircle,
        href: '/orders/new',
        color: 'text-emerald-500',
        roles: ['ADMIN']
    },
];

export function Sidebar() {
    const pathname = usePathname();
    const { setTheme, resolvedTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    const { data: session } = useSession();

    // Avoid hydration mismatch
    useEffect(() => {
        setMounted(true);
    }, []);

    const userRole = (session?.user as any)?.role || 'CLIENT';
    const filteredRoutes = routes.filter(route => route.roles.includes(userRole));

    return (
        <div className="space-y-4 py-4 flex flex-col h-full bg-slate-900 text-white">
            <div className="px-3 py-2 flex-1">
                <Link href="/" className="flex items-center pl-3 mb-14 group">
                    <div className="relative w-10 h-10 mr-4">
                        <div className="absolute bg-gradient-to-tr from-indigo-500 to-purple-600 rounded-xl w-full h-full flex items-center justify-center font-bold text-xl shadow-lg group-hover:scale-105 transition-transform">
                            {userRole === 'ADMIN' ? 'A' : (session?.user?.name?.[0] || 'C')}
                        </div>
                    </div>
                    <div className="flex flex-col">
                        <h1 className="text-xl font-black bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-cyan-400 tracking-tighter leading-tight">
                            {userRole === 'ADMIN' ? 'ImportSys' : 'Mi Portal'}
                        </h1>
                        <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-500 -mt-0.5">
                            {userRole === 'ADMIN' ? 'Control Panel' : 'Gestión Internacional'}
                        </span>
                    </div>
                </Link>
                <div className="space-y-1">
                    {filteredRoutes.map((route) => (
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
                </div>
            </div>
            <div className="px-3 py-2 space-y-4">
                {/* Theme Toggle */}
                {mounted && (
                    <Button
                        variant="ghost"
                        className="w-full justify-start text-zinc-400 hover:text-white hover:bg-white/10"
                        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                    >
                        {resolvedTheme === "dark" ? (
                            <>
                                <Sun className="h-5 w-5 mr-3 text-yellow-500" />
                                Modo Claro
                            </>
                        ) : (
                            <>
                                <Moon className="h-5 w-5 mr-3 text-indigo-400" />
                                Modo Oscuro
                            </>
                        )}
                    </Button>
                )}

                <div className="bg-white/5 rounded-xl p-4">
                    <h4 className="text-xs font-semibold text-zinc-400 mb-2">Usuario</h4>
                    <div className="flex items-center gap-x-2 mb-4">
                        <div className="h-8 w-8 rounded-full bg-indigo-500 flex items-center justify-center text-sm font-bold">
                            {session?.user?.name?.[0] || 'U'}
                        </div>
                        <div className="text-sm">
                            <p className="font-medium text-white truncate max-w-[120px]">
                                {session?.user?.name || 'Usuario'}
                            </p>
                            <p className="text-xs text-zinc-500 capitalize">{userRole.toLowerCase()}</p>
                        </div>
                    </div>
                    <Button
                        variant="destructive"
                        size="sm"
                        className="w-full bg-red-950/50 hover:bg-red-900 border border-red-900/50 text-red-500"
                        onClick={() => signOut({ callbackUrl: '/login' })}
                    >
                        <LogOut className="h-4 w-4 mr-2" />
                        Cerrar Sesión
                    </Button>
                </div>
            </div>
        </div>
    );
}
