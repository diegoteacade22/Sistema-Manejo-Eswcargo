import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateActiveOrderTotal } from '../lib/order-totals';

test('excluye todos los renglones CANCELADO del total', () => {
    const total = calculateActiveOrderTotal([
        { status: 'CANCELADO', quantity: 2, unit_price: 637 },
        { status: ' cancelado ', quantity: 2, unit_price: 637 },
        { status: 'ENTREGADO', quantity: 2, unit_price: 910 },
        { status: 'ENTREGADO', subtotal: 1060 },
    ]);

    assert.equal(total, 2880);
});

test('mantiene ítems activos aunque el estado esté vacío', () => {
    assert.equal(calculateActiveOrderTotal([
        { status: null, quantity: 2, unit_price: 100 },
        { status: 'COMPRAR', subtotal: 50 },
    ]), 250);
});

test('pedido 2558 suma USD 12.580 después de las cancelaciones', () => {
    assert.equal(calculateActiveOrderTotal([
        { status: 'CANCELADO', quantity: 2, unit_price: 637 },
        { status: 'CANCELADO', quantity: 2, unit_price: 637 },
        { status: 'ENTREGADO', quantity: 2, unit_price: 910 },
        { status: 'ENTREGADO', quantity: 2, unit_price: 910 },
        { status: 'ENTREGADO', quantity: 2, unit_price: 910 },
        { status: 'ENTREGADO', quantity: 2, unit_price: 910 },
        { status: 'ENTREGADO', quantity: 2, unit_price: 1060 },
        { status: 'ENTREGADO', quantity: 1, unit_price: 1060 },
        { status: 'CANCELADO', quantity: 3, unit_price: 1060 },
        { status: 'ENTREGADO', quantity: 2, unit_price: 1060 },
    ]), 12580);
});
