import { prisma } from '@/lib/prisma';

type SourceEntity = 'ORDER' | 'SHIPMENT';

const OPERATIONAL_SYNC_SCOPES = ['FULL', 'DIFF'];
const SHARED_SHIPMENT_HEADER_CONFLICT = 'La fuente contiene más de una cabecera incompatible para el mismo número de envío.';

export async function getSourceDocumentBlock(entity: SourceEntity, sourceNumber: number | null | undefined) {
    if (!Number.isInteger(sourceNumber)) return null;

    const latestSourceRun = await prisma.syncRun.findFirst({
        where: {
            scope: { in: OPERATIONAL_SYNC_SCOPES },
            status: 'SUCCESS',
        },
        orderBy: { startedAt: 'desc' },
        select: { id: true },
    });

    if (!latestSourceRun) return null;

    const rejection = await prisma.syncChange.findFirst({
        where: {
            syncRunId: latestSourceRun.id,
            entity,
            entityKey: `#${sourceNumber}`,
            action: 'REJECTED',
        },
        select: { reason: true },
    });

    return rejection?.reason || null;
}

export async function getOrderSourceDocumentBlock(orderNumbers: Array<number | null | undefined>) {
    const uniqueOrderNumbers = [...new Set(orderNumbers.filter((value): value is number => Number.isInteger(value)))];

    for (const orderNumber of uniqueOrderNumbers) {
        const reason = await getSourceDocumentBlock('ORDER', orderNumber);
        if (reason) return { orderNumber, reason };
    }

    return null;
}

export function sourceBlockMessage(reason: string) {
    return `Documento bloqueado por la última sincronización de fuente: ${reason}`;
}

// A segmented packing can use item-level data only for this known header conflict.
export function canUseSegmentedPackingForShipmentBlock(reason: string | null, isSharedShipment: boolean) {
    return Boolean(isSharedShipment && reason === SHARED_SHIPMENT_HEADER_CONFLICT);
}
