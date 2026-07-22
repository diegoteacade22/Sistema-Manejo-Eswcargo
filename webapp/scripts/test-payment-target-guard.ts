import assert from 'node:assert/strict';
import { createClientPaymentWithReceipt } from '../lib/payment-receipts';

async function main() {
    const rejectedClient = {
        order: {
            findUnique: async () => ({ id: 90, clientId: 12, order_number: 4521, total_amount: 100 }),
        },
        transaction: {
            aggregate: async () => ({ _sum: { amount: 70 } }),
            findMany: async () => [],
            create: async () => {
                throw new Error('No debe crear un pago por encima del saldo pendiente.');
            },
        },
    };

    await assert.rejects(
        createClientPaymentWithReceipt(rejectedClient as any, {
            clientId: 12,
            amount: 30.01,
            date: new Date('2026-07-22T12:00:00.000Z'),
            paymentMethod: 'WIRE',
            target: { kind: 'ORDER', id: 90 },
        }),
        /supera el saldo pendiente/,
    );

    const created: Array<Record<string, unknown>> = [];
    const acceptedClient = {
        order: rejectedClient.order,
        transaction: {
            aggregate: async () => ({ _sum: { amount: 70 } }),
            findMany: async () => [],
            create: async (query: Record<string, any>) => {
                created.push(query.data);
                return { id: 501, ...query.data };
            },
        },
        clientPaymentGuard: {
            create: async () => ({ id: 1 }),
        },
    };

    await createClientPaymentWithReceipt(acceptedClient as any, {
        clientId: 12,
        amount: 30,
        date: new Date('2026-07-22T12:00:00.000Z'),
        paymentMethod: 'WIRE',
        reference: 'TRX-123',
        target: { kind: 'ORDER', id: 90 },
    });

    assert.equal(created.length, 1, 'El pago exacto del saldo pendiente debe registrarse.');
    assert.equal(created[0].reference, 'PAYMENT-ORDER:90:TRX-123', 'El pago debe quedar asociado al pedido.');
    console.log('OK: los cobros por pedido no pueden superar el saldo pendiente y quedan imputados al pedido.');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
