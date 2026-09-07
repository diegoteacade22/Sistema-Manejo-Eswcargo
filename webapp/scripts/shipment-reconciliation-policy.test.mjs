import assert from 'node:assert/strict';
import test from 'node:test';
import { isAuditableShipmentItem } from './shipment-reconciliation-policy.mjs';

test('omite cantidades cero explícitas igual que el importador', () => {
  assert.equal(isAuditableShipmentItem({ shipment_number: 1261, quantity: 0, quantity_is_explicit: true }), false);
  assert.equal(isAuditableShipmentItem({ shipment_number: 1261, quantity: 0, quantity_is_explicit: false }), true);
  assert.equal(isAuditableShipmentItem({ shipment_number: null, quantity: 1 }), false);
  assert.equal(isAuditableShipmentItem({ shipment_number: 1261, quantity: 1, quantity_is_explicit: true }), true);
});
