import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeResultNeedsReview } from '../lib/company-os/runtime-outcome';

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
