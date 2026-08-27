import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendEngineeringProofEvent,
  assertEngineeringTransition,
  authorizeEngineeringEffect,
  calculateEngineeringPriority,
  engineeringHash,
  engineeringMissionHash,
  engineeringProgressFingerprint,
  evaluateEngineeringLoopBreaker,
  validateEngineeringCapability,
  verifyEngineeringProofLedger,
  type EngineeringCapabilityLease,
  type EngineeringEffectRequest,
  type EngineeringLoopBudget,
  type EngineeringMissionContract,
  type EngineeringProofEvent,
  type EngineeringRuntimeControl,
} from '../lib/company-os/autonomous-engineering-v2';

const NOW = '2026-08-27T12:00:00.000Z';

function mission(overrides: Partial<EngineeringMissionContract> = {}): EngineeringMissionContract {
  return {
    missionId: 'mission-v2-1',
    objective: 'Corregir un defecto reproducible sin tocar produccion',
    repository: 'esw/test-autonomous-engineering',
    baseCommit: 'abc123',
    allowedPaths: ['webapp/lib', 'webapp/tests'],
    acceptanceCriteria: ['test oculto pasa', 'cero efectos productivos'],
    autonomyLevel: 'A1',
    budgetUsd: 2,
    deadline: '2026-08-27T14:00:00.000Z',
    policyHash: 'policy-v2',
    expectedStateVersion: 7,
    ...overrides,
  };
}

function lease(
  currentMission: EngineeringMissionContract,
  overrides: Partial<EngineeringCapabilityLease> = {},
): EngineeringCapabilityLease {
  return {
    leaseId: 'lease-v2-1',
    missionId: currentMission.missionId,
    missionHash: engineeringMissionHash(currentMission),
    actor: 'codex-worker-1',
    resource: currentMission.repository,
    allowedVerbs: ['READ_REPOSITORY', 'WRITE_WORKTREE', 'RUN_TESTS', 'RUN_BUILD', 'COMMIT_LOCAL'],
    allowedPaths: currentMission.allowedPaths,
    autonomyLevel: 'A1',
    budgetUsd: 2,
    policyHash: currentMission.policyHash,
    fencingToken: 11,
    expectedStateVersion: currentMission.expectedStateVersion,
    issuedAt: '2026-08-27T11:00:00.000Z',
    expiresAt: '2026-08-27T13:00:00.000Z',
    ...overrides,
  };
}

const runningControl: EngineeringRuntimeControl = {
  pauseIntake: false,
  pauseExecution: false,
  globalEmergencyStop: false,
  quarantinedRepositories: [],
  disabledActors: [],
};

function capabilityInput(overrides: Partial<Parameters<typeof validateEngineeringCapability>[0]> = {}) {
  const currentMission = overrides.mission ?? mission();
  return {
    mission: currentMission,
    lease: overrides.lease ?? lease(currentMission),
    control: overrides.control ?? runningControl,
    currentFencingToken: overrides.currentFencingToken ?? 11,
    requestedVerb: overrides.requestedVerb ?? 'RUN_TESTS',
    requestedPath: overrides.requestedPath,
    now: overrides.now ?? NOW,
  };
}

test('transiciones permiten el flujo definido y rechazan saltos o salida de terminales', () => {
  assert.equal(assertEngineeringTransition('DISCOVERED', 'TRIAGED'), 'TRIAGED');
  assert.equal(assertEngineeringTransition('READY', 'LEASED'), 'LEASED');
  assert.equal(assertEngineeringTransition('RUNNING', 'VERIFYING'), 'VERIFYING');
  assert.equal(assertEngineeringTransition('READY_FOR_HUMAN', 'COMPLETED'), 'COMPLETED');
  assert.throws(
    () => assertEngineeringTransition('DISCOVERED', 'RUNNING'),
    /ENGINEERING_INVALID_TRANSITION:DISCOVERED->RUNNING/,
  );
  assert.throws(
    () => assertEngineeringTransition('COMPLETED', 'READY'),
    /ENGINEERING_INVALID_TRANSITION:COMPLETED->READY/,
  );
  assert.equal(assertEngineeringTransition('REVIEWING', 'AWAITING_APPROVAL'), 'AWAITING_APPROVAL');
  assert.throws(
    () => assertEngineeringTransition('FAILED_FINAL', 'READY'),
    /ENGINEERING_INVALID_TRANSITION:FAILED_FINAL->READY/,
  );
});

