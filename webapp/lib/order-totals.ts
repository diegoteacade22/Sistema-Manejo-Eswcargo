export type OrderTotalItem = {
    status?: string | null;
    subtotal?: number | null;
    quantity?: number | null;
    unit_price?: number | null;
};

export function isCancelledOrderItem(status: string | null | undefined): boolean {
    return String(status || '').trim().toUpperCase() === 'CANCELADO';
}

export function calculateActiveOrderTotal(items: OrderTotalItem[]): number {
    return items.reduce((total, item) => {
        if (isCancelledOrderItem(item.status)) return total;

        if (item.subtotal !== null && item.subtotal !== undefined) {
            const subtotal = Number(item.subtotal);
            return total + (Number.isFinite(subtotal) ? subtotal : 0);
        }

        const quantity = Number(item.quantity);
        const unitPrice = Number(item.unit_price);
        return total + (
            Number.isFinite(quantity) && Number.isFinite(unitPrice)
                ? quantity * unitPrice
                : 0
        );
    }, 0);
}
