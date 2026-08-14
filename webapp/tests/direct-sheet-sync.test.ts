import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changedFieldPatch,
  directOrderStatus,
  directShipmentStatus,
  isDisposableZeroItem,
  isRetryableSheetsError,
  parseOperationalSheets,
  shipmentBelongsToWindow,
  sourceItemMatchKeys,
  sourceWouldEraseExistingItems,
} from '../lib/direct-sheet-sync';
import { filterPersistableSourceItems, isHistoricalReconciliationEligible, partitionOrdersByItemIntegrity } from '../lib/sync-source-integrity';

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

test('una fila con cantidad cero se interpreta como eliminación, no como línea imprimible', () => {
  const source = parseOperationalSheets({
    cabeEnvios: [['NUMERO', 'FORWARDER', 'FECHA SAL', 'FECHA LLEG', 'LLEGO?', 'OBSERVACION'], [1, 'FW', 46240, '', '', '']],
    cabeVentas: [['INVOICE', 'CLIENTE', 'NRO CLI', 'FECHA', 'METODO'], [10, 'Cliente', 1, '08/12/2026', 'Zelle']],
    detaVentas: [
      ['INV-REM', 'SKU', 'CANT', 'VTA UNI', 'COSTO', 'GANANCIA', 'DETALLE', 'ENVIO NRO', 'ESTADO'],
      [10, 'SKU-0', 0, 100, 50, 50, 'Eliminado', 1, 'MIAMI'],
      [10, 'SKU-1', 2, 100, 50, 100, 'Vigente', 1, 'MIAMI'],
    ],
  });
  assert.deepEqual(source.orders[0].items.map((item) => item.sku), ['SKU-1']);
});

test('una cantidad vacía no se confunde con una eliminación explícita', () => {
  const source = parseOperationalSheets({
    cabeEnvios: [['NUMERO', 'FORWARDER', 'FECHA SAL', 'FECHA LLEG', 'LLEGO?', 'OBSERVACION'], [1, 'FW', 46240, '', '', '']],
    cabeVentas: [['INVOICE', 'CLIENTE', 'NRO CLI', 'FECHA', 'METODO'], [10, 'Cliente', 1, '08/12/2026', 'Zelle']],
    detaVentas: [
      ['INV-REM', 'SKU', 'CANT', 'VTA UNI', 'COSTO', 'GANANCIA', 'DETALLE', 'ENVIO NRO', 'ESTADO'],
      [10, 'SKU-PENDIENTE', '', 100, 50, 50, 'Edición incompleta', 1, 'MIAMI'],
    ],
  });
  assert.equal(source.orders[0].items.length, 1);
  assert.equal(source.orders[0].items[0].quantity, 0);
});

test('una fila residual en cero sin metadatos no cuenta como detalle comercial', () => {
  assert.equal(isDisposableZeroItem({
    quantity: 0,
    shipping_cost: null,
    supplierId: null,
    purchase_invoice: null,
    _count: { allocations: 0 },
  }), true);
  assert.equal(isDisposableZeroItem({
    quantity: 0,
    shipping_cost: null,
    supplierId: null,
    purchase_invoice: null,
    _count: { allocations: 1 },
  }), false);
  assert.equal(isDisposableZeroItem({
    quantity: 1,
    shipping_cost: null,
    supplierId: null,
    purchase_invoice: null,
    _count: { allocations: 0 },
  }), false);
});

test('un SKU nuevo nunca hereda el producto anterior por coincidencia de nombre', () => {
  assert.deepEqual(sourceItemMatchKeys({ sku: 'SKU-NUEVO', productName: 'Mismo nombre' }), ['S:SKU-NUEVO']);
  assert.deepEqual(sourceItemMatchKeys({ sku: null, productName: 'Mismo nombre' }), ['N:MISMO NOMBRE']);
});

test('FULL elimina solo un cero explícito antes de persistir', () => {
  const items = [
    { sku: 'ACTIVO', quantity: 2, quantity_is_explicit: true },
    { sku: 'ELIMINADO', quantity: 0, quantity_is_explicit: true },
    { sku: 'EN-EDICION', quantity: 0, quantity_is_explicit: false },
  ];
  assert.deepEqual(filterPersistableSourceItems(items).map((item) => item.sku), ['ACTIVO', 'EN-EDICION']);
});

