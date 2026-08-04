import assert from 'node:assert/strict';
import test from 'node:test';
import {
  shipmentOrderItemStatusWhere,
  shipmentStatusPatch,
  sourceShipmentStatus,
  sourceShipmentStatusChanged,
  validateManualShipmentStatus,
} from '../lib/shipment-sync-status';

test('CABE_ENVIOS vacio no produce un status ni el fallback COMPRAR', () => {
  for (const blankValue of [null, undefined, '', '   ']) {
    const sourceStatus = sourceShipmentStatus(blankValue);
    const patch = shipmentStatusPatch(blankValue);

    assert.equal(sourceStatus, null);
    assert.equal(Object.hasOwn(patch, 'status'), false);
    assert.notEqual(patch.status, 'COMPRAR');
  }
});

test('un CABE_ENVIOS vacio preserva SALIENDO y LLEGANDO existentes', () => {
  const blankSource = sourceShipmentStatus('');

  assert.equal(sourceShipmentStatusChanged('SALIENDO', blankSource), false);
  assert.equal(sourceShipmentStatusChanged('LLEGANDO', blankSource), false);
});

test('COMPRAR explicito tampoco puede entrar al seed de Shipment', () => {
  for (const invalidValue of ['COMPRAR', ' comprar ']) {
    const sourceStatus = sourceShipmentStatus(invalidValue);
    const patch = shipmentStatusPatch(invalidValue);

    assert.equal(sourceStatus, null);
    assert.equal(Object.hasOwn(patch, 'status'), false);
  }
});

test('las escrituras manuales rechazan COMPRAR para Shipment', () => {
  assert.throws(
    () => validateManualShipmentStatus('COMPRAR'),
    /no es un estado válido para un envío/,
  );
  assert.throws(() => validateManualShipmentStatus(' comprar '));
  assert.equal(validateManualShipmentStatus(' SALIENDO '), 'SALIENDO');
  assert.equal(validateManualShipmentStatus('LLEGANDO'), 'LLEGANDO');
});

test('un estado explicito de CABE_ENVIOS si se incluye en el seed', () => {
  assert.deepEqual(shipmentStatusPatch(' SALIENDO '), { status: 'SALIENDO' });
  assert.deepEqual(shipmentStatusPatch('LLEGANDO'), { status: 'LLEGANDO' });
  assert.equal(sourceShipmentStatusChanged('SALIENDO', 'LLEGANDO'), true);
});

test('un item asignado a otro envio no cambia por la cabecera de su pedido', () => {
  assert.deepEqual(shipmentOrderItemStatusWhere([101, 102]), {
    OR: [
      { shipmentId: { in: [101, 102] } },
      {
        shipmentId: null,
        order: { shipmentId: { in: [101, 102] } },
      },
    ],
  });
});