test('ledger encadena eventos y detecta alteracion de contenido o enlace', () => {
  const discovered = appendEngineeringProofEvent({
    ledger: [],
    eventType: 'MISSION_DISCOVERED',
    fromState: null,
    toState: 'DISCOVERED',
    payload: { source: 'github', issue: 17 },
    createdAt: '2026-08-27T11:00:00.000Z',
  });
  const triaged = appendEngineeringProofEvent({
    ledger: discovered,
    eventType: 'MISSION_TRIAGED',
    fromState: 'DISCOVERED',
    toState: 'TRIAGED',
    payload: { priority: 42 },
    createdAt: '2026-08-27T11:01:00.000Z',
  });

  assert.equal(verifyEngineeringProofLedger(triaged), true);
  assert.equal(triaged[1].previousHash, triaged[0].eventHash);

  const contentTamper = triaged.map((event, index) => (
    index === 0 ? { ...event, payloadHash: engineeringHash({ source: 'tampered' }) } : event
  ));
  assert.equal(verifyEngineeringProofLedger(contentTamper), false);

  const linkTamper = triaged.map((event, index) => (
    index === 1 ? { ...event, previousHash: '0'.repeat(64) } : event
  ));
  assert.equal(verifyEngineeringProofLedger(linkTamper), false);

  assert.throws(() => appendEngineeringProofEvent({
    ledger: discovered,
    eventType: 'MISSION_READY',
    fromState: 'TRIAGED',
    toState: 'READY',
    payload: {},
    createdAt: '2026-08-27T11:02:00.000Z',
  }), /ENGINEERING_LEDGER_STATE_DISCONTINUITY/);

  const discontinuousBase = {
    sequence: 2,
    eventType: 'MISSION_READY',
    fromState: 'TRIAGED' as const,
    toState: 'READY' as const,
    payloadHash: engineeringHash({}),
    previousHash: discovered[0].eventHash,
    createdAt: '2026-08-27T11:02:00.000Z',
  };
  const discontinuous = { ...discontinuousBase, eventHash: engineeringHash(discontinuousBase) };
  assert.equal(verifyEngineeringProofLedger([...discovered, discontinuous]), false);
});

test('capability A1 autoriza trabajo local y rechaza efectos A2', () => {
  assert.deepEqual(validateEngineeringCapability(capabilityInput({
    requestedVerb: 'WRITE_WORKTREE',
    requestedPath: 'webapp/lib/company-os/fix.ts',
  })), { ok: true, code: 'AUTHORIZED' });

  assert.deepEqual(validateEngineeringCapability(capabilityInput({
    requestedVerb: 'CREATE_DRAFT_PR',
  })), { ok: false, code: 'VERB_NOT_ALLOWED' });
});

test('una mision A1 no puede elevarse mediante un lease A2', () => {
  const currentMission = mission({ autonomyLevel: 'A1' });
  const elevatedLease = lease(currentMission, {
    autonomyLevel: 'A2',
    allowedVerbs: ['CREATE_DRAFT_PR'],
  });
  const result = validateEngineeringCapability(capabilityInput({
    mission: currentMission,
    lease: elevatedLease,
    requestedVerb: 'CREATE_DRAFT_PR',
  }));

  assert.equal(result.ok, false);
  assert.equal(result.code, 'AUTONOMY_LEVEL_DENIED');
});

test('policy mismatch, fencing obsoleto y lease vencido se rechazan', () => {
  const currentMission = mission();
  assert.deepEqual(validateEngineeringCapability(capabilityInput({
    mission: currentMission,
    lease: lease(currentMission, { policyHash: 'otra-policy' }),
  })), { ok: false, code: 'POLICY_HASH_MISMATCH' });

  assert.deepEqual(validateEngineeringCapability(capabilityInput({
    mission: currentMission,
    lease: lease(currentMission, { fencingToken: 10 }),
  })), { ok: false, code: 'STALE_FENCING_TOKEN' });

  assert.deepEqual(validateEngineeringCapability(capabilityInput({
    mission: currentMission,
    lease: lease(currentMission, { expiresAt: NOW }),
  })), { ok: false, code: 'LEASE_EXPIRED' });
});

