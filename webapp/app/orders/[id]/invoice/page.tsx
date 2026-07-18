
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import InvoiceTemplate from './invoice-template';
import { auth } from '@/lib/auth';
import type { Metadata } from 'next';
import { toInvNumber4 } from '@/lib/inv-filename';
import { DocumentBlocked } from '@/components/document-blocked';
import { getSourceDocumentBlock, sourceBlockMessage } from '@/lib/source-document-guard';

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
    const params = await props.params;
    const id = parseInt(params.id);

    if (isNaN(id)) {
        return { title: 'INV 0000' };
    }

    const order = await prisma.order.findUnique({
        where: { id },
        select: { id: true, order_number: true }
    });

    const invNumber = toInvNumber4(order?.order_number, order?.id ?? id);
    return { title: `INV ${invNumber}` };
}

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

    const sourceBlock = await getSourceDocumentBlock('ORDER', order.order_number);
    if (sourceBlock) {
        return (
            <DocumentBlocked
                title="Invoice bloqueado"
                detail={sourceBlockMessage(sourceBlock)}
                backHref={`/orders/${order.id}`}
                backLabel="Volver al pedido"
            />
        );
    }

    if (!order.items.length || Number(order.total_amount || 0) <= 0) {
        return (
            <DocumentBlocked
                title="Invoice bloqueado"
                detail="El pedido no tiene productos confirmados o un total válido para emitir el documento."
                backHref={`/orders/${order.id}`}
                backLabel="Volver al pedido"
            />
        );
    }

    return <InvoiceTemplate order={order} />;
}
