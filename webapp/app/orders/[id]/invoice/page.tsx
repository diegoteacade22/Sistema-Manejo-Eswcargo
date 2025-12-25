
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
                    product: true
                },
                orderBy: {
                    productName: 'asc'
                }
            }
        }
    });

    if (!order) {
        return notFound();
    }

    return <InvoiceTemplate order={order} />;
}
