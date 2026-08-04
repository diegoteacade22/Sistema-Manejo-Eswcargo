function cleanPart(value: unknown, fallback: unknown): string {
    const selected = String(value ?? '').trim() || String(fallback ?? '').trim() || '0';
    return selected.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || '0';
}

export function getInvoicePdfFileName(orderNumber: unknown, orderId: unknown, clientCode: unknown, clientId: unknown) {
    return `INV-${cleanPart(orderNumber, orderId)}-${cleanPart(clientCode, clientId)}.pdf`;
}

export function getPackingPdfFileName(shipmentNumber: unknown, shipmentId: unknown, clientCode: unknown, clientId: unknown) {
    return `PL-${cleanPart(shipmentNumber, shipmentId)}-${cleanPart(clientCode, clientId)}.pdf`;
}
