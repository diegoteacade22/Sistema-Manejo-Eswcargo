/** Order numbers >= 900000 are system-generated (virtual shipment, balance, etc.) and must never appear as invoice numbers. */
function isSystemOrderNumber(orderNumber: number | null | undefined): boolean {
    return typeof orderNumber === 'number' && orderNumber >= 900000;
}

export function buildShipmentItems(shipment: any) {
    const shipmentItemsMap = new Map<number, any>();

    if (shipment?.items) {
        shipment.items.forEach((item: any) => {
            shipmentItemsMap.set(item.id, {
                ...item,
                orderId: item.order?.id,
                orderNumber: isSystemOrderNumber(item.order?.order_number) ? null : item.order?.order_number,
            });
        });
    }

    if (shipment?.orders) {
        shipment.orders.forEach((order: any) => {
            if (!order.items) return;

            order.items.forEach((item: any) => {
                if (shipmentItemsMap.has(item.id)) return;

                const isInShipment =
                    item.shipmentId === shipment.id ||
                    (!item.shipmentId && order.shipmentId === shipment.id);

                if (isInShipment) {
                    shipmentItemsMap.set(item.id, {
                        ...item,
                        orderId: order.id,
                        orderNumber: isSystemOrderNumber(order.order_number) ? null : order.order_number,
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