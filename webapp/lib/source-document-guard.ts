import { prisma } from '@/lib/prisma';

type SourceEntity = 'ORDER' | 'SHIPMENT';

const OPERATIONAL_SYNC_SCOPES = ['FULL', 'DIFF', 'DIRECT_OPERATIONAL'];
const SHARED_SHIPMENT_HEADER_CONFLICT = 'La fuente contiene más de una cabecera incompatible para el mismo número de envío.';

export function sourceDecisionBlock(action: string | null | undefined, reason: string | null | undefined) {
    return action === 'REJECTED' ? reason || 'La fuente rechazó este registro.' : null;
}

export async function getSourceDocumentBlock(entity: SourceEntity, sourceNumber: number | null | undefined) {
    if (!Number.isInteger(sourceNumber)) return null;

    const entities = entity === 'ORDER' ? ['ORDER', 'ORDER_ITEMS'] : ['SHIPMENT'];
    const latestDecision = await prisma.syncChange.findFirst({
        where: {
            entity: { in: entities },
            entityKey: `#${sourceNumber}`,
            syncRun: {
                scope: { in: OPERATIONAL_SYNC_SCOPES },
                status: 'SUCCESS',
            },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { action: true, reason: true },
    });

    return sourceDecisionBlock(latestDecision?.action, latestDecision?.reason);
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
