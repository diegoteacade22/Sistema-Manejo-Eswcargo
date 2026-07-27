import { getPackingSegments, type PackingSegment } from '@/lib/packing-segments';

export function getAdminShipmentSearchWhere(query: string) {
    const searchFilters: any[] = [
        { forwarder: { contains: query, mode: 'insensitive' } },
        { client: { name: { contains: query, mode: 'insensitive' } } },
        { orders: { some: { client: { name: { contains: query, mode: 'insensitive' } } } } },
        { items: { some: { order: { client: { name: { contains: query, mode: 'insensitive' } } } } } },
    ];

    const shipmentNumber = Number.parseInt(query, 10);
    if (Number.isInteger(shipmentNumber)) {
        searchFilters.push({ shipment_number: shipmentNumber });
    }

    return { OR: searchFilters };
}

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
