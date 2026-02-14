
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import InvoiceTemplate from './invoice-template';
import { auth } from '@/lib/auth';

export default async function InvoicePage(props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const id = parseInt(params.id);
    const session = await auth();

    if (!session?.user) {
        return notFound();
    }

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

    const role = (session.user as any).role;
    if (role !== 'ADMIN') {
        const userId = (session.user as any).id;
        const client = await prisma.client.findFirst({
            where: { userId },
            select: { id: true }
        });

        if (!client || order.clientId !== client.id) {
            return notFound();
        }
    }

    return <InvoiceTemplate order={order} />;
}
