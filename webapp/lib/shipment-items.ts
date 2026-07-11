const EXPORTABLE_SHIPMENT_ITEM_STATUSES = new Set(['SALIENDO', 'LLEGANDO']);

export function isExportableShipmentItemStatus(status: unknown) {
    const normalized = (status || '').toString().toUpperCase().trim();
    return EXPORTABLE_SHIPMENT_ITEM_STATUSES.has(normalized);
}

export function isExportableShipmentItem(item: { status?: unknown; order?: { status?: unknown } } | null | undefined, shipmentStatus?: unknown) {
    if (!item) return false;

    if (isExportableShipmentItemStatus(item.status)) return true;
    if (isExportableShipmentItemStatus(item.order?.status)) return true;
    if (isExportableShipmentItemStatus(shipmentStatus)) return true;

    return false;
}

export function filterExportableShipmentItems<T extends { status?: unknown; order?: { status?: unknown } }>(items: T[], shipmentStatus?: unknown) {
    return items.filter((item) => isExportableShipmentItem(item, shipmentStatus));
}

export function buildShipmentItems(shipment: any) {
    const shipmentItemsMap = new Map<number, any>();

    if (shipment?.items) {
        shipment.items.forEach((item: any) => {
            shipmentItemsMap.set(item.id, {
                ...item,
                orderId: item.order?.id,
                orderNumber: item.order?.order_number,
            });
        });
    }

    if (shipment?.orders) {
        shipment.orders.forEach((order: any) => {
            if (!order.items) return;
            // Header-level shipment links are legacy fallback only. Explicit item
            // assignments are the authoritative source when they exist.
            const orderHasExplicitShipmentItems = order.items.some((item: any) => item.shipmentId);

            order.items.forEach((item: any) => {
                if (shipmentItemsMap.has(item.id)) return;

                const isInShipment =
                    item.shipmentId === shipment.id ||
                    (!orderHasExplicitShipmentItems && !item.shipmentId && order.shipmentId === shipment.id);

                if (isInShipment) {
                    shipmentItemsMap.set(item.id, {
                        ...item,
                        order: item.order || order,
                        orderId: order.id,
                        orderNumber: order.order_number,
                    });
                }
            });
        });
    }

    return Array.from(shipmentItemsMap.values());
}

export function getShipmentItemCount(shipment: any) {
    const shipmentItems = buildShipmentItems(shipment);
    return shipmentItems.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0);
}
