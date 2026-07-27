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
    cargoDescription?: string | null;
    documentSuffix?: string;
    documentNumber?: string;
};

function inferCargoItemCount(description: string | null | undefined) {
    const match = String(description || '').match(/^\s*(\d+)\s*[xX×]\b/);
    return match ? Number(match[1]) : 0;
}

function suffixForIndex(index: number) {
    let value = index + 1;
    let suffix = '';
    while (value > 0) {
        value -= 1;
        suffix = String.fromCharCode(65 + (value % 26)) + suffix;
        value = Math.floor(value / 26);
    }
    return suffix;
}

function assignDocumentNumbers(shipment: any, segments: PackingSegment[]) {
    const baseNumber = String(shipment?.shipment_number || shipment?.id || '');
    if (segments.length <= 1) {
        return segments.map((segment) => ({
            ...segment,
            documentSuffix: '',
            documentNumber: baseNumber,
        }));
    }

    return segments.map((segment, index) => {
        const documentSuffix = suffixForIndex(index);
        return {
            ...segment,
            documentSuffix,
            documentNumber: `${baseNumber}${documentSuffix}`,
        };
    });
}

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
        return assignDocumentNumbers(shipment, [{
            clientId: shipment.client.id,
            client: shipment.client,
            itemIds: [],
            itemCount: Number(shipment.item_count || inferCargoItemCount(shipment.cargo_description)),
            cargoDescription: shipment.cargo_description || null,
        }]);
    }

    const headerClientId = shipment?.client?.id;
    const hasSeparateHeaderCargo = Boolean(
        headerClientId
        && shipment?.cargo_description
        && !segments.has(headerClientId)
    );
    const orderedSegments = [...segments.values()].sort((left, right) => left.client.name.localeCompare(right.client.name));

    if (hasSeparateHeaderCargo) {
        orderedSegments.unshift({
            clientId: headerClientId,
            client: shipment.client,
            itemIds: [],
            itemCount: inferCargoItemCount(shipment.cargo_description),
            cargoDescription: shipment.cargo_description,
        });
    }

    return assignDocumentNumbers(shipment, orderedSegments);
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
        cargo_description: segment.cargoDescription || null,
        item_count: segment.itemCount,
        packingSegment: {
            clientId: segment.clientId,
            itemCount: segment.itemCount,
            isSharedShipment: segmentCount > 1,
            documentSuffix: segment.documentSuffix || '',
            documentNumber: segment.documentNumber || String(shipment.shipment_number || shipment.id),
        },
    };
}

export function getPackingSubtotal(shipment: any): number | null {
    if (shipment?.packingSegment?.isSharedShipment) {
        const subtotal = Number(shipment?.packingSegment?.clientChargeSubtotal);
        return Number.isFinite(subtotal) && subtotal > 0 ? subtotal : null;
    }

    const total = Number(shipment?.price_total);
    return Number.isFinite(total) && total >= 0 ? total : null;
}

export function isSharedShipmentPacking(shipment: any) {
    return Boolean(shipment?.packingSegment?.isSharedShipment);
}

export function getPackingDocumentNumber(shipment: any) {
    return String(shipment?.packingSegment?.documentNumber || shipment?.shipment_number || shipment?.id || '');
}
