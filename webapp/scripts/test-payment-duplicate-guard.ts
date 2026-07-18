import assert from 'node:assert/strict';
import { createClientPaymentWithReceipt } from '../lib/payment-receipts';

async function main() {
    const duplicateQueryCalls: Array<Record<string, unknown>> = [];
    const duplicateClient = {
        transaction: {
            findMany: async (query: Record<string, unknown>) => {
                duplicateQueryCalls.push(query);
                return [{ id: 10, reference: 'manual' }];
            },
            create: async () => {
                throw new Error('No debe crear un pago duplicado.');
            },
        },
    };

    await assert.rejects(
        createClientPaymentWithReceipt(duplicateClient as any, {
            clientId: 162,
            amount: 14700,
            date: new Date('2026-07-09T15:32:39.109Z'),
            paymentMethod: 'EFECTIVO',
            reference: 'Manual',
        }),
        /Ya existe un pago con el mismo cliente, fecha, monto y referencia/,
    );

    const duplicateWhere = duplicateQueryCalls[0]?.where as Record<string, unknown>;
    assert.equal('paymentMethod' in duplicateWhere, false, 'El método no puede permitir duplicar el mismo pago.');

    const created: Array<Record<string, unknown>> = [];
    const cleanClient = {
        transaction: {
            findMany: async () => [],
            create: async (query: Record<string, any>) => {
                created.push(query.data);
                return { id: 11, ...query.data };
            },
        },
        clientPaymentGuard: {
            create: async () => ({ id: 1 }),
        },
    };

    await createClientPaymentWithReceipt(cleanClient as any, {
        clientId: 162,
        amount: 14700,
        date: new Date('2026-07-10T12:00:00.000Z'),
        paymentMethod: 'EFECTIVO',
        reference: 'Manual',
    });

    assert.equal(created.length, 1, 'Un pago distinto por fecha debe poder registrarse.');
    assert.equal(created[0].paymentMethod, 'EFECTIVO', 'El método de pago se conserva en el movimiento.');

    console.log('OK: el control de pagos bloquea duplicados aunque cambie el método.');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
