import assert from 'node:assert/strict';
import test from 'node:test';
import { extractionSchema, ingestRequestSchema } from '../lib/ingestion/contracts';
import { matchCatalog, normalizeWords } from '../lib/ingestion/normalize';
import { validateTraceability } from '../lib/ingestion/service';

test('valida el contrato de entrada y rechaza campos inesperados', () => {
  assert.equal(ingestRequestSchema.parse({ text: 'IPH 16PM 256 BLK $999' }).text.length, 21);
  assert.throws(() => ingestRequestSchema.parse({ text: '', secret: 'x' }));
});

test('la extracción exige todos los campos del contrato', () => {
  assert.throws(() => extractionSchema.parse({
    supplier: null,
    items: [{ lineNumber: 1, rawLine: 'iPhone' }],
  }));
});

test('normaliza abreviaturas y acepta sólo una coincidencia fuerte', () => {
  assert.deepEqual(normalizeWords('IPH 16PM 256GB BLK'), ['iphone', '16pm', '256', 'gb', 'black']);
  const item = {
    lineNumber: 1,
    rawLine: 'IPH 16PM 256GB BLK $999',
    product: 'iPhone',
    exactModel: '16 Pro Max',
    capacity: '256GB',
    color: 'Black',
    condition: null,
    region: null,
    costUsd: 999,
    availability: null,
    quantity: null,
    observations: null,
  };
  const match = matchCatalog(item, [{
    id: 1,
    sku: 'IPH-16PM-256-BLK',
    name: 'Apple iPhone 16 Pro Max 256GB Black',
    model: 'iPhone 16 Pro Max',
    brand: 'Apple',
    color_grade: 'Black',
  }]);
  assert.equal(match.product?.id, 1);
});

test('manda a revisión una coincidencia ambigua', () => {
  const item = {
    lineNumber: 1,
    rawLine: 'iPhone 16',
    product: 'iPhone 16',
    exactModel: null,
    capacity: null,
    color: null,
    condition: null,
    region: null,
    costUsd: 800,
    availability: null,
    quantity: null,
    observations: null,
  };
  const match = matchCatalog(item, [
    { id: 1, sku: 'A', name: 'Apple iPhone 16 Black', model: 'iPhone 16', brand: 'Apple', color_grade: 'Black' },
    { id: 2, sku: 'B', name: 'Apple iPhone 16 White', model: 'iPhone 16', brand: 'Apple', color_grade: 'White' },
  ]);
  assert.equal(match.product, null);
  assert.match(match.reason || '', /ambigua/);
});

test('acepta una identidad única por modelo, capacidad, color y región', () => {
  const item = {
    lineNumber: 1,
    rawLine: 'iPhone 16 Pro Max 256GB Black Titanium NEW US $1095 x1',
    product: 'iPhone 16 Pro Max',
    exactModel: null,
    capacity: '256GB',
    color: 'Black Titanium',
    condition: 'NEW',
    region: null,
    costUsd: 1095,
    availability: null,
    quantity: 1,
    observations: null,
  };
  const match = matchCatalog(item, [
    { id: 382, sku: 'IP16PM-256-US-BT', name: 'iPhone 16 Pro Max 256GB US', model: 'iPhone 16 Pro Max', brand: 'Apple', color_grade: 'Black Titanium' },
    { id: 383, sku: 'IP16PM-256-CA-BT', name: 'iPhone 16 Pro Max 256GB CA', model: 'iPhone 16 Pro Max', brand: 'Apple', color_grade: 'Black Titanium' },
  ]);
  assert.equal(match.product?.id, 382);
  assert.equal(match.reason, null);
});

test('exige fecha ISO con zona horaria', () => {
  assert.throws(() => ingestRequestSchema.parse({ text: 'producto', receivedAt: '2026-08-15T14:30:00' }));
  assert.equal(
    ingestRequestSchema.parse({ text: 'producto', receivedAt: '2026-08-15T14:30:00Z' }).receivedAt,
    '2026-08-15T14:30:00Z',
  );
});

test('verifica trazabilidad literal y números de línea únicos', () => {
  validateTraceability('uno\ndos', [
    { lineNumber: 1, rawLine: 'uno' },
    { lineNumber: 2, rawLine: 'dos' },
  ]);
  assert.throws(() => validateTraceability('uno\ndos', [{ lineNumber: 1, rawLine: 'inventado' }]));
  assert.throws(() => validateTraceability('uno\ndos', [
    { lineNumber: 1, rawLine: 'uno' },
    { lineNumber: 1, rawLine: 'uno' },
  ]));
});
