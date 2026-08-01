import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildShipmentSheetPlan,
  canonicalizeShipmentStatus,
  shouldAdvanceAutomatedStatus,
} from '../lib/shipment-status-sheets';

test('canonicaliza los estados de Buenos Aires igual que IMPORTSYS', () => {
  assert.equal(canonicalizeShipmentStatus('EN BSAS'), 'EN 🇦🇷');
  assert.equal(canonicalizeShipmentStatus('recibido bsas'), 'EN 🇦🇷');
});

test('la automatizacion nunca rebaja un estado manual mas avanzado', () => {
  assert.equal(shouldAdvanceAutomatedStatus('EN 🇦🇷', 'LLEGANDO'), false);
  assert.equal(shouldAdvanceAutomatedStatus('ENTREGADO', 'EN 🇦🇷'), false);
  assert.equal(shouldAdvanceAutomatedStatus('SALIENDO', 'LLEGANDO'), true);
});

test('solo prepara CABE_ENVIOS X y DETA_VENTAS M para numero y fecha asociados', () => {
  const plan = buildShipmentSheetPlan(
    {
      cabeNumbers: [1251, 1246, 1245, 1244],
      cabeStatuses: ['', '', '', ''],
      detailDates: ['7/28/2026', '7/28/2026', '7/29/2026', '7/28/2026'],
      detailShipmentNumbers: [1244, 1244, 1244, 9999],
      detailStatuses: ['LLEGANDO', 'LLEGANDO', 'LLEGANDO', 'LLEGANDO'],
    },
    [{ shipmentId: 10, shipmentNumber: 1244, orderDates: ['2026-07-28'] }],
    'LLEGANDO',
    'EN BSAS',
    'sheet-test'
  );

  assert.deepEqual(
    plan.updates.map((update) => update.range),
    ['CABE_ENVIOS!X5', 'DETA_VENTAS!M2', 'DETA_VENTAS!M3']
  );
  assert.ok(plan.updates.every((update) => update.nextValue === 'EN 🇦🇷'));
});

test('detiene el lote si CABE_ENVIOS tiene un estado incompatible', () => {
  assert.throws(
    () => buildShipmentSheetPlan(
      {
        cabeNumbers: [1244],
        cabeStatuses: ['ENTREGADO'],
        detailDates: [],
        detailShipmentNumbers: [],
        detailStatuses: [],
      },
      [{ shipmentId: 10, shipmentNumber: 1244, orderDates: ['2026-07-28'] }],
      'LLEGANDO',
      'EN BSAS'
    ),
    /Conflicto/
  );
});

test('detiene el lote si un envio no tiene filas asociadas en DETA_VENTAS', () => {
  assert.throws(
    () => buildShipmentSheetPlan(
      {
        cabeNumbers: [1244],
        cabeStatuses: ['LLEGANDO'],
        detailDates: ['7/29/2026'],
        detailShipmentNumbers: [1244],
        detailStatuses: ['LLEGANDO'],
      },
      [{ shipmentId: 10, shipmentNumber: 1244, orderDates: ['2026-07-28'] }],
      'LLEGANDO',
      'EN BSAS'
    ),
    /no tiene coincidencias en DETA_VENTAS/
  );
});
