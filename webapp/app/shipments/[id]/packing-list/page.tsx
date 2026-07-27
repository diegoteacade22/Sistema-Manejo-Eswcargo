
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import PackingListTemplate from './packing-list-template';
import { auth } from '@/lib/auth';
import type { Metadata } from 'next';
import { toInvNumber4 } from '@/lib/inv-filename';
import { DocumentBlocked } from '@/components/document-blocked';
import { hasPrintableShipmentContent } from '@/lib/shipment-items';
import { canUseSegmentedPackingForShipmentBlock, getOrderSourceDocumentBlock, getSourceDocumentBlock, sourceBlockMessage } from '@/lib/source-document-guard';
import { getPackingSegmentIssue, getPackingSegments, projectShipmentForPacking } from '@/lib/packing-segments';
import { getShipmentClientCharge } from '@/lib/shipment-client-charge';
import { PackingClientSelection } from './packing-client-selection';

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

export default async function PackingListPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ clientId?: string }> }) {
    const params = await props.params;
    const searchParams = await props.searchParams;
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
                            client: true,
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
                    client: true,
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

    const packingIssue = getPackingSegmentIssue(shipment);
    if (packingIssue) {
        return <DocumentBlocked title="Packing List bloqueado" detail={packingIssue} backHref={`/shipments/${shipment.id}`} backLabel="Volver al envío" />;
    }

    const segments = getPackingSegments(shipment);
    const role = (session.user as any).role;
    let requestedClientId = Number(searchParams.clientId);
    if (role !== 'ADMIN') {
        const userId = (session.user as any).id;
        const client = await prisma.client.findFirst({
            where: { userId },
            select: { id: true }
        });

        if (!client || !segments.some((segment) => segment.clientId === client.id)) {
            return notFound();
        }
        requestedClientId = client.id;
    }

    if (segments.length > 1 && !Number.isInteger(requestedClientId)) {
        return <PackingClientSelection shipmentId={shipment.id} shipmentNumber={shipment.shipment_number} segments={segments} />;
    }

    const selectedSegment = segments.find((segment) => segment.clientId === requestedClientId) || (segments.length === 1 ? segments[0] : null);
    if (!selectedSegment) return notFound();
    const projectedShipment = projectShipmentForPacking(shipment, selectedSegment, segments.length);
    const shipmentNumber = shipment.shipment_number || shipment.id;
    const clientCharge = projectedShipment.packingSegment.isSharedShipment
        ? await getShipmentClientCharge(shipmentNumber, selectedSegment.clientId)
        : null;
    const packingShipment = {
        ...projectedShipment,
        packingSegment: {
            ...projectedShipment.packingSegment,
            clientChargeSubtotal: clientCharge?.amount ?? null,
            clientChargeReference: clientCharge?.reference ?? null,
        },
    };

    if (packingShipment.packingSegment.isSharedShipment && !clientCharge) {
        return (
            <DocumentBlocked
                title="Packing List bloqueado"
                detail={`Falta confirmar el subtotal del envío #${shipmentNumber} para ${selectedSegment.client.name}.`}
                backHref={`/shipments/${shipment.id}`}
                backLabel="Volver al envío"
            />
        );
    }

    const shipmentSourceBlock = await getSourceDocumentBlock('SHIPMENT', shipment.shipment_number);
    const orderSourceBlock = await getOrderSourceDocumentBlock([
        ...packingShipment.orders.map((order: any) => order.order_number),
        ...packingShipment.items.map((item: any) => item.order?.order_number),
    ]);
    const sourceBlock = (!canUseSegmentedPackingForShipmentBlock(shipmentSourceBlock, packingShipment.packingSegment.isSharedShipment)
        ? shipmentSourceBlock
        : null) || (orderSourceBlock ? orderSourceBlock.reason : null);

    if (sourceBlock) {
        return (
            <DocumentBlocked
                title="Packing List bloqueado"
                detail={sourceBlockMessage(sourceBlock)}
                backHref={`/shipments/${shipment.id}`}
                backLabel="Volver al envío"
            />
        );
    }

    if (!hasPrintableShipmentContent(packingShipment)) {
        return (
            <DocumentBlocked
                title="Packing List bloqueado"
                detail="El envío no tiene artículos ni una descripción operativa confirmada."
                backHref={`/shipments/${shipment.id}`}
                backLabel="Volver al envío"
            />
        );
    }

    return <PackingListTemplate shipment={packingShipment} />;
}
