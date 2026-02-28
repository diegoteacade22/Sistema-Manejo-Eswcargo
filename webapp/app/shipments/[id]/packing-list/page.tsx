
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import PackingListTemplate from './packing-list-template';
import { auth } from '@/lib/auth';
import type { Metadata } from 'next';
import { toInvNumber4 } from '@/lib/inv-filename';

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
    const params = await props.params;
    const id = parseInt(params.id);

    if (isNaN(id)) {
        return { title: 'INV 0000' };
    }

    const shipment = await prisma.shipment.findUnique({
        where: { id },
        select: { id: true, shipment_number: true, invoice: true }
    });

    const invNumber = toInvNumber4(
        shipment?.invoice,
        shipment?.shipment_number || shipment?.id || id
    );

    return { title: `INV ${invNumber}` };
}

export default async function PackingListPage(props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const id = parseInt(params.id);
    const session = await auth();

    if (!session?.user) {
        return notFound();
    }

    if (isNaN(id)) {
        return notFound();
    }

    const shipment = await prisma.shipment.findUnique({
        where: { id },
        include: {
            client: true,
            items: {
                include: {
                    product: true,
                    order: {
                        include: {
                            items: {
                                include: {
                                    product: true
                                }
                            }
                        }
                    }
                }
            },
            orders: {
                include: {
                    items: {
                        include: {
                            product: true
                        }
                    }
                }
            }
        }
    });

    if (!shipment) {
        return notFound();
    }

    const role = (session.user as any).role;
    if (role !== 'ADMIN') {
        const userId = (session.user as any).id;
        const client = await prisma.client.findFirst({
            where: { userId },
            select: { id: true }
        });

        if (!client || shipment.clientId !== client.id) {
            return notFound();
        }
    }

    return <PackingListTemplate shipment={shipment} />;
}
