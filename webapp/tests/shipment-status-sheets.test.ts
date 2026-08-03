import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildShipmentSheetPlan,
  canonicalizeShipmentStatus,
  shouldAdvanceAutomatedStatus,
} from '../lib/shipment-status-sheets';
import { sourceShipmentStatus, sourceShipmentStatusChanged } from '../lib/shipment-sync-status';

test('canonicaliza los estados de Buenos Aires igual que IMPORTSYS', () => {
  assert.equal(canonicalizeShipmentStatus('EN BSAS'), 'EN 🇦🇷');
  assert.equal(canonicalizeShipmentStatus('recibido bsas'), 'EN 🇦🇷');
});

test('la automatizacion nunca rebaja un estado manual mas avanzado', () => {
  assert.equal(shouldAdvanceAutomatedStatus('EN 🇦🇷', 'LLEGANDO'), false);
  assert.equal(shouldAdvanceAutomatedStatus('ENTREGADO', 'EN 🇦🇷'), false);
  assert.equal(shouldAdvanceAutomatedStatus('SALIENDO', 'LLEGANDO'), true);
});

test('la sincronizacion preserva el estado existente si CABE_ENVIOS esta vacio', () => {
  const blankSource = sourceShipmentStatus('');
  assert.equal(blankSource, null);
  assert.equal(sourceShipmentStatusChanged('SALIENDO', blankSource), false);
  assert.equal(sourceShipmentStatusChanged('LLEGANDO', blankSource), false);
  assert.equal(sourceShipmentStatusChanged('COMPRAR', sourceShipmentStatus('SALIENDO')), true);
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

test('permite envios sin DETA y preserva estados no elegibles como ENTREGADO', () => {
  const plan = buildShipmentSheetPlan(
      {
        cabeNumbers: [1244],
        cabeStatuses: [''],
        detailDates: ['7/28/2026', '7/28/2026'],
        detailShipmentNumbers: [1244, 1244],
        detailStatuses: ['LLEGANDO', 'ENTREGADO'],
      },
      [{ shipmentId: 10, shipmentNumber: 1244, orderDates: ['2026-07-28'] }],
      'LLEGANDO',
      'EN BSAS'
  );

  assert.deepEqual(plan.updates.map((update) => update.range), [
    'CABE_ENVIOS!X2',
    'DETA_VENTAS!M2',
  ]);
});

test('actualiza todas las filas CABE de una ficha repetida sin ampliar el lote', () => {
  const plan = buildShipmentSheetPlan(
    {
      cabeNumbers: [1244, 1244, 1243],
      cabeStatuses: ['', 'LLEGANDO', ''],
      detailDates: ['7/28/2026', '7/28/2026'],
      detailShipmentNumbers: [1244, 1243],
      detailStatuses: ['LLEGANDO', 'LLEGANDO'],
    },
    [{ shipmentId: 10, shipmentNumber: 1244, orderDates: ['2026-07-28'] }],
    'LLEGANDO',
    'EN BSAS',
    'sheet-test'
  );

  assert.deepEqual(plan.cabeRangesByShipment[1244], ['CABE_ENVIOS!X2', 'CABE_ENVIOS!X3']);
  assert.deepEqual(plan.updates.map((update) => update.range), [
    'CABE_ENVIOS!X2',
    'CABE_ENVIOS!X3',
    'DETA_VENTAS!M2',
  ]);
});
