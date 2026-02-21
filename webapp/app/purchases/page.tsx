import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Eye } from 'lucide-react';

function getStatus(totalQty: number, allocatedQty: number) {
  if (allocatedQty <= 0) return 'ABIERTA';
  if (allocatedQty >= totalQty) return 'CERRADA';
  return 'PARCIAL';
}

export default async function PurchasesPage() {
  const purchases = await (prisma as any).purchase.findMany({
    include: {
      supplier: { select: { name: true } },
      items: {
        include: {
          allocations: {
            select: { quantity: true }
          }
        }
      }
    },
    orderBy: { date: 'desc' }
  });

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Compras</h1>
          <p className="text-muted-foreground">Registra compras por proveedor y asigna parcialmente a clientes.</p>
        </div>
        <Button asChild className="bg-orange-600 hover:bg-orange-700 text-white">
          <Link href="/purchases/new"><Plus className="mr-2 h-4 w-4" /> Nueva Compra</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4">Compra</th>
                  <th className="py-2 pr-4">Fecha</th>
                  <th className="py-2 pr-4">Proveedor</th>
                  <th className="py-2 pr-4">Invoice</th>
                  <th className="py-2 pr-4">Total ítems</th>
                  <th className="py-2 pr-4">Asignado</th>
                  <th className="py-2 pr-4">Pendiente</th>
                  <th className="py-2 pr-4">Estado</th>
                  <th className="py-2 pr-4">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((purchase: any) => {
                  const totalQty = purchase.items.reduce((sum: number, item: any) => sum + item.quantity, 0);
                  const allocatedQty = purchase.items.reduce(
                    (sum: number, item: any) => sum + item.allocations.reduce((acc: number, allocation: any) => acc + allocation.quantity, 0),
                    0
                  );
                  const pendingQty = totalQty - allocatedQty;
                  const status = getStatus(totalQty, allocatedQty);

                  return (
                    <tr key={purchase.id} className="border-t">
                      <td className="py-2 pr-4 font-semibold">#{purchase.id}</td>
                      <td className="py-2 pr-4">{new Date(purchase.date).toLocaleDateString()}</td>
                      <td className="py-2 pr-4">{purchase.supplier.name}</td>
                      <td className="py-2 pr-4">{purchase.invoice_number || '—'}</td>
                      <td className="py-2 pr-4">{totalQty}</td>
                      <td className="py-2 pr-4">{allocatedQty}</td>
                      <td className="py-2 pr-4">{pendingQty}</td>
                      <td className="py-2 pr-4">
                        <Badge className={status === 'CERRADA' ? 'bg-emerald-600' : status === 'PARCIAL' ? 'bg-amber-600' : 'bg-slate-600'}>
                          {status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/purchases/${purchase.id}`}><Eye className="h-4 w-4" /></Link>
                        </Button>
                      </td>
                    </tr>
                  );
                })}

                {purchases.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center py-10 text-muted-foreground">
                      No hay compras registradas todavía.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
