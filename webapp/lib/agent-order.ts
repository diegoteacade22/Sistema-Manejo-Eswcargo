export type CanonicalAgentOrderItem = {
    productId: number | null;
    productName: string;
    quantity: number;
    unit_price: number;
    unit_cost: number;
    subtotal: number;
    supplierId: number | null;
    status: string | null;
};

function finiteNumber(value: unknown, field: string, fallback = 0) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${field} debe ser numérico.`);
    return parsed;
}

function optionalPositiveInteger(value: unknown, field: string) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${field} debe ser un identificador válido.`);
    return parsed;
}

function roundMoney(value: number) {
    return Math.round(value * 100) / 100;
}

export function canonicalizeAgentOrderItems(input: unknown): { items: CanonicalAgentOrderItem[]; totalAmount: number } {
    if (!Array.isArray(input) || input.length === 0) {
        throw new Error('items debe incluir al menos un producto.');
    }

    const items = input.map((value, index) => {
        const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
        const productName = String(item.productName || '').trim();
        const quantity = finiteNumber(item.quantity, `items[${index}].quantity`);
        const unitPrice = finiteNumber(item.unit_price, `items[${index}].unit_price`);
        const unitCost = finiteNumber(item.unit_cost, `items[${index}].unit_cost`);

        if (!productName) throw new Error(`items[${index}].productName es obligatorio.`);
        if (!Number.isInteger(quantity) || quantity <= 0) throw new Error(`items[${index}].quantity debe ser un entero mayor a cero.`);
        if (unitPrice < 0 || unitCost < 0) throw new Error(`items[${index}] no puede tener importes negativos.`);

        return {
            productId: optionalPositiveInteger(item.productId, `items[${index}].productId`),
            productName,
            quantity,
            unit_price: unitPrice,
            unit_cost: unitCost,
            subtotal: roundMoney(quantity * unitPrice),
            supplierId: optionalPositiveInteger(item.supplierId, `items[${index}].supplierId`),
            status: item.status ? String(item.status).trim() : null,
        } satisfies CanonicalAgentOrderItem;
    });

    return {
        items,
        totalAmount: roundMoney(items.reduce((sum, item) => sum + item.subtotal, 0)),
    };
}

export function assertAgentProvidedTotal(value: unknown, totalAmount: number) {
    if (value === undefined || value === null || value === '') return;
    const provided = finiteNumber(value, 'total_amount');
    if (Math.abs(provided - totalAmount) > 0.005) {
        throw new Error(`total_amount (${provided.toFixed(2)}) no coincide con los ítems (${totalAmount.toFixed(2)}).`);
    }
}
