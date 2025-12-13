
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Plus, UserCircle } from 'lucide-react';
import { SearchInput } from '@/components/search-input';
import { Suspense } from 'react';

import { ArrowUpDown } from 'lucide-react';
import { EditClientDialog } from '@/components/edit-client-dialog';

async function getClients(query: string, sortOrder: string) {
    const clients = await prisma.client.findMany({
        where: {
            OR: [
                { name: { contains: query } },
                { email: { contains: query } }
            ]
        },
        orderBy: { name: 'asc' },
        include: {
            transactions: true
        }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clientsWithBalance = clients.map((client: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const balance = client.transactions.reduce((acc: any, t: any) => acc + t.amount, 0);
        return {
            ...client,
            balance
        };
    });

    if (sortOrder === 'balance_desc') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return clientsWithBalance.sort((a: any, b: any) => b.balance - a.balance);
    } else if (sortOrder === 'balance_asc') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return clientsWithBalance.sort((a: any, b: any) => a.balance - b.balance);
    }

    return clientsWithBalance;
}

export default async function ClientsPage(props: { searchParams: Promise<{ q?: string, sort?: string }> }) {
    const searchParams = await props.searchParams;
    const query = searchParams?.q || '';
    const sort = searchParams?.sort || '';
    const clients = await getClients(query, sort);

    const toggleSort = sort === 'balance_desc' ? 'balance_asc' : 'balance_desc';

    return (
        <div className="p-8 space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">
                        Clientes
                    </h2>
                    <p className="text-muted-foreground mt-1">Gestión de cartera y cuentas corrientes</p>
                </div>
                <EditClientDialog
                    mode="create"
                    trigger={
                        <Button className="bg-violet-600 hover:bg-violet-700 text-white shadow-lg shadow-violet-200">
                            <Plus className="mr-2 h-4 w-4" /> Nuevo Cliente
                        </Button>
                    }
                />
            </div>

            <Card className="border-t-4 border-t-violet-500 shadow-lg">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <Suspense fallback={<div>Cargando buscador...</div>}>
                            <SearchInput placeholder="Buscar cliente..." />
                        </Suspense>
                        <div className="text-sm text-muted-foreground">
                            {clients.length} clientes registrados
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="w-[300px]">Nombre</TableHead>
                                <TableHead>Contacto</TableHead>
                                <TableHead className="text-right">
                                    <Link href={`/clients?q=${query}&sort=${toggleSort}`} className="flex items-center justify-end hover:text-violet-600">
                                        Saldo (Deuda)
                                        <ArrowUpDown className="ml-2 h-4 w-4" />
                                    </Link>
                                </TableHead>
                                <TableHead className="w-[100px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {clients.map((client: any) => (
                                <TableRow key={client.id} className="hover:bg-muted/50 transition-colors cursor-pointer dark:border-slate-800">
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            <div className="h-9 w-9 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-violet-700 dark:text-violet-300">
                                                <UserCircle className="h-5 w-5" />
                                            </div>
                                            <div className="font-medium text-slate-900 dark:text-slate-100">{client.name}</div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col text-sm">
                                            <span>{client.email || '-'}</span>
                                            <span className="text-muted-foreground text-xs">{client.phone}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <span className={`font-bold px-3 py-1 rounded-full text-xs ${client.balance > 0
                                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                            }`}>
                                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(client.balance)}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <EditClientDialog mode="edit" client={client} />
                                            <Button variant="ghost" size="sm" asChild className="hover:text-violet-600 hover:bg-violet-50">
                                                <Link href={`/clients/${client.id}`}>Ver Cuenta</Link>
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {clients.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                                        No se encontraron clientes con "{query}".
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}


