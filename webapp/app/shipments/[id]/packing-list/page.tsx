
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import PackingListTemplate from './packing-list-template';

export default async function PackingListPage(props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const id = parseInt(params.id);

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

    return <PackingListTemplate shipment={shipment} />;
}
