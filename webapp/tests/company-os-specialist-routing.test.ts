import assert from 'node:assert/strict';
import test from 'node:test';
import {
  routeSpecialist,
  SPECIALIST_REGISTRY,
  specialistCapabilityForAgent,
  validateSpecialistDelegation,
} from '../lib/company-os/specialist-routing';

test('el registro de especialistas es cerrado y el routing por capability es determinista', () => {
  assert.deepEqual(Object.keys(SPECIALIST_REGISTRY).sort(), [
    'DATA_QUALITY_FRESHNESS',
    'SYSTEMS_OBSERVABILITY',
  ]);
  assert.equal(routeSpecialist('SYSTEMS_OBSERVABILITY').agentId, 'systems-manager-ai-v1');
  assert.equal(routeSpecialist('DATA_QUALITY_FRESHNESS').agentId, 'data-manager-ai-v1');
  assert.equal(specialistCapabilityForAgent('systems-manager-ai-v1'), 'SYSTEMS_OBSERVABILITY');
  assert.throws(() => routeSpecialist('PROCUREMENT'), /SPECIALIST_CAPABILITY_NOT_INSTALLED/);
});

test('la delegación exige capability consistente, profundidad uno y herramientas read-only', () => {
  const delegation = validateSpecialistDelegation({
    agentId: 'systems-manager-ai-v1',
    capability: 'SYSTEMS_OBSERVABILITY',
    objective: 'Revisar inventario técnico observado.',
    evidenceRefs: ['assets', 'risks'],
  });
  assert.equal(delegation.depth, 1);
  assert.equal(SPECIALIST_REGISTRY.SYSTEMS_OBSERVABILITY.allowedToolEffects, 'READ_ONLY_DETERMINISTIC');
  assert.throws(() => validateSpecialistDelegation({
    ...delegation,
    capability: 'DATA_QUALITY_FRESHNESS',
  }), /SPECIALIST_ROUTE_MISMATCH/);
  assert.throws(() => validateSpecialistDelegation({
    ...delegation,
    depth: 2,
  }), /SPECIALIST_DEPTH_EXCEEDED/);
});

test('NEEDS_USER y BLOCKED_EXTERNAL se rechazan antes de encolar trabajo especialista', () => {
  for (const taskStatus of ['NEEDS_USER', 'BLOCKED_EXTERNAL']) {
    assert.throws(() => validateSpecialistDelegation({
      agentId: 'data-manager-ai-v1',
      capability: 'DATA_QUALITY_FRESHNESS',
      objective: 'Evaluar frescura de fuentes.',
      evidenceRefs: ['freshness'],
      taskStatus,
    }), (error: unknown) => {
      assert.equal((error as { code?: string }).code, `SPECIALIST_TASK_REJECTED_${taskStatus}`);
      assert.match((error as Error).message, new RegExp(`SPECIALIST_TASK_REJECTED:${taskStatus}`));
      return true;
    });
  }
});
