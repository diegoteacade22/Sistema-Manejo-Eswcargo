import { buildShipmentItems } from '@/lib/shipment-items';

type PackingItem = {
    id: number;
    quantity?: number | null;
    orderId?: number | null;
    order?: {
        id: number;
        clientId?: number | null;
        client?: any;
    } | null;
};

export type PackingSegment = {
    clientId: number;
    client: any;
    itemIds: number[];
    itemCount: number;
};

export function getPackingSegmentIssue(shipment: any) {
    const unresolvedItems = (buildShipmentItems(shipment) as PackingItem[]).filter(
        (item) => !item.order?.clientId || !item.order?.client
    );

    if (unresolvedItems.length > 0) {
        return `Hay ${unresolvedItems.length} artículo(s) sin cliente verificable. Corregí la asignación antes de emitir el Packing List.`;
    }

    return null;
}

export function getPackingSegments(shipment: any): PackingSegment[] {
    const segments = new Map<number, PackingSegment>();

    for (const item of buildShipmentItems(shipment) as PackingItem[]) {
        const clientId = item.order?.clientId;
        const client = item.order?.client;
        if (!clientId || !client) continue;

        const segment = segments.get(clientId) || {
            clientId,
            client,
            itemIds: [],
            itemCount: 0,
        };
        segment.itemIds.push(item.id);
        segment.itemCount += Number(item.quantity || 0);
        segments.set(clientId, segment);
    }

    if (segments.size === 0 && shipment?.client) {
        return [{
            clientId: shipment.client.id,
            client: shipment.client,
            itemIds: [],
            itemCount: 0,
        }];
    }

    return [...segments.values()].sort((left, right) => left.client.name.localeCompare(right.client.name));
}

export function getShipmentChargeIssue(shipment: any, clientId: number) {
    const packingIssue = getPackingSegmentIssue(shipment);
    if (packingIssue) return packingIssue;

    const segments = getPackingSegments(shipment);
    if (segments.length > 1) {
        return 'El envío contiene artículos de más de un cliente. No se puede atribuir un cargo común hasta registrar la distribución por cliente.';
    }

    if (segments[0]?.clientId !== clientId) {
        return 'El cliente elegido no corresponde a los artículos confirmados de este envío.';
    }

    return null;
}

export function projectShipmentForPacking(shipment: any, segment: PackingSegment, segmentCount: number) {
    const itemIds = new Set(segment.itemIds);
    return {
        ...shipment,
        client: segment.client,
        items: (shipment.items || []).filter((item: any) => itemIds.has(item.id)),
        orders: (shipment.orders || []).filter((order: any) => order.clientId === segment.clientId),
        packingSegment: {
            clientId: segment.clientId,
            itemCount: segment.itemCount,
            isSharedShipment: segmentCount > 1,
        },
    };
}

export function isSharedShipmentPacking(shipment: any) {
    return Boolean(shipment?.packingSegment?.isSharedShipment);
}
