
import { prisma } from '@/lib/prisma';
import NewOrderForm from '@/app/orders/new/new-order-form';

export default async function NewOrderPage() {
    // Fetch data for dropdowns
    // In a real app with many items, we should use async search API rather than dumping all.
    // But for <2000 items it's often acceptable for V1 local app.

    const clients = await prisma.client.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' }
    });

    const products = await prisma.product.findMany({
        select: { id: true, name: true, sku: true, lp1: true, last_purchase_cost: true, color_grade: true },
        // User said they don't track internal stock, so show all items.
        orderBy: { name: 'asc' }
    });

    return (
        <div className="p-8 space-y-8">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-3xl font-bold tracking-tight text-foreground mb-8">Nueva Venta</h1>
                <NewOrderForm clients={clients} products={products} />
            </div>
        </div>
    );
}
