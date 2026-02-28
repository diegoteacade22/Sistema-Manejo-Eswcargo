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

            order.items.forEach((item: any) => {
                if (shipmentItemsMap.has(item.id)) return;

                const isInShipment =
                    item.shipmentId === shipment.id ||
                    (!item.shipmentId && order.shipmentId === shipment.id);

                if (isInShipment) {
                    shipmentItemsMap.set(item.id, {
                        ...item,
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