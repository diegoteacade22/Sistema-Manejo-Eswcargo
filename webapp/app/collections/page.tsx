
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Plus, CreditCard, ArrowRight } from 'lucide-react'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Badge } from '@/components/ui/badge'

export default async function CollectionsPage() {
    // Fetch recent 'PAGO' transactions
    const collections = await prisma.transaction.findMany({
        where: {
            type: 'PAGO'
        },
        include: {
            client: true
        },
        orderBy: {
            date: 'desc'
        },
        take: 50 // Recent 50
    })

    return (
        <div className="p-8 space-y-8 animate-in fade-in duration-500">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
                        Cobranzas
                    </h1>
                    <p className="text-muted-foreground mt-1">Gestión de pagos recibidos e imputaciones.</p>
                </div>
                <Button asChild className="bg-emerald-600 hover:bg-emerald-700">
                    <Link href="/collections/new">
                        <Plus className="mr-2 h-4 w-4" /> Nueva Cobranza
                    </Link>
                </Button>
            </div>

            <div className="rounded-md border bg-card text-card-foreground shadow-sm">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Fecha</TableHead>
                            <TableHead>Cliente</TableHead>
                            <TableHead>Método</TableHead>
                            <TableHead>Detalle</TableHead>
                            <TableHead className="text-right">Importe</TableHead>
                            <TableHead className="w-[50px]"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {collections.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center">
                                    No hay cobranzas registradas recientemente.
                                </TableCell>
                            </TableRow>
                        ) : (
                            collections.map((tx) => (
                                <TableRow key={tx.id} className="hover:bg-muted/50">
                                    <TableCell className="font-medium">
                                        {new Date(tx.date).toLocaleDateString()}
                                    </TableCell>
                                    <TableCell>
                                        <Link href={`/clients/${tx.clientId}`} className="hover:underline font-medium">
                                            {tx.client.name}
                                        </Link>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className="font-normal bg-slate-100 dark:bg-slate-800">
                                            {tx.paymentMethod || 'General'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
                                        {tx.description}
                                    </TableCell>
                                    <TableCell className="text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(tx.amount))}
                                    </TableCell>
                                    <TableCell>
                                        {/* More actions could go here */}
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    )
}