test('paths fuera del allowlist y traversal son rechazados', () => {
  assert.deepEqual(validateEngineeringCapability(capabilityInput({
    requestedVerb: 'WRITE_WORKTREE',
    requestedPath: 'server/production.ts',
  })), { ok: false, code: 'PATH_NOT_ALLOWED' });

  assert.deepEqual(validateEngineeringCapability(capabilityInput({
    requestedVerb: 'WRITE_WORKTREE',
    requestedPath: 'webapp/lib/../../../.env',
  })), { ok: false, code: 'PATH_NOT_ALLOWED' });

  const currentMission = mission({ allowedPaths: ['webapp/lib'] });
  assert.deepEqual(validateEngineeringCapability(capabilityInput({
    mission: currentMission,
    lease: lease(currentMission, { allowedPaths: ['webapp'] }),
    requestedVerb: 'WRITE_WORKTREE',
    requestedPath: 'webapp/tests/elevated.test.ts',
  })), { ok: false, code: 'PATH_NOT_ALLOWED' });
});

test('capability rechaza tiempos invalidos, lease futuro y deadline vencido', () => {
  const currentMission = mission();
  assert.equal(validateEngineeringCapability(capabilityInput({
    mission: currentMission,
    lease: lease(currentMission, { expiresAt: 'invalid' }),
  })).code, 'CAPABILITY_TIME_INVALID');
  assert.equal(validateEngineeringCapability(capabilityInput({
    mission: currentMission,
    lease: lease(currentMission, { issuedAt: '2026-08-27T12:00:01.000Z' }),
  })).code, 'LEASE_NOT_ACTIVE');
  const expiredMission = mission({ deadline: NOW });
  assert.equal(validateEngineeringCapability(capabilityInput({
    mission: expiredMission,
    lease: lease(expiredMission),
  })).code, 'MISSION_DEADLINE_EXPIRED');
});

test('kill switch y pausa bloquean capability y efectos', () => {
  const currentMission = mission({ autonomyLevel: 'A2' });
  const currentLease = lease(currentMission, {
    autonomyLevel: 'A2',
    allowedVerbs: ['CREATE_DRAFT_PR'],
  });
  const stoppedControl = { ...runningControl, globalEmergencyStop: true };

  assert.deepEqual(validateEngineeringCapability(capabilityInput({
    mission: currentMission,
    lease: currentLease,
    control: stoppedControl,
    requestedVerb: 'CREATE_DRAFT_PR',
  })), { ok: false, code: 'GLOBAL_EMERGENCY_STOP' });

  const effect: EngineeringEffectRequest = {
    effectId: 'effect-1',
    idempotencyKey: 'mission-v2-1:draft-pr',
    missionId: currentMission.missionId,
    missionHash: engineeringMissionHash(currentMission),
    targetRepository: currentMission.repository,
    verb: 'CREATE_DRAFT_PR',
    policyHash: currentMission.policyHash,
    fencingToken: 11,
  };
  assert.deepEqual(authorizeEngineeringEffect({
    effect,
    mission: currentMission,
    lease: currentLease,
    control: stoppedControl,
    currentFencingToken: 11,
    knownIdempotencyKeys: [],
    allowlistedRepositories: [currentMission.repository],
    now: NOW,
  }), { ok: false, code: 'GLOBAL_EMERGENCY_STOP', dispatch: false });
});

test('loop breaker corta repeticion semantica y cada limite durable', () => {
  const fingerprint = engineeringProgressFingerprint({
    state: 'RUNNING',
    evidenceRefs: ['proof-b', 'proof-a'],
    diffHash: null,
    errorClass: 'TEST_FAILURE',
    toolRequest: 'npm test',
  });
  assert.equal(fingerprint, engineeringProgressFingerprint({
    state: 'RUNNING',
    evidenceRefs: ['proof-a', 'proof-b'],
    diffHash: null,
    errorClass: 'TEST_FAILURE',
    toolRequest: 'npm test',
  }));

  const activeBudget: EngineeringLoopBudget = {
    attempts: 1,
    maxAttempts: 3,
    replans: 0,
    maxReplans: 2,
    spentUsd: 0.5,
    maxUsd: 2,
    deadline: '2026-08-27T13:00:00.000Z',
  };
  assert.deepEqual(evaluateEngineeringLoopBreaker({
    fingerprints: [fingerprint, fingerprint, fingerprint],
    budget: activeBudget,
    now: NOW,
  }), { stop: true, code: 'NO_PROGRESS_REPEATED_3' });
  assert.equal(evaluateEngineeringLoopBreaker({
    fingerprints: [],
    budget: { ...activeBudget, attempts: 3 },
    now: NOW,
  }).code, 'ATTEMPT_LIMIT');
  assert.equal(evaluateEngineeringLoopBreaker({
    fingerprints: [],
    budget: { ...activeBudget, replans: 2 },
    now: NOW,
  }).code, 'REPLAN_LIMIT');
  assert.equal(evaluateEngineeringLoopBreaker({
    fingerprints: [],
    budget: { ...activeBudget, spentUsd: 2 },
    now: NOW,
  }).code, 'BUDGET_EXHAUSTED');
  assert.equal(evaluateEngineeringLoopBreaker({
    fingerprints: [],
    budget: { ...activeBudget, deadline: NOW },
    now: NOW,
  }).code, 'DEADLINE_EXPIRED');
  assert.deepEqual(evaluateEngineeringLoopBreaker({
    fingerprints: [fingerprint],
    budget: activeBudget,
    now: NOW,
  }), { stop: false, code: 'CONTINUE' });
});

