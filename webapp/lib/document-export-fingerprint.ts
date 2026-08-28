import { createHash } from 'node:crypto';
import {
    getPackingDocumentNumber,
    getPackingSubtotal,
    projectShipmentForPacking,
    type PackingSegment,
} from './packing-segments';
import { isCancelledOrderItem } from './order-totals';
import { buildShipmentItems, getShipmentCargoDescription } from './shipment-items';

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
    const numberFormatter = new Intl.NumberFormat('en-US');
    const invoiceItems = order.items
        .filter((item) => !isCancelledOrderItem(item.status))
        .map((item) => ({
            quantity: item.quantity,
            productName: item.productName,
            colorGrade: item.product?.color_grade || '-',
            unitValue: numberFormatter.format(item.unit_price),
            totalValue: numberFormatter.format(item.unit_price * item.quantity),
        }));
    const totalPcs = invoiceItems.reduce((total, item) => total + item.quantity, 0);
    const shipmentWeight = Number(order.shipment?.weight_cli || 0);
    const weightLabel = shipmentWeight > 0
        ? `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(shipmentWeight)} KG`
        : '- KG';

    return fingerprint({
        renderVersion,
        invoice: {
            number: String(order.order_number),
            businessDate: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).format(new Date(order.date)),
            client: {
                name: order.client.name,
                address: order.client.address || 'NO ADDRESS',
                city: order.client.city || 'MIAMI',
                country: order.client.country || 'USA',
                code: String(order.client.old_id || order.client.id),
            },
            items: invoiceItems,
            totalPcs,
            weightLabel,
            totalAmount: numberFormatter.format(order.total_amount ?? 0),
        },
    });
}

export function packingListDocumentContentFingerprint(
    source: {
        shipment: unknown;
        segment: PackingSegment;
        segmentCount: number;
        clientCharge: { amount: number; reference: string | null } | null;
    },
    renderVersion = PACKING_LIST_DOCUMENT_RENDER_VERSION,
) {
    const projectedShipment = projectShipmentForPacking(source.shipment, source.segment, source.segmentCount);
    const documentShipment = {
        ...projectedShipment,
        packingSegment: {
            ...projectedShipment.packingSegment,
            clientChargeSubtotal: source.clientCharge?.amount ?? null,
        },
    };
    const items = buildShipmentItems(documentShipment);
    const cargoDescription = getShipmentCargoDescription(documentShipment);
    const renderedItems = items.map((item) => ({
        quantity: Number(item.quantity || 0),
        productName: item.productName,
        colorGrade: item.product?.color_grade || '-',
        orderNumber: item.order?.order_number || '-',
    }));
    const totalPcs = renderedItems.length > 0
        ? renderedItems.reduce((total, item) => total + item.quantity, 0)
        : Number(documentShipment.item_count || 0);
    const shipment = source.shipment as {
        date_shipped?: Date | string | null;
        createdAt?: Date | string | null;
    };

    return fingerprint({
        renderVersion,
        packingList: {
            documentNumber: getPackingDocumentNumber(documentShipment),
            businessDate: shipment.date_shipped || shipment.createdAt || null,
            client: {
                id: documentShipment.client?.id ?? null,
                old_id: documentShipment.client?.old_id ?? null,
                name: documentShipment.client?.name ?? null,
            },
            items: renderedItems,
            cargoDescription: renderedItems.length === 0 ? cargoDescription : null,
            totalPcs,
            isSharedShipment: documentShipment.packingSegment.isSharedShipment,
            subtotal: getPackingSubtotal(documentShipment),
        },
    });
}

export function packingListSourceFingerprint(
    source: { shipment: unknown; segments: PackingSegment[] },
    renderVersion = PACKING_LIST_DOCUMENT_RENDER_VERSION,
) {
    const shipment = source.shipment as {
        shipment_number?: number | null;
        date_shipped?: Date | string | null;
        createdAt?: Date | string | null;
        item_count?: number | null;
        price_total?: number | null;
        cargo_description?: string | null;
    };
    return fingerprint({
        renderVersion,
        source: {
            shipment_number: shipment.shipment_number ?? null,
            businessDate: shipment.date_shipped || shipment.createdAt || null,
            item_count: shipment.item_count ?? null,
            price_total: shipment.price_total ?? null,
            cargo_description: shipment.cargo_description ?? null,
            segments: source.segments.map((segment) => ({
                clientId: segment.clientId,
                clientOldId: segment.client?.old_id ?? null,
                clientName: segment.client?.name ?? null,
                itemCount: segment.itemCount,
                cargoDescription: segment.cargoDescription ?? null,
                documentNumber: segment.documentNumber ?? null,
            })),
        },
    });
}
