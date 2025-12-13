
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
    Wrench,
    PlusCircle
} from 'lucide-react';
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

const routes = [
    {
        label: 'Dashboard',
        icon: LayoutDashboard,
        href: '/',
        color: 'text-sky-500',
    },
    {
        label: 'Envíos',
        icon: Plane,
        href: '/shipments',
        color: 'text-fuchsia-500',
    },
    {
        label: 'Clientes',
        icon: Users,
        href: '/clients',
        color: 'text-violet-500',
    },
    {
        label: 'Artículos',
        icon: Package,
        href: '/products',
        color: 'text-cyan-500',
    },
    {
        label: 'Pedidos',
        icon: ShoppingCart,
        href: '/orders',
        color: 'text-pink-700',
    },
    {
        label: 'Proveedores',
        icon: Truck,
        href: '/suppliers',
        color: 'text-orange-600',
    },
    {
        label: 'Mantenimiento',
        icon: Wrench,
        href: '/maintenance',
        color: 'text-slate-500',
    },
    {
        label: 'Nueva Venta',
        icon: PlusCircle,
        href: '/orders/new',
        color: 'text-emerald-500',
    },
];

export function Sidebar() {
    const pathname = usePathname();
    const { setTheme, theme, resolvedTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    // Avoid hydration mismatch
    useEffect(() => {
        setMounted(true);
    }, []);

    return (
        <div className="space-y-4 py-4 flex flex-col h-full bg-slate-900 text-white">
            <div className="px-3 py-2 flex-1">
                <Link href="/" className="flex items-center pl-3 mb-14">
                    <div className="relative w-8 h-8 mr-4">
                        {/* Logo placeholder */}
                        <div className="absolute bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-lg w-full h-full flex items-center justify-center font-bold text-xl">
                            I
                        </div>
                    </div>
                    <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-cyan-400">
                        ImportSys
                    </h1>
                </Link>
                <div className="space-y-1">
                    {routes.map((route) => (
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
                    <div className="flex items-center gap-x-2">
                        <div className="h-8 w-8 rounded-full bg-indigo-500 flex items-center justify-center text-sm font-bold">DR</div>
                        <div className="text-sm">
                            <p className="font-medium text-white">Diego R.</p>
                            <p className="text-xs text-zinc-500">Admin</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
