import clientBalanceControls from '../scripts/client-balance-controls.json';

const cashFlowOldIds = new Set(
    clientBalanceControls.cashFlowAccounts.map((account) => account.oldId)
);

type LedgerTransaction = {
    client: {
        findUnique(args: any): Promise<{ old_id: number | null } | null>;
    };
    transaction: {
        findFirst(args: any): Promise<{ id: number } | null>;
        create(args: any): Promise<{ id: number }>;
        update(args: any): Promise<{ id: number }>;
    };
    clientPaymentGuard: {
        findFirst(args: any): Promise<{ id: number; transactionId: number } | null>;
        create(args: any): Promise<unknown>;
        update(args: any): Promise<unknown>;
    };
};

export type OperationLedgerInput = {
    clientId: number;
    date: Date;
    amount: number;
    chargeDescription: string;
    chargeReference: string;
    chargeReferenceAliases?: string[];
    operationKind: 'ORDER' | 'SHIPMENT';
    operationKey: string;
};

export function isCashFlowAccountOldId(oldId: number | null | undefined) {
    return oldId != null && cashFlowOldIds.has(oldId);
}

export function getCashFlowAccountOldIds() {
    return [...cashFlowOldIds];
}

export async function upsertOperationLedger(
    tx: LedgerTransaction,
    input: OperationLedgerInput
) {
    const amount = Math.abs(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('El importe de la operación debe ser mayor a cero.');
    }

    const client = await tx.client.findUnique({
        where: { id: input.clientId },
        select: { old_id: true },
    });
    if (!client) throw new Error('Cliente no encontrado para registrar la cuenta corriente.');

    const chargeData = {
        clientId: input.clientId,
        date: input.date,
        type: 'CARGO',
        amount: -amount,
        description: input.chargeDescription,
        reference: input.chargeReference,
    };
    const chargeReferences = [...new Set([
        input.chargeReference,
        ...(input.chargeReferenceAliases || []),
    ])];
    const existingCharge = await tx.transaction.findFirst({
        where: {
            clientId: input.clientId,
            type: 'CARGO',
            reference: { in: chargeReferences },
        },
        select: { id: true },
    });
    const charge = existingCharge
        ? await tx.transaction.update({ where: { id: existingCharge.id }, data: chargeData })
        : await tx.transaction.create({ data: chargeData });

    if (isCashFlowAccountOldId(client.old_id)) {
        return { chargeId: charge.id, settlementId: null, cashFlowAccount: true };
    }

    const settlementReference = `AUTO-ZERO:${input.operationKind}:${input.operationKey}`;
    const settlementDescription = `Cancelación automática - ${input.chargeDescription}`;
    const existingGuard = await tx.clientPaymentGuard.findFirst({
        where: { clientId: input.clientId, referenceKey: settlementReference },
        select: { id: true, transactionId: true },
    });

    if (existingGuard) {
        const settlement = await tx.transaction.update({
            where: { id: existingGuard.transactionId },
            data: {
                clientId: input.clientId,
                date: input.date,
                type: 'PAGO',
                amount,
                description: settlementDescription,
                reference: settlementReference,
                paymentMethod: 'AUTO',
            },
        });
        await tx.clientPaymentGuard.update({
            where: { id: existingGuard.id },
            data: { paymentDate: input.date, amount },
        });
        return { chargeId: charge.id, settlementId: settlement.id, cashFlowAccount: false };
    }

    const settlement = await tx.transaction.create({
        data: {
            clientId: input.clientId,
            date: input.date,
            type: 'PAGO',
            amount,
            description: settlementDescription,
            reference: settlementReference,
            paymentMethod: 'AUTO',
        },
    });
    await tx.clientPaymentGuard.create({
        data: {
            clientId: input.clientId,
            paymentDate: input.date,
            amount,
            referenceKey: settlementReference,
            transactionId: settlement.id,
        },
    });

    return { chargeId: charge.id, settlementId: settlement.id, cashFlowAccount: false };
}
