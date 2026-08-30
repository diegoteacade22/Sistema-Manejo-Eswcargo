import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

type ShipmentClientCharge = {
    amount: number;
    reference: string | null;
    description: string | null;
};

export async function getShipmentClientCharge(
    shipmentNumber: number,
    clientId: number
): Promise<ShipmentClientCharge | null> {
    const baseWhere: Prisma.TransactionWhereInput = {
        clientId,
        type: 'CARGO',
        amount: { lt: 0 },
    };
    const nonQuarantinedReference: Prisma.TransactionWhereInput = {
        OR: [
            { reference: null },
            { NOT: { reference: { startsWith: 'CC-Import-' } } },
        ],
    };

    const stableReference = `SHIP-${shipmentNumber}:CLIENT:${clientId}`;
    const stableCharge = await prisma.transaction.findFirst({
        where: {
            ...baseWhere,
            reference: stableReference,
            AND: [nonQuarantinedReference],
        },
        select: { amount: true, reference: true, description: true },
        orderBy: { id: 'desc' },
    });

    const charge = stableCharge || await prisma.transaction.findFirst({
        where: {
            ...baseWhere,
            AND: [
                nonQuarantinedReference,
                {
                    OR: [
                        { reference: { startsWith: `Envío #${shipmentNumber}-` } },
                        { description: `Flete - Envío #${shipmentNumber}` },
                        { description: { startsWith: `CARGA #${shipmentNumber}` } },
                    ],
                },
            ],
        },
        select: { amount: true, reference: true, description: true },
        orderBy: { id: 'desc' },
    });

    if (!charge || !Number.isFinite(charge.amount) || charge.amount >= 0) {
        return null;
    }

    return {
        amount: Math.abs(charge.amount),
        reference: charge.reference,
        description: charge.description,
    };
}
