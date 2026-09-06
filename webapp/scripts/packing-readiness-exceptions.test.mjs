import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSourcePackingFingerprints,
  buildSourceStatuses,
  loadKnownEmptyPackingExceptions,
  matchesKnownEmptyPackingException,
} from './packing-readiness-exceptions.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

test('agrupa y normaliza los estados de fuente por envío', () => {
  const statuses = buildSourceStatuses([
    { shipment_number: 659, status: ' comprar ' },
    { shipment_number: 659, status: 'COMPRAR' },
    { shipment_number: 700, status: 'SALIENDO' },
  ]);

  assert.deepEqual(statuses.get(659), ['COMPRAR']);
  assert.deepEqual(statuses.get(700), ['SALIENDO']);
});

test('conserva el número de cabeceras para no ocultar duplicados de fuente', () => {
  const fingerprints = buildSourcePackingFingerprints([
    { shipment_number: 659, status: null },
    { shipment_number: 659, status: null },
    { shipment_number: 660, status: null },
  ]);

  assert.deepEqual(fingerprints.get(659), { statuses: [''], recordCount: 2 });
  assert.deepEqual(fingerprints.get(660), { statuses: [''], recordCount: 1 });
});

test('acepta únicamente la excepción histórica con su huella exacta', () => {
  const exception = {
    reason: 'Registro histórico no imprimible.',
    expected: {
      database_status: 'ENTREGADO',
      item_count: 1,
      source_statuses: ['COMPRAR'],
      source_record_count: 1,
    },
  };

  assert.equal(
    matchesKnownEmptyPackingException(
      { status: 'ENTREGADO', item_count: 1 },
      exception,
      { statuses: ['COMPRAR'], recordCount: 1 }
    ),
    true
  );
  assert.equal(
    matchesKnownEmptyPackingException(
      { status: 'SALIENDO', item_count: 1 },
      exception,
      { statuses: ['COMPRAR'], recordCount: 1 }
    ),
    false
  );
  assert.equal(
    matchesKnownEmptyPackingException(
      { status: 'ENTREGADO', item_count: 1 },
      exception,
      { statuses: ['SALIENDO'], recordCount: 1 }
    ),
    false
  );
  assert.equal(
    matchesKnownEmptyPackingException(
      { status: 'ENTREGADO', item_count: 2 },
      exception,
      { statuses: ['COMPRAR'], recordCount: 1 }
    ),
    false
  );
  assert.equal(
    matchesKnownEmptyPackingException(
      { status: 'ENTREGADO', item_count: 1 },
      exception,
      { statuses: ['COMPRAR'], recordCount: 2 }
    ),
    false
  );
});

test('mantiene compatibilidad con excepciones conocidas sin huella', () => {
  assert.equal(
    matchesKnownEmptyPackingException(
      { status: 'ENTREGADO', item_count: 1 },
      { reason: 'Excepción existente.', expected: null },
      []
    ),
    true
  );
});

test('expande la configuración agrupada de los 27 históricos verificados', () => {
  const exceptions = loadKnownEmptyPackingExceptions(path.join(scriptDir, '..', 'prisma'));

  assert.equal(exceptions.size, 27);
  assert.equal(exceptions.get(579).expected.database_status, 'MIAMI');
  assert.equal(exceptions.get(660).expected.database_status, 'ENTREGADO');
  assert.equal(exceptions.has(659), false);
  assert.equal(exceptions.get(1048).expected, null);
});