test('prioridad usa valor esperado, limita probabilidad y excluye valor no positivo', () => {
  assert.deepEqual(calculateEngineeringPriority({
    probabilityOfSuccess: 0.75,
    verifiedBenefitUsd: 100,
    reviewCostUsd: 10,
    reworkCostUsd: 5,
    expectedLossUsd: 20,
    executionCostUsd: 2.5,
  }), { expectedValueUsd: 37.5, eligible: true });

  assert.deepEqual(calculateEngineeringPriority({
    probabilityOfSuccess: 4,
    verifiedBenefitUsd: 10,
    reviewCostUsd: 10,
    reworkCostUsd: -5,
    expectedLossUsd: 0,
    executionCostUsd: 0,
  }), { expectedValueUsd: 0, eligible: false });
});

test('A2 permite solo efecto reversible sobre repositorio allowlisted', () => {
  const currentMission = mission({ autonomyLevel: 'A2' });
  const currentLease = lease(currentMission, {
    autonomyLevel: 'A2',
    allowedVerbs: ['PUSH_BRANCH', 'CREATE_DRAFT_PR'],
  });
  const effect: EngineeringEffectRequest = {
    effectId: 'effect-draft-pr',
    idempotencyKey: 'mission-v2-1:draft-pr',
    missionId: currentMission.missionId,
    missionHash: engineeringMissionHash(currentMission),
    targetRepository: currentMission.repository,
    verb: 'CREATE_DRAFT_PR',
    policyHash: currentMission.policyHash,
    fencingToken: 11,
  };

  assert.deepEqual(authorizeEngineeringEffect({
    effect,
    mission: currentMission,
    lease: currentLease,
    control: runningControl,
    currentFencingToken: 11,
    knownIdempotencyKeys: [],
    allowlistedRepositories: [currentMission.repository],
    now: NOW,
  }), { ok: true, code: 'AUTHORIZED', dispatch: true });

  assert.deepEqual(authorizeEngineeringEffect({
    effect: { ...effect, targetRepository: 'esw/production' },
    mission: currentMission,
    lease: currentLease,
    control: runningControl,
    currentFencingToken: 11,
    knownIdempotencyKeys: [],
    allowlistedRepositories: [currentMission.repository],
    now: NOW,
  }), { ok: false, code: 'EFFECT_RESOURCE_MISMATCH', dispatch: false });

  assert.deepEqual(authorizeEngineeringEffect({
    effect,
    mission: currentMission,
    lease: currentLease,
    control: runningControl,
    currentFencingToken: 11,
    knownIdempotencyKeys: [],
    allowlistedRepositories: [],
    now: NOW,
  }), { ok: false, code: 'TARGET_NOT_ALLOWLISTED', dispatch: false });
});

