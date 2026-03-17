import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requireAdminUser } from '@/lib/access';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PurchaseAssignmentPanel } from '@/app/purchases/[id]/purchase-assignment-panel';
import { MarkPurchasePaidButton } from '@/app/purchases/[id]/mark-purchase-paid-button';
import { RegisterPurchasePaymentButton } from '@/app/purchases/[id]/register-purchase-payment-button';

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminUser();

  const { id } = await params;
  const purchaseId = Number(id);

  if (Number.isNaN(purchaseId)) notFound();

  const [purchase, clients] = await Promise.all([
    (prisma as any).purchase.findUnique({
      where: { id: purchaseId },
      include: {
        supplier: { select: { name: true } },
        payments: {
          orderBy: { date: 'desc' },
          take: 5,
        },
        items: {
          include: {
            allocations: {
              include: {
                client: { select: { name: true } },
                order: { select: { id: true, order_number: true } },
                orderItem: { select: { status: true } }
              },
              orderBy: { createdAt: 'desc' }
            }
          },
          orderBy: { id: 'asc' }
        }
      }
    }),
    prisma.client.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' }
    })
  ]);

  if (!purchase) notFound();

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/purchases"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Compra #{purchase.id}</h1>
            <p className="text-muted-foreground">
              Proveedor: <span className="font-medium text-foreground">{purchase.supplier.name}</span> · Fecha: {new Date(purchase.date).toLocaleDateString()} · Invoice: {purchase.invoice_number || '—'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <RegisterPurchasePaymentButton purchaseId={purchase.id} balanceDue={purchase.balance_due || 0} />
          <MarkPurchasePaidButton purchaseId={purchase.id} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Estado financiero</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5 text-sm">
          <div>
            <p className="text-muted-foreground">Total compra</p>
            <p className="font-semibold">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(purchase.total_amount || 0)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Pagado</p>
            <p className="font-semibold text-emerald-700">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(purchase.paid_amount || 0)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Pendiente</p>
            <p className="font-semibold text-amber-700">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(purchase.balance_due || 0)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Vencimiento</p>
            <p className="font-semibold">{purchase.due_date ? new Date(purchase.due_date).toLocaleDateString() : '—'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Estado</p>
            <Badge className={purchase.payment_status === 'PAGADA' ? 'bg-emerald-600' : purchase.payment_status === 'PARCIAL' ? 'bg-amber-600' : 'bg-slate-600'}>
              {purchase.payment_status || 'PENDIENTE'}
            </Badge>
          </div>

          {purchase.payments?.length > 0 && (
            <div className="md:col-span-5">
              <p className="text-muted-foreground mb-1">Últimos pagos</p>
              <div className="text-xs space-y-1">
                {purchase.payments.map((payment: any) => (
                  <div key={payment.id} className="flex justify-between border rounded px-2 py-1">
                    <span>{new Date(payment.date).toLocaleDateString()} · {payment.payment_method || 'N/A'} · {payment.reference || 'sin ref'}</span>
                    <span className="font-semibold text-emerald-700">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(payment.amount || 0)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ítems y asignaciones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {purchase.items.map((item: any) => {
            const allocatedQty = item.allocations.reduce((sum: number, allocation: any) => sum + allocation.quantity, 0);
            const pendingQty = item.quantity - allocatedQty;

            return (
              <div key={item.id} className="rounded-lg border p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-foreground">{item.productName}</p>
                    <p className="text-sm text-muted-foreground">SKU: {item.sku || 'N/A'} · Costo unit.: {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.unit_cost)}</p>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant="outline">Comprado: {item.quantity}</Badge>
                    <Badge variant="outline">Asignado: {allocatedQty}</Badge>
                    <Badge className={pendingQty > 0 ? 'bg-amber-600' : 'bg-emerald-600'}>
                      Pendiente: {pendingQty}
                    </Badge>
                  </div>
                </div>

                <PurchaseAssignmentPanel
                  clients={clients}
                  item={{
                    id: item.id,
                    sku: item.sku,
                    productName: item.productName,
                    quantity: item.quantity,
                    unit_cost: item.unit_cost,
                    allocatedQty,
                  }}
                />

                <div className="space-y-2">
                  <p className="text-sm font-medium">Historial de asignación</p>
                  {item.allocations.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sin asignaciones aún.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-left text-muted-foreground">
                          <tr>
                            <th className="py-1 pr-3">Fecha</th>
                            <th className="py-1 pr-3">Cliente</th>
                            <th className="py-1 pr-3">Cantidad</th>
                            <th className="py-1 pr-3">Precio</th>
                            <th className="py-1 pr-3">Estado</th>
                            <th className="py-1 pr-3">Pedido</th>
                          </tr>
                        </thead>
                        <tbody>
                          {item.allocations.map((allocation: any) => (
                            <tr key={allocation.id} className="border-t">
                              <td className="py-1 pr-3">{new Date(allocation.createdAt).toLocaleString()}</td>
                              <td className="py-1 pr-3">{allocation.client.name}</td>
                              <td className="py-1 pr-3">{allocation.quantity}</td>
                              <td className="py-1 pr-3">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(allocation.unit_price_snapshot)}</td>
                              <td className="py-1 pr-3">{allocation.orderItem.status || 'RESERVADO'}</td>
                              <td className="py-1 pr-3">
                                <Link href={`/orders/${allocation.order.id}`} className="text-orange-600 hover:underline">
                                  #{allocation.order.order_number || allocation.order.id}
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
