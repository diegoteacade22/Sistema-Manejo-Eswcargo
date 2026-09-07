import assert from 'node:assert/strict';
import test from 'node:test';
import { activeInvoiceItems, activeInvoiceTotal } from './invoice-readiness-policy.mjs';

test('excluye items cancelados y cantidades cero del invoice operativo', () => {
  const items = [
    { status: 'CANCELADO', quantity: 2, unit_price: 100 },
    { status: 'cancelado ', quantity: 1, unit_price: 50 },
    { status: 'ENTREGADO', quantity: 0, unit_price: 900 },
    { status: 'ENTREGADO', quantity: 3, unit_price: 200 },
  ];

  assert.deepEqual(activeInvoiceItems(items), [items[3]]);
  assert.equal(activeInvoiceTotal(items), 600);
});

test('un pedido completamente cancelado no requiere invoice', () => {
  const items = [{ status: 'CANCELADO', quantity: 4, unit_price: 250 }];
  assert.equal(activeInvoiceItems(items).length, 0);
  assert.equal(activeInvoiceTotal(items), 0);
});
