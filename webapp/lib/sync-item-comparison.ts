export type SyncComparableItem = {
    productId?: number | null;
    productName?: string | null;
    quantity?: number | null;
    unit_price?: number | null;
    unit_cost?: number | null;
    subtotal?: number | null;
    profit?: number | null;
    shipmentId?: number | null;
    status?: string | null;
};

function money(value: number | null | undefined) {
    return Number(value || 0).toFixed(6);
}

export function itemSyncSignature(item: SyncComparableItem) {
    return [
        item.productId || '',
        String(item.productName || '').trim(),
        Number(item.quantity || 0),
        money(item.unit_price),
        money(item.unit_cost),
        money(item.subtotal),
        money(item.profit),
        item.shipmentId || '',
        String(item.status || '').trim(),
    ].join('|');
}

export function sameItemSet(currentItems: SyncComparableItem[], nextItems: SyncComparableItem[]) {
    if (currentItems.length !== nextItems.length) return false;
    const current = currentItems.map(itemSyncSignature).sort();
    const next = nextItems.map(itemSyncSignature).sort();
    return current.every((signature, index) => signature === next[index]);
}
