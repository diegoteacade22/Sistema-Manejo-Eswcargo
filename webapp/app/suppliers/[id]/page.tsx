import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Package, Calendar, DollarSign, Mail, Phone, MapPin } from 'lucide-react';

interface Props {
    params: Promise<{ id: string }>;
}

async function getSupplierDetails(id: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supplier = await (prisma as any).supplier.findUnique({
        where: { id: parseInt(id) },
        include: {
            orderItems: {
                include: {
                    order: true,
                    product: true
                },
                orderBy: {
                    id: 'desc'
                }
            },
            purchases: {
                include: {
                    items: true
                },
                orderBy: {
                    date: 'desc'
                }
            },
            transactions: {
                orderBy: {
                    date: 'desc'
                }
            }
        }
    });

    return supplier;
}

export default async function SupplierDetailsPage(props: Props) {
    const params = await props.params;
    const supplier = await getSupplierDetails(params.id);

    if (!supplier) {
        notFound();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const totalItems = supplier.orderItems.reduce((acc: number, item: any) => acc + item.quantity, 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const totalSalesValue = supplier.orderItems.reduce((acc: number, item: any) => acc + (item.quantity * item.unit_price), 0);

    return (
        <div className="p-8 space-y-8 max-w-6xl mx-auto">
            <div className="flex items-center space-x-4">
                <Button variant="ghost" size="sm" asChild>
                    <Link href="/suppliers">
                        <ArrowLeft className="mr-2 h-4 w-4" /> Volver
                    </Link>
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Supplier Info */}
                <Card className="md:col-span-1 h-fit shadow-md border-t-4 border-t-fuchsia-600">
                    <CardHeader>
                        <CardTitle className="text-xl">{supplier.name}</CardTitle>
                        <CardDescription>Información del Proveedor</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {supplier.contact && (
                            <div className="flex items-center gap-2 text-sm">
                                <UserIcon className="h-4 w-4 text-muted-foreground" />
                                <span className="font-medium">{supplier.contact}</span>
                            </div>
                        )}
                        {supplier.email && (
                            <div className="flex items-center gap-2 text-sm">
                                <Mail className="h-4 w-4 text-muted-foreground" />
                                <a href={`mailto:${supplier.email}`} className="hover:underline text-blue-600">
                                    {supplier.email}
                                </a>
                            </div>
                        )}
                        {supplier.phone && (
                            <div className="flex items-center gap-2 text-sm">
                                <Phone className="h-4 w-4 text-muted-foreground" />
                                <span>{supplier.phone}</span>
                            </div>
                        )}
                        {supplier.address && (
                            <div className="flex items-center gap-2 text-sm">
                                <MapPin className="h-4 w-4 text-muted-foreground" />
                                <span>{supplier.address}</span>
                            </div>
                        )}

                        <div className="pt-4 border-t mt-4 space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Items Suministrados:</span>
                                <span className="font-bold">{totalItems}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Volumen Ventas:</span>
                                <span className="font-bold text-emerald-600">
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalSalesValue)}
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Supplier Balance (Should be 0) */}
                <Card className="md:col-span-1 h-fit shadow-md border-t-4 border-t-emerald-500">
                    <CardHeader>
                        <CardTitle className="text-xl">Cuenta Corriente</CardTitle>
                        <CardDescription>Resumen de Pagos</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="text-3xl font-bold text-center py-2">
                            $0.00
                        </div>
                        <p className="text-xs text-center text-muted-foreground italic">
                            Los pagos se registran automáticamente al momento de la compra.
                        </p>
                        <div className="pt-4 border-t mt-4 space-y-2">
                            <div className="flex justify-between text-xs">
                                <span className="text-muted-foreground">Total Comprado:</span>
                                <span className="font-bold text-red-600">
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                                        Math.abs(supplier.transactions.filter((t: any) => t.type === 'CARGO').reduce((acc: number, t: any) => acc + t.amount, 0))
                                    )}
                                </span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-muted-foreground">Total Pagado:</span>
                                <span className="font-bold text-emerald-600">
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                                        supplier.transactions.filter((t: any) => t.type === 'PAGO').reduce((acc: number, t: any) => acc + t.amount, 0)
                                    )}
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Purchases History */}
                <Card className="md:col-span-2 shadow-md border-t-4 border-t-amber-500">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <DollarSign className="h-5 w-5 text-amber-600" />
                            Historial de Compras (Planilla)
                        </CardTitle>
                        <CardDescription>Registro de facturas de compra y pagos automáticos al proveedor.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Invoice #</TableHead>
                                    <TableHead>Items</TableHead>
                                    <TableHead className="text-right">Monto USD</TableHead>
                                    <TableHead>Método</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {supplier.purchases.map((p: any) => (
                                    <TableRow key={p.id}>
                                        <TableCell className="text-sm font-medium">
                                            {p.date ? new Date(p.date).toLocaleDateString() : '-'}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs text-blue-600">
                                            {p.invoice_number}
                                        </TableCell>
                                        <TableCell className="text-sm">
                                            <div className="flex flex-col">
                                                {p.items.slice(0, 2).map((it: any) => (
                                                    <span key={it.id} className="text-[10px] text-muted-foreground truncate max-w-[150px]">
                                                        {it.quantity}x {it.productName}
                                                    </span>
                                                ))}
                                                {p.items.length > 2 && (
                                                    <span className="text-[10px] italic">+{p.items.length - 2} más...</span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right font-bold text-amber-700">
                                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(p.total_amount)}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="text-[10px] bg-amber-50">
                                                {p.payment_method || 'N/A'}
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {supplier.purchases.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground italic">
                                            No hay registros de compra en la planilla.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                {/* Financial Ledger (Transactions) */}
                <Card className="md:col-span-2 shadow-md">
                    <CardHeader className="bg-slate-100 dark:bg-slate-800/50">
                        <CardTitle className="flex items-center gap-2">
                            <HistoryIcon className="h-5 w-5 text-slate-600" />
                            Libro Diario / Ledger (Proveedor)
                        </CardTitle>
                        <CardDescription>Resumen de cargos (compras) y abonos (pagos) para este proveedor.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Concepto</TableHead>
                                    <TableHead className="text-right">Monto</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {supplier.transactions && supplier.transactions.length > 0 ? (
                                    supplier.transactions.map((tx: any) => (
                                        <TableRow key={tx.id}>
                                            <TableCell className="text-xs font-mono">
                                                {tx.date ? new Date(tx.date).toLocaleDateString() : '-'}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-medium">{tx.description}</span>
                                                    <span className="text-[10px] text-muted-foreground">{tx.reference}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className={`text-right font-bold font-mono ${tx.amount < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                                {tx.amount > 0 ? '+' : ''}{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(tx.amount)}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={3} className="text-center py-8 text-muted-foreground italic">
                                            Sin transacciones financieras registradas.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        </div >
    );
}

function UserIcon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
        </svg>
    )
}

function HistoryIcon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 12" />
            <path d="M3 3v9h9" />
            <path d="M12 7v5l4 2" />
        </svg>
    )
}
