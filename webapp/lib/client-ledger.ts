import crypto from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

type TxClient = PrismaClient | Prisma.TransactionClient;

type PaymentLedgerInput = {
    clientId: number;
    amount: number;
    paymentMethod?: string | null;
    description?: string | null;
    reference?: string | null;
    date?: Date | null;
    /** Reuse this key when the same request is retried. */
    idempotencyKey?: string | null;
};

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

    const existingCharges = await tx.transaction.findMany({
        where: {
            type: 'CARGO',
            OR: references.map(reference => ({ reference })),
        },
        orderBy: { id: 'asc' },
    });

    if (existingCharges.length > 1) {
        throw new Error(`El pedido #${order.order_number || order.id} tiene más de un cargo de cuenta corriente. Requiere revisión manual.`);
    }

    const existingCharge = existingCharges[0];

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

    const legacyPrefix = shipment.shipment_number ? `SHIP-${shipment.shipment_number}:` : null;
    const existingCharges = await tx.transaction.findMany({
        where: {
            type: 'CARGO',
            OR: [
                ...references.map(reference => ({ reference })),
                ...(legacyPrefix ? [{ reference: { startsWith: legacyPrefix } }] : []),
            ],
        },
        orderBy: { id: 'asc' },
    });

    if (existingCharges.length > 1) {
        throw new Error(`El envío #${shipment.shipment_number || shipment.id} tiene más de un cargo de cuenta corriente. Requiere revisión manual.`);
    }

    const existingCharge = existingCharges[0];

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

function paymentDay(date: Date) {
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    return day;
}

function isRootClient(tx: TxClient): tx is PrismaClient {
    return '$transaction' in tx;
}

async function persistPaymentLedgerEntry(tx: Prisma.TransactionClient, payment: PaymentLedgerInput, key: string, date: Date) {
    const amount = Math.abs(payment.amount || 0);
    const guard = await tx.clientPaymentGuard.findUnique({
        where: { idempotencyKey: key },
        select: { transactionId: true },
    });

    if (guard) {
        return tx.transaction.findUniqueOrThrow({ where: { id: guard.transactionId } });
    }

    const transaction = await tx.transaction.create({
        data: {
            clientId: payment.clientId,
            type: 'PAGO',
            paymentMethod: payment.paymentMethod || null,
            amount,
            date,
            description: payment.description || 'Pago a cuenta',
            reference: payment.reference || null,
        },
    });

    await tx.clientPaymentGuard.create({
        data: {
            clientId: payment.clientId,
            paymentDate: paymentDay(date),
            amount,
            referenceKey: key,
            idempotencyKey: key,
            transactionId: transaction.id,
        },
    });

    return transaction;
}

export async function createPaymentLedgerEntry(tx: TxClient, payment: PaymentLedgerInput) {
    const date = payment.date || new Date();
    const key = payment.idempotencyKey?.trim() || crypto.randomUUID();

    if (!isRootClient(tx)) {
        return persistPaymentLedgerEntry(tx, payment, key, date);
    }

    try {
        return await tx.$transaction(
            (transaction) => persistPaymentLedgerEntry(transaction, payment, key, date),
            { isolationLevel: 'Serializable' },
        );
    } catch (error: any) {
        if (error?.code !== 'P2002' && error?.code !== 'P2034') throw error;

        const guard = await tx.clientPaymentGuard.findUnique({
            where: { idempotencyKey: key },
            select: { transactionId: true },
        });
        if (guard) return tx.transaction.findUniqueOrThrow({ where: { id: guard.transactionId } });
        throw error;
    }
}
