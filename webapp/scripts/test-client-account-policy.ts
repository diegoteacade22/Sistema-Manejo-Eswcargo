import assert from 'node:assert/strict';
import { isCashFlowAccountOldId, upsertOperationLedger } from '../lib/client-account-policy';

type Row = {
    id: number;
    clientId: number;
    date: Date;
    type: string;
    amount: number;
    description: string;
    reference: string;
    paymentMethod?: string;
};

function fakeLedger(oldId: number) {
    const rows: Row[] = [];
    const guards: Array<{ id: number; clientId: number; paymentDate: Date; amount: number; referenceKey: string; transactionId: number }> = [];
    let nextId = 1;

    const tx = {
        client: {
            findUnique: async () => ({ old_id: oldId }),
        },
        transaction: {
            findFirst: async ({ where }: any) => rows.find((row) =>
                row.clientId === where.clientId &&
                row.type === where.type &&
                (where.reference?.in || [where.reference]).includes(row.reference)
            ) || null,
            create: async ({ data }: any) => {
                const row = { id: nextId++, ...data };
                rows.push(row);
                return row;
            },
            update: async ({ where, data }: any) => {
                const row = rows.find((item) => item.id === where.id);
                if (!row) throw new Error('Movimiento inexistente');
                Object.assign(row, data);
                return row;
            },
        },
        clientPaymentGuard: {
            findFirst: async ({ where }: any) => guards.find((guard) =>
                guard.clientId === where.clientId && guard.referenceKey === where.referenceKey
            ) || null,
            create: async ({ data }: any) => {
                const guard = { id: guards.length + 1, ...data };
                guards.push(guard);
                return guard;
            },
            update: async ({ where, data }: any) => {
                const guard = guards.find((item) => item.id === where.id);
                if (!guard) throw new Error('Control inexistente');
                Object.assign(guard, data);
                return guard;
            },
        },
    };

    return { tx, rows, guards };
}

async function main() {
    const operation = {
        clientId: 501,
        date: new Date('2026-07-27T12:00:00Z'),
        amount: 288,
        chargeDescription: 'Flete - Envío #1232',
        chargeReference: 'SHIP-1232',
        operationKind: 'SHIPMENT' as const,
        operationKey: '1232:CLIENT:501',
    };

    assert.equal(isCashFlowAccountOldId(265), true);
    assert.equal(isCashFlowAccountOldId(18), false);

    const cashFlow = fakeLedger(265);
    await upsertOperationLedger(cashFlow.tx, operation);
    assert.deepEqual(cashFlow.rows.map((row) => [row.type, row.amount]), [['CARGO', -288]]);

    const regular = fakeLedger(18);
    await upsertOperationLedger(regular.tx, operation);
    await upsertOperationLedger(regular.tx, { ...operation, amount: 300 });
    assert.deepEqual(regular.rows.map((row) => [row.type, row.amount]), [
        ['CARGO', -300],
        ['PAGO', 300],
    ]);
    assert.equal(regular.guards.length, 1);
    assert.equal(regular.rows.reduce((sum, row) => sum + row.amount, 0), 0);

    console.log('OK: CASH FLOW conserva deuda y el resto se cancela en forma atómica e idempotente.');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