test('idempotencia evita redispatch sin omitir controles de produccion', () => {
  const currentMission = mission({ autonomyLevel: 'A2' });
  const currentLease = lease(currentMission, {
    autonomyLevel: 'A2',
    allowedVerbs: ['CREATE_DRAFT_PR'],
  });
  const effect: EngineeringEffectRequest = {
    effectId: 'effect-replay',
    idempotencyKey: 'mission-v2-1:draft-pr',
    missionId: currentMission.missionId,
    missionHash: engineeringMissionHash(currentMission),
    targetRepository: currentMission.repository,
    verb: 'CREATE_DRAFT_PR',
    policyHash: currentMission.policyHash,
    fencingToken: 11,
  };

  assert.deepEqual(authorizeEngineeringEffect({
    effect,
    mission: currentMission,
    lease: currentLease,
    control: runningControl,
    currentFencingToken: 11,
    knownIdempotencyKeys: [effect.idempotencyKey],
    allowlistedRepositories: [currentMission.repository],
    now: NOW,
  }), { ok: true, code: 'IDEMPOTENT_REPLAY', dispatch: false });

  const replayedMerge = authorizeEngineeringEffect({
    effect: { ...effect, verb: 'MERGE' },
    mission: currentMission,
    lease: currentLease,
    control: runningControl,
    currentFencingToken: 11,
    knownIdempotencyKeys: [effect.idempotencyKey],
    allowlistedRepositories: [currentMission.repository],
    now: NOW,
  });
  assert.deepEqual(replayedMerge, { ok: false, code: 'PRODUCTION_EFFECT_DENIED', dispatch: false });

  for (const [change, code] of [
    [{ missionId: 'other-mission' }, 'EFFECT_MISSION_ID_MISMATCH'],
    [{ missionHash: 'tampered' }, 'EFFECT_MISSION_HASH_MISMATCH'],
    [{ targetRepository: 'esw/other-allowlisted' }, 'EFFECT_RESOURCE_MISMATCH'],
    [{ policyHash: 'other-policy' }, 'EFFECT_POLICY_HASH_MISMATCH'],
    [{ fencingToken: 10 }, 'EFFECT_STALE_FENCING_TOKEN'],
  ] as const) {
    assert.equal(authorizeEngineeringEffect({
      effect: { ...effect, ...change },
      mission: currentMission,
      lease: currentLease,
      control: runningControl,
      currentFencingToken: 11,
      knownIdempotencyKeys: [effect.idempotencyKey],
      allowlistedRepositories: [currentMission.repository, 'esw/other-allowlisted'],
      now: NOW,
    }).code, code);
  }
});

test('merge y deploy siempre son rechazados', () => {
  const currentMission = mission({ autonomyLevel: 'A2' });
  const currentLease = lease(currentMission, {
    autonomyLevel: 'A2',
    allowedVerbs: ['MERGE', 'DEPLOY'],
  });
  const baseEffect = {
    effectId: 'effect-production',
    idempotencyKey: 'mission-v2-1:production',
    missionId: currentMission.missionId,
    missionHash: engineeringMissionHash(currentMission),
    targetRepository: currentMission.repository,
    policyHash: currentMission.policyHash,
    fencingToken: 11,
  } as const;

  for (const verb of ['MERGE', 'DEPLOY'] as const) {
    assert.deepEqual(authorizeEngineeringEffect({
      effect: { ...baseEffect, verb, effectId: `effect-${verb.toLowerCase()}` },
      mission: currentMission,
      lease: currentLease,
      control: runningControl,
      currentFencingToken: 11,
      knownIdempotencyKeys: [],
      allowlistedRepositories: [currentMission.repository],
      now: NOW,
    }), { ok: false, code: 'PRODUCTION_EFFECT_DENIED', dispatch: false });
  }
});

test('hash de mision es canonico y cambia al alterar su contrato', () => {
  const first = mission();
  const sameDifferentOrder = {
    policyHash: first.policyHash,
    missionId: first.missionId,
    objective: first.objective,
    repository: first.repository,
    baseCommit: first.baseCommit,
    allowedPaths: first.allowedPaths,
    acceptanceCriteria: first.acceptanceCriteria,
    autonomyLevel: first.autonomyLevel,
    budgetUsd: first.budgetUsd,
    deadline: first.deadline,
    expectedStateVersion: first.expectedStateVersion,
  } satisfies EngineeringMissionContract;
  assert.equal(engineeringMissionHash(first), engineeringMissionHash(sameDifferentOrder));
  assert.notEqual(engineeringMissionHash(first), engineeringMissionHash(mission({ budgetUsd: 3 })));
});

test('tipos de prueba mantienen el ledger inmutable por contrato de datos', () => {
  const event: EngineeringProofEvent = {
    sequence: 1,
    eventType: 'MISSION_DISCOVERED',
    fromState: null,
    toState: 'DISCOVERED',
    payloadHash: engineeringHash({}),
    previousHash: null,
    createdAt: NOW,
    eventHash: engineeringHash({ marker: 'test-only' }),
  };
  assert.equal(verifyEngineeringProofLedger([event]), false);
});
