import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveShipmentStatus,
  resolveSheetShipmentStatus,
  shipmentBusinessDateKey,
  shipmentOrderItemStatusWhere,
  shipmentOrderStatusWhere,
  shipmentStatusPatch,
  shouldUseAuthoritativeShipmentHeader,
  sourceShipmentStatus,
  sourceShipmentStatusChanged,
  unanimousSourceShipmentStatus,
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

test('la importación respeta el estado explícito y sólo deriva fechas cuando está vacío', () => {
  const now = new Date('2026-08-13T16:00:00.000Z');
  assert.equal(resolveSheetShipmentStatus({
    sourceStatus: 'LLEGANDO',
    existingStatus: 'ENTREGADO',
    dateArrived: '2026-08-11',
    now,
  }), 'LLEGANDO');
  assert.equal(resolveSheetShipmentStatus({
    sourceStatus: null,
    existingStatus: 'SALIENDO',
    dateArrived: '2026-08-11',
    now,
  }), 'ENTREGADO');
  assert.equal(shipmentBusinessDateKey(now), '2026-08-13');
});

test('DETA sólo proyecta un estado de Packing cuando todas sus líneas coinciden', () => {
  assert.equal(unanimousSourceShipmentStatus(['LLEGANDO', 'EN TRANSITO']), 'LLEGANDO');
  assert.equal(unanimousSourceShipmentStatus(['LLEGANDO', 'ENTREGADO']), null);
  assert.equal(unanimousSourceShipmentStatus(['LLEGANDO', 'VENDIDO']), null);
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

test('la autoridad de CABE persiste en una segunda comparación completa', () => {
  assert.equal(shouldUseAuthoritativeShipmentHeader({
    shipmentNumber: 1264,
    status: 'LLEGANDO',
    previousHeaders: { '1264': null },
    previousAuthority: {},
  }), true);
  assert.equal(shouldUseAuthoritativeShipmentHeader({
    shipmentNumber: 1264,
    status: 'LLEGANDO',
    previousHeaders: { '1264': 'LLEGANDO' },
    previousAuthority: { '1264': 'LLEGANDO' },
  }), true);
  assert.equal(shouldUseAuthoritativeShipmentHeader({
    shipmentNumber: 1264,
    status: 'LLEGANDO',
    previousHeaders: { '1264': 'LLEGANDO' },
    previousAuthority: {},
  }), false);
});
