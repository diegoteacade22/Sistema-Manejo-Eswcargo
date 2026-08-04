import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveShipmentStatus,
  shipmentOrderItemStatusWhere,
  shipmentOrderStatusWhere,
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

test('estados de pedidos o basura no pueden entrar al seed de Shipment', () => {
  for (const invalidValue of ['COMPRAR', ' comprar ', 'SI', '100', '200', '#REF!']) {
    const sourceStatus = sourceShipmentStatus(invalidValue);
    const patch = shipmentStatusPatch(invalidValue);

    assert.equal(sourceStatus, null);
    assert.equal(Object.hasOwn(patch, 'status'), false);
  }
});

test('las escrituras manuales rechazan estados no logísticos', () => {
  assert.throws(() => validateManualShipmentStatus('COMPRAR'), /no es válido/);
  assert.throws(() => validateManualShipmentStatus(' comprar '));
  assert.throws(() => validateManualShipmentStatus('SI'));
  assert.equal(validateManualShipmentStatus(' SALIENDO '), 'SALIENDO');
  assert.equal(validateManualShipmentStatus('LLEGANDO'), 'LLEGANDO');
});

test('la llegada real vence como máximo al día siguiente', () => {
  const now = new Date('2026-08-04T16:00:00.000Z');

  assert.equal(resolveShipmentStatus({
    sourceStatus: 'SALIENDO',
    dateArrived: '2026-08-03T00:00:00.000Z',
    now,
  }), 'ENTREGADO');
  assert.equal(resolveShipmentStatus({
    sourceStatus: 'LLEGANDO',
    dateArrived: '2026-08-04T00:00:00.000Z',
    now,
  }), 'EN BSAS');
  assert.throws(
    () => validateManualShipmentStatus('LLEGANDO', {
      dateArrived: '2026-08-03T00:00:00.000Z',
      now,
    }),
    /debe ser ENTREGADO/,
  );
});

test('preserva estados terminales y estados explícitos válidos sin llegada', () => {
  const now = new Date('2026-08-04T16:00:00.000Z');

  assert.equal(resolveShipmentStatus({
    sourceStatus: 'CANCELADO',
    dateArrived: '2026-07-01T00:00:00.000Z',
    now,
  }), 'CANCELADO');
  assert.equal(resolveShipmentStatus({
    existingStatus: 'ENTREGADO',
    dateArrived: '2026-08-04T00:00:00.000Z',
    now,
  }), 'ENTREGADO');
  assert.equal(resolveShipmentStatus({ existingStatus: 'LLEGANDO', now }), 'LLEGANDO');
});

test('un estado inválido recibe un fallback conservador y nunca queda vacío', () => {
  const now = new Date('2026-08-04T16:00:00.000Z');

  assert.equal(resolveShipmentStatus({ sourceStatus: 'COMPRAR', dateShipped: '2026-08-04', now }), 'SALIENDO');
  assert.equal(resolveShipmentStatus({ sourceStatus: 'COMPRAR', dateShipped: '2026-08-05', now }), 'MIAMI');
  assert.equal(resolveShipmentStatus({ sourceStatus: null, now }), 'MIAMI');
  assert.equal(resolveShipmentStatus({ sourceStatus: 'SI', dateArrived: '2026-08-05', now }), 'LLEGANDO');
  assert.equal(resolveShipmentStatus({ existingStatus: 'EN_TRANSITO', now }), 'LLEGANDO');
});

test('un estado explicito de CABE_ENVIOS si se incluye en el seed', () => {
  assert.deepEqual(shipmentStatusPatch(' SALIENDO '), { status: 'SALIENDO' });
  assert.deepEqual(shipmentStatusPatch('LLEGANDO'), { status: 'LLEGANDO' });
  assert.equal(sourceShipmentStatusChanged('SALIENDO', 'LLEGANDO'), true);
});

test('un item asignado a otro envio no cambia por la cabecera de su pedido', () => {
  assert.deepEqual(shipmentOrderItemStatusWhere([101, 102]), {
    AND: [
      {
        OR: [
          { shipmentId: { in: [101, 102] } },
          {
            shipmentId: null,
            order: { shipmentId: { in: [101, 102] } },
          },
        ],
      },
      { status: { in: ['MIAMI', 'SALIENDO', 'SALIENDO MIAMI', 'LLEGANDO', 'EN TRANSITO', 'EN_TRANSITO', 'EN BSAS', 'EN 🇦🇷', 'RECIBIDO BSAS', 'ARRIBADO'] } },
    ],
  });
  assert.deepEqual(shipmentOrderStatusWhere([101, 102]), {
    shipmentId: { in: [101, 102] },
    status: { in: ['MIAMI', 'SALIENDO', 'SALIENDO MIAMI', 'LLEGANDO', 'EN TRANSITO', 'EN_TRANSITO', 'EN BSAS', 'EN 🇦🇷', 'RECIBIDO BSAS', 'ARRIBADO'] },
  });
});
