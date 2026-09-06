import assert from 'node:assert/strict';
import test from 'node:test';
import { documentKey, shipmentNumberFromTransaction } from './ledger-audit-reference.mjs';

test('prioriza la referencia canónica de envío sobre texto INV incidental', () => {
  const tx = {
    reference: 'SHIP-1281:CLIENT:501',
    description: 'Cargo de envío asociado a INV2608',
  };
  assert.equal(shipmentNumberFromTransaction(tx), 1281);
  assert.equal(documentKey(tx), 'SHIPMENT:1281');
});

test('reconoce referencias de envío canónicas y legacy', () => {
  assert.equal(shipmentNumberFromTransaction({ reference: 'SHIP-1237' }), 1237);
  assert.equal(shipmentNumberFromTransaction({ description: 'Envío #1237' }), 1237);
  assert.equal(shipmentNumberFromTransaction({ description: 'Packing List 987' }), 987);
});

test('mantiene invoices y pedidos cuando no hay referencia de envío', () => {
  assert.equal(documentKey({ description: 'Invoice #2608' }), 'DOCUMENT:2608');
  assert.equal(documentKey({ description: 'Pedido 2625' }), 'DOCUMENT:2625');
});
