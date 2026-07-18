import assert from 'node:assert/strict';
import { assertAgentProvidedTotal, canonicalizeAgentOrderItems } from '../lib/agent-order';

const normalized = canonicalizeAgentOrderItems([
    { productName: 'iPhone 17', quantity: '2', unit_price: '850', unit_cost: '790', subtotal: 1 },
    { productName: 'Cable USB-C', quantity: 3, unit_price: 10, unit_cost: 4 },
]);

assert.equal(normalized.totalAmount, 1730);
assert.deepEqual(normalized.items.map((item) => item.subtotal), [1700, 30]);
assert.doesNotThrow(() => assertAgentProvidedTotal('1730', normalized.totalAmount));
assert.throws(() => assertAgentProvidedTotal(1729, normalized.totalAmount), /no coincide/);
assert.throws(() => canonicalizeAgentOrderItems([]), /al menos un producto/);
assert.throws(() => canonicalizeAgentOrderItems([{ productName: 'Item', quantity: 1.5, unit_price: 10 }]), /entero mayor a cero/);
assert.throws(() => canonicalizeAgentOrderItems([{ productName: 'Item', quantity: 1, unit_price: -10 }]), /importes negativos/);

console.log('OK: los pedidos de agente calculan el total desde sus ítems y rechazan datos ambiguos.');
