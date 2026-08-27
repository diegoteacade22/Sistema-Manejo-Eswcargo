import { createHash } from 'node:crypto';

export const INVOICE_DOCUMENT_RENDER_VERSION = 'invoice-pdf-v1';
export const PACKING_LIST_DOCUMENT_RENDER_VERSION = 'packing-list-pdf-v1';

type InvoiceFingerprintSource = {
    id: number;
    order_number: number | string | null;
    date: Date | string;
    total_amount: number | null;
    client: {
        id: number;
        old_id: number | null;
        name: string;
        address: string | null;
        city: string | null;
        country: string | null;
    };
    shipment: { weight_cli: number | null } | null;
    items: Array<{
        id: number;
        productName: string;
        quantity: number;
        unit_price: number;
        status: string | null;
        product: { color_grade: string | null } | null;
    }>;
};

function fingerprint(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function invoiceDocumentContentFingerprint(
    order: InvoiceFingerprintSource,
    renderVersion = INVOICE_DOCUMENT_RENDER_VERSION,
) {
    return fingerprint({
        renderVersion,
        invoice: {
            id: order.id,
            order_number: order.order_number,
            date: order.date,
            total_amount: order.total_amount,
            client: order.client,
            shipment: { weight_cli: order.shipment?.weight_cli ?? null },
            items: order.items,
        },
    });
}

export function packingListDocumentContentFingerprint(
    source: { shipment: unknown; segment: unknown; clientCharge: unknown },
    renderVersion = PACKING_LIST_DOCUMENT_RENDER_VERSION,
) {
    return fingerprint({ renderVersion, packingList: source });
}
