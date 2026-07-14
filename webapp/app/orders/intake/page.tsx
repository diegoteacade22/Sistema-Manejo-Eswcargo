import { requireAdminUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import OrderIntakeClient from './order-intake-client';

export default async function OrderIntakePage() {
    await requireAdminUser();

    const [clients, rawProducts, shipments] = await Promise.all([
        prisma.client.findMany({
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        }),
        prisma.product.findMany({
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
                    select: { unit_price: true },
                },
            },
            orderBy: { sku: 'asc' },
        }),
        prisma.shipment.findMany({
            select: { shipment_number: true },
            where: { shipment_number: { not: null } },
            orderBy: { shipment_number: 'desc' },
            take: 100,
        }),
    ]);

    const products = rawProducts.map((product) => ({
        id: product.id,
        name: product.name,
        sku: product.sku,
        lp1: product.lp1,
        last_purchase_cost: product.last_purchase_cost,
        color_grade: product.color_grade,
        last_sale_price: product.orderItems[0]?.unit_price || null,
    }));

    return <OrderIntakeClient clients={clients} products={products} shipments={shipments.map((shipment) => shipment.shipment_number as number)} />;
}
