import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceDecisionBlock } from '../lib/source-document-guard';

test('un rechazo operativo conserva imprimible la última versión confirmada', () => {
  assert.equal(sourceDecisionBlock('REJECTED', 'Detalle incompleto'), null);
});

test('un bloqueo explícito de la versión persistida impide emitir', () => {
  assert.match(sourceDecisionBlock('BLOCKED', 'Detalle persistido inválido') || '', /persistido inválido/);
});

test('una verificación posterior libera el documento', () => {
  assert.equal(sourceDecisionBlock('UPDATED', 'Invoice verificado'), null);
  assert.equal(sourceDecisionBlock('REPLACED', 'Detalle reemplazado'), null);
});
