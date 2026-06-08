
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import InvoiceTemplate from './invoice-template';

export default async function InvoicePage(props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const id = parseInt(params.id);

    if (isNaN(id)) {
        return notFound();
    }

    const order = await prisma.order.findUnique({
        where: { id },
        include: {
            client: true,
            items: {
                include: {
                    // We might need product details if item.productName is empty, but seed_orders populates it.
                    // Include it anyway for robustness
                    // Note: schema relations must exist.
                    // The seed script used `prisma.product.findFirst`, so relation might check `productId`.
                    // Let's check if 'product' relation exists in schema.
                }
            }
        }
    });

    if (!order) {
        return notFound();
    }

    // Check if items have product relation in schema, otherwise just use what we have.
    // The previous template expects items to have product? or just fields.
    // In seed, we created OrderItem with productId. Let's assume relation exists or we rely on flattened fields.
    // I'll cast it to any if needed or fetch what is standard.
    // Ideally I'd check schema.prisma, but based on seed, OrderItem has productId.

    // Just pass order. Prisma types will flow if matching.
    // The Template expects: items: (OrderItem & { product?: Product | null })[]
    // So I should include product in query.

    const orderWithProduct = await prisma.order.findUnique({
        where: { id },
        include: {
            client: true,
            items: {
                // Try to include product if relation exists
                // relation is likely named 'product' based on standard naming
            }
        }
    });

    // Actually, let's verify schema for 'product' relation on OrderItem.
    // I'll read schema briefly to be sure.
    // If I can't read it now, I'll guess 'product' or 'Product'.
}
