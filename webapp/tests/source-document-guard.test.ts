import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceDecisionBlock } from '../lib/source-document-guard';

test('un rechazo operativo mantiene bloqueado el documento', () => {
  assert.match(sourceDecisionBlock('REJECTED', 'Detalle incompleto') || '', /Detalle incompleto/);
});

test('una verificación posterior libera el documento', () => {
  assert.equal(sourceDecisionBlock('UPDATED', 'Invoice verificado'), null);
  assert.equal(sourceDecisionBlock('REPLACED', 'Detalle reemplazado'), null);
});
