import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changedFieldPatch,
  directShipmentStatus,
  isRetryableSheetsError,
  parseOperationalSheets,
  sourceWouldEraseExistingItems,
} from '../lib/direct-sheet-sync';

test('parsea las tres hojas operativas y conserva estados en blanco', () => {
  const source = parseOperationalSheets({
    cabeEnvios: [
      ['NUMERO', 'COD CLI', 'CLIENTE', 'FORWARDER', 'FECHA SAL', 'FECHA LLEG', 'PESO', 'PESO', 'TIPO', 'TIPO CARGA', 'CANT ART', 'COSTO TOT', 'ENVIO COB', 'GANANCIA', 'LLEGO?', 'OBSERVACION'],
      [501, 77, 'Cliente Uno', 'FW', 46240, '', 10, 9, 'IGNORAR', 'CELS', 2, 100, 150, 50, '', 'nota'],
    ],
    cabeVentas: [
      ['titulo'],
      ['INVOICE', 'NRO CLI', 'CLIENTE', 'FECHA', 'METODO', 'ESTADO'],
      [9001, 77, 'Cliente Uno', '08/05/2026', 'Zelle', ''],
    ],
    detaVentas: [
      ['INV-REM', 'SKU', 'CANT', 'VTA UNI', 'COSTO', 'GANANCIA', 'DETALLE', 'ENVIO NRO', 'ESTADO', 'COD CLI', 'NOMBRE'],
      [9001, 'SKU-1', 2, 300, 200, 200, 'Telefono', 501, '', 77, 'Cliente Uno'],
    ],
  });

  assert.equal(source.shipments.length, 1);
  assert.equal(source.shipments[0].shipmentNumber, 501);
  assert.equal(source.shipments[0].weightClient, 9);
  assert.equal(source.shipments[0].typeLoad, 'CELS');
  assert.equal(source.shipments[0].status, null);
  assert.equal(source.orders[0].orderNumber, 9001);
  assert.equal(source.orders[0].items[0].status, null);
  assert.equal(source.orders[0].items[0].shipmentNumber, 501);
});

test('delta escribe solo campos cambiados y puede preservar blancos', () => {
  const existing = { status: 'SALIENDO', forwarder: 'A', price: 100, notes: 'anterior' };
  const patch = changedFieldPatch(existing, {
    status: null,
    forwarder: 'B',
    price: 100,
    notes: 'anterior',
  }, { preserveBlank: ['status'] });

  assert.deepEqual(patch, { forwarder: 'B' });
});

test('una segunda comparacion identica produce delta vacio', () => {
  const current = { status: 'ENTREGADO', total: 600, shipmentId: 20 };
  assert.deepEqual(changedFieldPatch(current, { ...current }), {});
});

test('la comparacion de fechas ignora diferencias de hora del mismo dia', () => {
  const current = { date: new Date('2026-08-05T04:00:00.000Z') };
  const source = { date: new Date('2026-08-05T00:00:00.000Z') };
  assert.deepEqual(changedFieldPatch(current, source), {});
});

test('los blancos de la fuente no borran campos operativos protegidos', () => {
  const current = {
    status: 'EN TRANSITO',
    forwarder: 'Miami Cargo',
    date_shipped: new Date('2026-08-01T00:00:00.000Z'),
    notes: 'Preservar',
  };
  const source = { status: null, forwarder: '', date_shipped: null, notes: undefined };
  assert.deepEqual(changedFieldPatch(current, source, {
    preserveBlank: ['status', 'forwarder', 'date_shipped', 'notes'],
  }), {});
});

test('falla cerrado cuando falta una columna critica', () => {
  assert.throws(() => parseOperationalSheets({
    cabeEnvios: [
      ['NUMERO', 'COD CLI', 'CLIENTE', 'FORWARDER', 'FECHA SAL', 'FECHA LLEG', 'PESO', 'PESO', 'TIPO CARGA', 'CANT ART', 'COSTO TOT', 'ENVIO COB', 'GANANCIA', 'LLEGO?', 'OBSERVACION'],
    ],
    cabeVentas: [
      ['INVOICE', 'NRO CLI', 'CLIENTE', 'FECHA', 'METODO', 'ESTADO'],
    ],
    detaVentas: [
      ['INV-REM', 'SKU', 'CANT', 'COSTO', 'GANANCIA', 'DETALLE', 'ENVIO NRO', 'ESTADO', 'COD CLI', 'NOMBRE'],
    ],
  }), /VTA UNI/);
});

test('una fuente parcial nunca borra items existentes', () => {
  assert.equal(sourceWouldEraseExistingItems(0, 3), true);
  assert.equal(sourceWouldEraseExistingItems(1, 3), false);
  assert.equal(sourceWouldEraseExistingItems(0, 0), false);
});

test('un envio terminal nunca retrocede por un estado viejo de Sheets', () => {
  assert.equal(directShipmentStatus({ existingStatus: 'ENTREGADO', sourceStatus: 'SALIENDO' }), 'ENTREGADO');
  assert.equal(directShipmentStatus({ existingStatus: 'CANCELADO', sourceStatus: 'MIAMI' }), 'CANCELADO');
  assert.equal(directShipmentStatus({ existingStatus: 'MIAMI', sourceStatus: 'SALIENDO' }), 'SALIENDO');
});

test('reintenta solo errores transitorios de Google Sheets', () => {
  assert.equal(isRetryableSheetsError({ response: { status: 429 } }), true);
  assert.equal(isRetryableSheetsError({ response: { status: 503 } }), true);
  assert.equal(isRetryableSheetsError({ name: 'AbortError' }), true);
  assert.equal(isRetryableSheetsError({ response: { status: 403 } }), false);
});
