import { reconcileCashflowRows } from '../lib/cashflow-reconciliation.mjs';

const source = [
  { reference: 'CF:1', date: '2026-07-01T00:01:00.000Z', type: 'CARGO', amount: -100, description: 'INV 1' },
  { reference: 'CF:2', date: '2026-07-02T00:02:00.000Z', type: 'PAGO', amount: 100, description: 'Pago INV 1' },
  { reference: 'CF:3', date: '2026-07-03T00:03:00.000Z', type: 'CARGO', amount: -50, description: 'INV 2' },
  { reference: 'CF:4', date: '2026-07-04T00:04:00.000Z', type: 'CARGO', amount: -20, description: 'INV 3' },
];

const raw = [
  { id: 1, reference: 'CF:1', date: new Date('2026-07-01T00:00:00.000Z'), type: 'CARGO', amount: -100, description: 'INV 1' },
  { id: 2, reference: 'CF:9', date: new Date('2026-07-02T00:00:00.000Z'), type: 'PAGO', amount: 100, description: 'Pago INV 1' },
  { id: 3, reference: 'CF:3', date: new Date('2026-07-03T00:00:00.000Z'), type: 'PAGO', amount: 50, description: 'INV 2' },
  { id: 4, reference: 'CF:extra', date: new Date('2026-07-05T00:00:00.000Z'), type: 'CARGO', amount: -10, description: 'Otro' },
];

const result = reconcileCashflowRows(source, raw);
if (result.exactRows !== 1 || result.relocatedRows !== 1 || result.oppositeSignRows !== 1 || result.missingRows !== 1 || result.extraRows !== 1) {
  throw new Error(`Resultado inesperado: ${JSON.stringify(result)}`);
}

console.log('OK: la conciliación separa filas reubicadas de diferencias financieras reales.');
