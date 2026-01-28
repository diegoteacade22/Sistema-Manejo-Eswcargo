

import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Plus, UserCircle } from 'lucide-react';
import { SearchInput } from '@/components/search-input';
import { Suspense } from 'react';
import { EditClientDialogWrapper as EditClientDialog } from '@/components/edit-client-dialog-wrapper';
import { SortableColumn, SortOrder } from '@/components/ui/sortable-column';


async function getClients(query: string, sortField: string = 'operations', sortOrder: SortOrder = 'desc') {
    let orderBy: any = {};
    if (sortField === 'name') orderBy = { name: sortOrder };
    else if (sortField === 'email') orderBy = { email: sortOrder };
    else if (sortField === 'id') orderBy = { id: sortOrder };
    else if (sortField === 'operations') orderBy = { orders: { _count: sortOrder } };
    else if (sortField !== 'balance') orderBy = { orders: { _count: 'desc' } }; // Default

    // 'balance' is handled in memory

    const clients = await prisma.client.findMany({
        where: {
            OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { email: { contains: query, mode: 'insensitive' } },
                { id: !isNaN(Number(query)) ? Number(query) : undefined } // Allow search by ID
            ]
        },
        orderBy: sortField !== 'balance' ? orderBy : { name: 'asc' },
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

    if (sortField === 'balance') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        clientsWithBalance.sort((a: any, b: any) => {
            return sortOrder === 'asc' ? a.balance - b.balance : b.balance - a.balance;
        });
    }

    return clientsWithBalance;
}

export default async function ClientsPage(props: { searchParams: Promise<{ q?: string, sort?: string, order?: string }> }) {
    const searchParams = await props.searchParams;
    const query = searchParams?.q || '';
    const sort = searchParams?.sort || 'operations';
    const order = (searchParams?.order as SortOrder) || 'desc';

    const clients = await getClients(query, sort, order);

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
                                <SortableColumn className="w-[80px]" field="id" label="Código" currentSort={sort} currentOrder={order} query={query} baseUrl="/clients" />
                                <SortableColumn className="md:w-[200px]" field="name" label="Nombre" currentSort={sort} currentOrder={order} query={query} baseUrl="/clients" />
                                <SortableColumn className="w-[150px] md:w-[200px]" field="email" label="Contacto" currentSort={sort} currentOrder={order} query={query} baseUrl="/clients" />
                                <SortableColumn className="w-[120px]" field="balance" label="Saldo (Deuda)" currentSort={sort} currentOrder={order} query={query} baseUrl="/clients" alignRight />
                                <TableHead></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {clients.map((client: any) => (
                                <TableRow key={client.id} className="hover:bg-muted/50 transition-colors cursor-pointer dark:border-slate-800">
                                    <TableCell className="font-mono text-xs text-slate-400 font-bold">
                                        #{client.id}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            <div className="h-9 w-9 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center text-violet-700 dark:text-violet-200 shadow-sm shrink-0">
                                                <UserCircle className="h-5 w-5" />
                                            </div>
                                            <div className="font-bold text-white text-base truncate max-w-[150px] md:max-w-[250px]" title={client.name}>{client.name}</div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col text-sm text-slate-600 dark:text-slate-300 max-w-[140px] md:max-w-[220px]">
                                            <span className="font-medium truncate" title={client.email}>{client.email || '-'}</span>
                                            <span className="text-slate-500 dark:text-slate-500 text-xs truncate" title={client.phone}>{client.phone}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <span className={`font-black px-3 py-1 rounded-full text-sm font-mono whitespace-nowrap ${client.balance > 0
                                            ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200'
                                            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200'
                                            }`}>
                                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(client.balance)}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            {/* Pass a sanitized version of the client to avoid serializing transactions etc. */}
                                            <EditClientDialog
                                                mode="edit"
                                                client={{
                                                    id: client.id,
                                                    name: client.name,
                                                    document_id: client.document_id,
                                                    email: client.email,
                                                    phone: client.phone,
                                                    address: client.address,
                                                    city: client.city,
                                                    state: client.state,
                                                    country: client.country,
                                                    notes: client.notes,
                                                    canAccess: client.canAccess,
                                                    userId: client.userId
                                                }}
                                            />
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
