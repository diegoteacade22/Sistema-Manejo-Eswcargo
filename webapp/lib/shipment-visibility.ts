import { getPackingSegments, type PackingSegment } from '@/lib/packing-segments';

export function getClientShipmentVisibilityWhere(clientId: number) {
    return {
        OR: [
            { items: { some: { order: { clientId } } } },
            { orders: { some: { clientId } } },
            {
                AND: [
                    { clientId },
                    { items: { none: {} } },
                    { orders: { none: {} } },
                ],
            },
        ],
    };
}

export function getClientShipmentAccess(shipment: any, clientId: number): { segment: PackingSegment | null; segmentCount: number } | null {
    const segments = getPackingSegments(shipment);
    const segment = segments.find((item) => item.clientId === clientId);
    if (segment) return { segment, segmentCount: segments.length };

    // A legacy header grants visibility only when there is no item-level owner.
    if (segments.length === 0 && shipment.clientId === clientId) {
        return { segment: null, segmentCount: 0 };
    }

    return null;
}
