
import { prisma } from '@/lib/prisma';
import NewOrderForm from '@/app/orders/new/new-order-form';

export default async function NewOrderPage() {
    // Fetch data for dropdowns
    const clients = await prisma.client.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' }
    });

    const rawProducts = await prisma.product.findMany({
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
            },
            _count: {
                select: { orderItems: true }
            }
        },
        orderBy: {
            orderItems: {
                _count: 'desc'
            }
        }
    });

    const products = rawProducts.map(p => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        lp1: p.lp1,
        last_purchase_cost: p.last_purchase_cost,
        color_grade: p.color_grade,
        last_sale_price: p.orderItems[0]?.unit_price || null
    }));

    const suppliers = await prisma.supplier.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' }
    });

    const shipments = await (prisma as any).shipment.findMany({
        select: { id: true, shipment_number: true, forwarder: true },
        orderBy: { shipment_number: 'desc' },
        take: 50 // Provide recent 50 shipments to choose from
    });

    return (
        <div className="p-8 space-y-8">
            <div className="max-w-[95%] mx-auto">
                <h1 className="text-3xl font-bold tracking-tight text-foreground mb-8">Nueva Venta</h1>
                <NewOrderForm clients={clients} products={products} suppliers={suppliers} shipments={shipments} />
            </div>
        </div>
    );
}