test('FULL pone en cuarentena un invoice con cantidad vacía o inválida', () => {
  const source = [{
    order_number: 100,
    items: [
      { quantity_is_explicit: true },
      { quantity_is_explicit: false },
    ],
  }];
  const result = partitionOrdersByItemIntegrity(source, new Map([
    [100, { orderId: 1, itemCount: 2 }],
  ]), true);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.quarantined[0].reason, 'INCOMPLETE_QUANTITY');
});

test('la reconciliación histórica nunca salta la cuarentena de una reducción', () => {
  assert.equal(isHistoricalReconciliationEligible(100, new Set(), new Set([100])), false);
  assert.equal(isHistoricalReconciliationEligible(100, new Set([100]), new Set()), false);
  assert.equal(isHistoricalReconciliationEligible(100, new Set(), new Set()), true);
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

test('un pedido reducido queda en cuarentena sin bloquear los pedidos sanos', () => {
  const source = [
    { order_number: 100, items: [{ sku: 'A' }] },
    { order_number: 101, items: [{ sku: 'B' }, { sku: 'C' }] },
  ];
  const result = partitionOrdersByItemIntegrity(source, new Map([
    [100, { orderId: 1, itemCount: 3 }],
    [101, { orderId: 2, itemCount: 2 }],
  ]));

  assert.deepEqual(result.accepted.map((order) => order.order_number), [101]);
  assert.equal(result.quarantined.length, 1);
  assert.deepEqual(result.quarantined[0], {
    order: source[0], orderId: 1, sourceItemCount: 1, existingItemCount: 3, reason: 'ITEM_REDUCTION',
  });
});

test('una reduccion solo se acepta con reconciliacion destructiva explicita', () => {
  const source = [{ order_number: 100, items: [] }];
  const result = partitionOrdersByItemIntegrity(
    source,
    new Map([[100, { orderId: 1, itemCount: 3 }]]),
    true,
  );
  assert.equal(result.accepted.length, 1);
  assert.equal(result.quarantined.length, 0);
});

test('la ventana directa excluye envios historicos no relacionados', () => {
  const related = new Set([501]);
  assert.equal(shipmentBelongsToWindow({ shipment_number: 500, date_shipped: '2026-07-01' }, '2026-08-04', related), false);
  assert.equal(shipmentBelongsToWindow({ shipment_number: 501, date_shipped: '2026-07-01' }, '2026-08-04', related), true);
  assert.equal(shipmentBelongsToWindow({ shipment_number: 502, date_arrived: '2026-08-10' }, '2026-08-04', related), true);
});

test('un envio terminal nunca retrocede por un estado viejo de Sheets', () => {
  assert.equal(directShipmentStatus({ existingStatus: 'ENTREGADO', sourceStatus: 'SALIENDO' }), 'ENTREGADO');
  assert.equal(directShipmentStatus({ existingStatus: 'CANCELADO', sourceStatus: 'MIAMI' }), 'CANCELADO');
  assert.equal(directShipmentStatus({ existingStatus: 'MIAMI', sourceStatus: 'SALIENDO' }), 'SALIENDO');
});

test('un pedido terminal nunca retrocede por un estado viejo de Sheets', () => {
  assert.equal(directOrderStatus('ENTREGADO', 'SALIENDO'), 'ENTREGADO');
  assert.equal(directOrderStatus('CANCELADO', 'MIAMI'), 'CANCELADO');
  assert.equal(directOrderStatus('MIAMI', 'SALIENDO'), 'SALIENDO');
});

test('reintenta solo errores transitorios de Google Sheets', () => {
  assert.equal(isRetryableSheetsError({ response: { status: 429 } }), true);
  assert.equal(isRetryableSheetsError({ response: { status: 503 } }), true);
  assert.equal(isRetryableSheetsError({ name: 'AbortError' }), true);
  assert.equal(isRetryableSheetsError({ response: { status: 403 } }), false);
});
