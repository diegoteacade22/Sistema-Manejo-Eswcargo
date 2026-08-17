import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPriceListStatus, isPriceListStatusIntent } from '@/lib/price-list-status';

test('detecta consultas de carga de listas y no consultas de correo', () => {
  assert.equal(isPriceListStatusIntent('¿Cargué alguna lista de precios hoy?'), true);
  assert.equal(isPriceListStatusIntent('¿Qué correos entraron hoy?'), false);
});

test('responde con cantidad y proveedores registrados', () => {
  const response = formatPriceListStatus({
    date: '2026-08-17',
    loadedCount: 2,
    failedCount: 0,
    providers: ['ACME', 'NOVA'],
    loads: [],
  });
  assert.match(response, /2 listas/);
  assert.match(response, /ACME, NOVA/);
});

test('distingue ausencia de carga', () => {
  const response = formatPriceListStatus({
    date: '2026-08-17',
    loadedCount: 0,
    failedCount: 0,
    providers: [],
    loads: [],
  });
  assert.match(response, /No tengo registrada/);
  assert.match(response, /no usa Gmail/);
});
