import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeResultNeedsReview } from '../lib/company-os/runtime-outcome';
import { findCompletedRuntimeDelegation, runtimeFollowUpCapacity } from '../lib/company-os/runtime-delegation';

const analysis = {
  output: { confidence: 0.9, needsHumanDecision: false, missions: [{ status: 'PLANNED', title: 'Revisar cobertura' }] },
  agentId: 'general-manager-ai-v3', canContinue: true, minConfidence: 0.75,
};

test('el análisis con propuestas PLANNED termina sin aprobación rutinaria', () => {
  assert.equal(runtimeResultNeedsReview(analysis), false);
  assert.equal(analysis.output.missions[0].status, 'PLANNED');
});

test('conserva revisión para decisión explícita, evidencia insuficiente y confianza inválida', () => {
  assert.equal(runtimeResultNeedsReview({ ...analysis, output: { ...analysis.output, needsHumanDecision: true } }), true);
  assert.equal(runtimeResultNeedsReview({ ...analysis, output: { ...analysis.output, confidence: 0.74 } }), true);
  assert.equal(runtimeResultNeedsReview({ ...analysis, output: { ...analysis.output, confidence: undefined } }), true);
});

test('no declara cierre cuando se agotaron turnos y falta integrar o delegar', () => {
  assert.equal(runtimeResultNeedsReview({ ...analysis, canContinue: false, agentId: 'data-manager-ai-v1' }), true);
  assert.equal(runtimeResultNeedsReview({ ...analysis, canContinue: false, output: { ...analysis.output, delegations: [{}] } }), true);
  assert.equal(runtimeResultNeedsReview({ ...analysis, canContinue: false }), false);
});

test('suprime repetir objetivo Data ya completado con la misma evidencia o un subconjunto', () => {
  const completed = [{ workItemId: 'initial-data-completed', agentId: 'data-manager-ai-v1',
    objective: 'Actualizá la calidad y frescura.', evidenceRefs: ['metrics', 'quality', 'freshness'] }];
  const repeated = { agentId: 'data-manager-ai-v1', objective: '  ACTUALIZÁ la calidad  y frescura. ', evidenceRefs: ['quality', 'metrics'] };
  assert.equal(findCompletedRuntimeDelegation(repeated, completed)?.workItemId, 'initial-data-completed');
  assert.equal(findCompletedRuntimeDelegation({ ...repeated, evidenceRefs: ['freshness', 'metrics', 'quality'] }, completed)?.workItemId, 'initial-data-completed');
  assert.equal(completed[0].workItemId, 'initial-data-completed');
  assert.equal(completed[0].evidenceRefs.length, 3);
});

test('permite objetivo distinto, especialista diferente o evidencia nueva', () => {
  const task = { agentId: 'data-manager-ai-v1', objective: 'Verificar consistencia de stock', evidenceRefs: ['metrics'] };
  const completed = [{ ...task, workItemId: 'data-done' }];
  assert.equal(findCompletedRuntimeDelegation({ ...task, objective: 'Verificar frescura del catálogo' }, completed), null);
  assert.equal(findCompletedRuntimeDelegation({ ...task, agentId: 'systems-manager-ai-v1' }, completed), null);
  assert.equal(findCompletedRuntimeDelegation({ ...task, evidenceRefs: ['metrics', 'new-observation'] }, completed), null);
  assert.equal(findCompletedRuntimeDelegation(task, []), null);
});

test('reserva el último turno para integrar General y no promete respuesta sin receptor', () => {
  assert.deepEqual(runtimeFollowUpCapacity(4, 6), { canReturnToGeneral: true, canDelegateToSpecialist: true });
  assert.deepEqual(runtimeFollowUpCapacity(5, 6), { canReturnToGeneral: true, canDelegateToSpecialist: false });
  assert.deepEqual(runtimeFollowUpCapacity(6, 6), { canReturnToGeneral: false, canDelegateToSpecialist: false });
  assert.deepEqual(runtimeFollowUpCapacity(4, 6, 1), { canReturnToGeneral: true, canDelegateToSpecialist: false });
  // A consumed duplicate is not an outstanding delegation; the original result stays immutable.
  const output = { ...analysis.output, delegations: [{ agentId: 'data-manager-ai-v1' }] };
  assert.equal(runtimeResultNeedsReview({ ...analysis, canContinue: false, output: { ...output, delegations: [] } }), false);
  assert.equal(output.delegations.length, 1);
});
