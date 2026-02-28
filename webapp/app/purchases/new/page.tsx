import { prisma } from '@/lib/prisma';
import { requireAdminUser } from '@/lib/access';
import NewPurchaseForm from '@/app/purchases/new/new-purchase-form';

export default async function NewPurchasePage() {
  await requireAdminUser();

  const suppliers = await prisma.supplier.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' }
  });

  const products = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      sku: true,
      lp1: true,
      last_purchase_cost: true,
      color_grade: true,
      orderItems: {
        take: 1,
        orderBy: { id: 'desc' },
        select: { unit_price: true }
      }
    },
    orderBy: { name: 'asc' }
  });

  const mappedProducts = products.map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku,
    lp1: product.lp1,
    last_purchase_cost: product.last_purchase_cost,
    color_grade: product.color_grade,
    last_sale_price: product.orderItems[0]?.unit_price ?? null,
  }));

  return (
    <div className="p-8 space-y-8">
      <div className="max-w-[95%] mx-auto">
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-8">Nueva Compra</h1>
        <NewPurchaseForm suppliers={suppliers} products={mappedProducts} />
      </div>
    </div>
  );
}
