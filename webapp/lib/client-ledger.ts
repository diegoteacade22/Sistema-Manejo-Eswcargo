import type { Prisma, PrismaClient } from '@prisma/client';

type TxClient = PrismaClient | Prisma.TransactionClient;

export const LEDGER_REFS = {
    order: (orderId: number) => `ORDER:${orderId}`,
    shipment: (shipmentId: number) => `SHIPMENT:${shipmentId}`,
};

export async function upsertOrderLedgerCharge(
    tx: TxClient,
    order: { id: number; order_number: number | null; clientId: number; total_amount: number; date?: Date | null }
) {
    const references = [
        LEDGER_REFS.order(order.id),
        order.order_number ? String(order.order_number) : null,
        order.order_number ? `Order #${order.order_number}` : null,
    ].filter(Boolean) as string[];

    const existingCharge = await tx.transaction.findFirst({
        where: {
            clientId: order.clientId,
            type: 'CARGO',
            OR: references.map(reference => ({ reference })),
        },
    });

    const data = {
        clientId: order.clientId,
        date: order.date || new Date(),
        type: 'CARGO',
        amount: -Math.abs(order.total_amount || 0),
        description: `Pedido #${order.order_number || order.id}`,
        reference: LEDGER_REFS.order(order.id),
    };

    if (existingCharge) {
        return tx.transaction.update({
            where: { id: existingCharge.id },
            data,
        });
    }

    return tx.transaction.create({ data });
}

export async function upsertShipmentLedgerCharge(
    tx: TxClient,
    shipment: {
        id: number;
        shipment_number: number | null;
        clientId: number;
        amount: number;
        date?: Date | null;
        notes?: string | null;
    }
) {
    const references = [
        LEDGER_REFS.shipment(shipment.id),
        shipment.shipment_number ? `SHIP-${shipment.shipment_number}` : null,
        shipment.shipment_number ? `Envío #${shipment.shipment_number}` : null,
    ].filter(Boolean) as string[];

    const existingCharge = await tx.transaction.findFirst({
        where: {
            clientId: shipment.clientId,
            type: 'CARGO',
            OR: references.map(reference => ({ reference })),
        },
    });

    const data = {
        clientId: shipment.clientId,
        date: shipment.date || new Date(),
        type: 'CARGO',
        amount: -Math.abs(shipment.amount || 0),
        description: `CARGA #${shipment.shipment_number || shipment.id}${shipment.notes ? ' - ' + shipment.notes : ''}`,
        reference: LEDGER_REFS.shipment(shipment.id),
    };

    if (existingCharge) {
        return tx.transaction.update({
            where: { id: existingCharge.id },
            data,
        });
    }

    return tx.transaction.create({ data });
}

export async function createPaymentLedgerEntry(
    tx: TxClient,
    payment: {
        clientId: number;
        amount: number;
        paymentMethod?: string | null;
        description?: string | null;
        reference?: string | null;
        date?: Date | null;
    }
) {
    return tx.transaction.create({
        data: {
            clientId: payment.clientId,
            type: 'PAGO',
            paymentMethod: payment.paymentMethod || null,
            amount: Math.abs(payment.amount || 0),
            date: payment.date || new Date(),
            description: payment.description || 'Pago a cuenta',
            reference: payment.reference || null,
        },
    });
}
