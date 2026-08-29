import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { EngineeringGoalReconciler, validateGoalSpec } from '../src/goal-reconciler.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const commandArgs = (args) => args[0] === '--git-dir' ? args.slice(2) : args;
const baseCommit = 'a'.repeat(40);
const source = '# Bounded authority\n';
const blobEntry = (path) => `100644 blob ${'d'.repeat(40)}\t${path}\0`;
const config = {
  repositorySlug: 'owner/repo',
  repositoryPath: '/tmp/repo',
  baseBranch: 'main',
  maxAutonomy: 'A2',
  gitBin: '/usr/bin/git',
  goalReconcileMinMs: 30_000,
  goalReconcileMaxMs: 900_000,
};
const goal = {
  goalId: 'engineering-goal:test:v1',
  observationCursor: null,
  goalKey: 'test-goal',
  version: 1,
  sourceKind: 'REPOSITORY_DOCUMENT',
  sourceRef: 'company-os/AUTONOMOUS_ENGINEERING_V2.md',
  sourceHash: sha(source),
  objective: 'Create bounded proof',
  repository: 'owner/repo',
  baseBranch: 'main',
  desiredState: {
    type: 'FILE_CONTAINS_ALL',
    path: 'company-os/PROOF.md',
    needles: ['goalKey: test-goal', 'decisionAuthority: deterministic-orchestrator'],
  },
  allowedPaths: ['company-os/PROOF.md'],
  acceptanceCriteria: ['Proof exists'],
  autonomyLevel: 'A2',
  budgetUsd: 1,
  missionTtlMinutes: 60,
  policyHash: 'b'.repeat(64),
  priority: 100,
};

test('GoalSpec fails closed outside bounded authority', () => {
  assert.equal(validateGoalSpec(goal, config).desiredState.path, 'company-os/PROOF.md');
  assert.throws(() => validateGoalSpec({ ...goal, sourceKind: 'COMPANY_OS_DOCUMENT' }, config), /ENGINEERING_GOAL_SOURCE_DENIED/);
  assert.throws(() => validateGoalSpec({ ...goal, allowedPaths: ['docs'] }, config), /ENGINEERING_GOAL_AUTHORITY_DENIED/);
  assert.throws(() => validateGoalSpec({ ...goal, desiredState: { ...goal.desiredState, path: '.github/workflows/x.yml' } }, config), /ENGINEERING_GOAL_AUTHORITY_DENIED/);
  assert.throws(() => validateGoalSpec({ ...goal, repository: 'owner/other' }, config), /ENGINEERING_GOAL_AUTHORITY_DENIED/);
});

test('goal observation rejects symlink tree entries for source and desired state', async () => {
  const reconciler = new EngineeringGoalReconciler({
    config,
    api: {},
    logger: {},
    processRunner: async (_command, args) => {
      const gitArgs = commandArgs(args);
      if (gitArgs[0] === 'ls-tree') {
        return { stdout: `120000 blob ${'d'.repeat(40)}\t${gitArgs.at(-1)}\0`, stderr: '', exitCode: 0 };
      }
      throw new Error('cat-file must not run for a symlink');
    },
  });
  reconciler.authorityGitDir = '/tmp/fake-goal-authority.git';
  await assert.rejects(reconciler.observe(goal, baseCommit), /ENGINEERING_GOAL_BLOB_INVALID/);
});

test('reconciler materializes an unmet desired state and then quiesces when satisfied', async () => {
  let target = null;
  const observations = [];
  const processRunner = async (_command, args) => {
    const gitArgs = commandArgs(args);
    if (gitArgs[0] === 'init') return { stdout: '', stderr: '', exitCode: 0 };
    if (gitArgs[0] === 'fetch') return { stdout: '', stderr: '', exitCode: 0 };
    if (gitArgs[0] === 'rev-parse') return { stdout: `${baseCommit}\n`, stderr: '', exitCode: 0 };
    if (gitArgs[0] === 'ls-tree' && gitArgs.at(-1) === goal.sourceRef) return { stdout: blobEntry(goal.sourceRef), stderr: '', exitCode: 0 };
    if (gitArgs[0] === 'cat-file' && gitArgs.at(-1).endsWith(`:${goal.sourceRef}`)) return { stdout: source, stderr: '', exitCode: 0 };
    if (gitArgs[0] === 'ls-tree' && gitArgs.at(-1) === goal.desiredState.path) {
      return { stdout: target === null ? '' : blobEntry(goal.desiredState.path), stderr: '', exitCode: 0 };
    }
    if (gitArgs[0] === 'cat-file' && gitArgs.at(-1).endsWith(`:${goal.desiredState.path}`)) return { stdout: target, stderr: '', exitCode: 0 };
    throw new Error(`unexpected git args: ${gitArgs.join(' ')}`);
  };
  const api = {
    goals: async () => ({ goals: [goal] }),
    observeGoal: async (observation) => {
      observations.push(observation);
      return { decision: observation.observedSatisfied ? 'QUIESCENT' : 'MATERIALIZED' };
    },
  };
  const reconciler = new EngineeringGoalReconciler({ config, api, processRunner, logger: { info() {} }, now: () => 1_800_000_000_000 });
  assert.deepEqual(await reconciler.reconcileIfDue(), { observed: 1, materialized: 1, quiescent: 0, pending: 0, stale: 0, invalid: 0, awaitingHuman: 0, blockedFinal: 0, expired: 0 });
  assert.equal(observations[0].observedSatisfied, false);
  assert.equal(observations[0].expectedObservationCursor, null);
  assert.equal(observations[0].observedState.fileExists, false);
  assert.match(observations[0].evidenceHash, /^[a-f0-9]{64}$/);

  target = 'goalKey: test-goal\n';
  reconciler.wake();
  assert.deepEqual(await reconciler.reconcileIfDue(), { observed: 1, materialized: 1, quiescent: 0, pending: 0, stale: 0, invalid: 0, awaitingHuman: 0, blockedFinal: 0, expired: 0 });
  assert.equal(observations[1].observedSatisfied, false);
  assert.equal(observations[1].observedState.matchedNeedleHashes.length, 1);

  target = 'goalKey: test-goal\ndecisionAuthority: deterministic-orchestrator\n';
  reconciler.wake();
  assert.deepEqual(await reconciler.reconcileIfDue(), { observed: 1, materialized: 0, quiescent: 1, pending: 0, stale: 0, invalid: 0, awaitingHuman: 0, blockedFinal: 0, expired: 0 });
  assert.equal(observations[2].observedSatisfied, true);
  assert.equal(observations[2].observedState.type, 'FILE_CONTAINS_ALL');
  assert.equal(reconciler.snapshot().lastGoalDecision, 'QUIESCENT');
  assert.equal(reconciler.snapshot().goalReconcilerHealthy, true);
});

test('stale source is durably reported and does not poison the remaining goals', async () => {
  const staleGoal = { ...goal, goalId: 'engineering-goal:stale:v1', sourceHash: 'c'.repeat(64) };
  const observations = [];
  const processRunner = async (_command, args) => {
    const gitArgs = commandArgs(args);
    if (gitArgs[0] === 'init') return { stdout: '', stderr: '', exitCode: 0 };
    if (gitArgs[0] === 'fetch') return { stdout: '', stderr: '', exitCode: 0 };
    if (gitArgs[0] === 'rev-parse') return { stdout: `${baseCommit}\n`, stderr: '', exitCode: 0 };
    if (gitArgs[0] === 'ls-tree' && gitArgs.at(-1) === goal.sourceRef) return { stdout: blobEntry(goal.sourceRef), stderr: '', exitCode: 0 };
    if (gitArgs[0] === 'cat-file' && gitArgs.at(-1).endsWith(`:${goal.sourceRef}`)) return { stdout: source, stderr: '', exitCode: 0 };
    if (gitArgs[0] === 'ls-tree') return { stdout: '', stderr: '', exitCode: 0 };
    throw new Error(`unexpected git args: ${gitArgs.join(' ')}`);
  };
  const api = {
    goals: async () => ({ goals: [staleGoal, goal], invalidGoals: [], nextCursor: null }),
    observeGoal: async (observation) => {
      observations.push(observation);
      return { decision: observation.observedState.type === 'GOAL_ISSUE' ? 'STALE' : 'MATERIALIZED' };
    },
  };
  const reconciler = new EngineeringGoalReconciler({ config, api, processRunner, logger: { info() {}, error() {} }, now: () => 1_800_000_000_000 });
  assert.deepEqual(await reconciler.reconcileIfDue(), { observed: 2, materialized: 1, quiescent: 0, pending: 0, stale: 1, invalid: 0, awaitingHuman: 0, blockedFinal: 0, expired: 0 });
  assert.equal(observations[0].observedState.code, 'SOURCE_HASH_MISMATCH');
  assert.equal(observations[1].observedState.type, 'FILE_CONTAINS_ALL');
  assert.equal(reconciler.snapshot().goalReconcilerHealthy, false);
  assert.deepEqual(reconciler.snapshot().goalReconcilerErrorCodes, ['ENGINEERING_GOAL_STALE']);
});

test('authority observation uses an isolated bare cache and the exact HTTPS repository', async () => {
  const commands = [];
  const reconciler = new EngineeringGoalReconciler({
    config,
    api: {},
    logger: { error() {} },
    processRunner: async (_command, args) => {
      const gitArgs = commandArgs(args);
      commands.push(gitArgs);
      if (gitArgs[0] === 'init' || gitArgs[0] === 'fetch') return { stdout: '', stderr: '', exitCode: 0 };
      if (gitArgs[0] === 'rev-parse') return { stdout: `${baseCommit}\n`, stderr: '', exitCode: 0 };
      throw new Error(`unexpected git args: ${gitArgs.join(' ')}`);
    },
  });
  assert.equal(await reconciler.fetchAuthoritativeBase(), baseCommit);
  const fetch = commands.find((args) => args[0] === 'fetch');
  assert.equal(fetch.includes('https://github.com/owner/repo.git'), true);
  assert.equal(commands.some((args) => args[0] === 'remote'), false);
  await reconciler.cleanupAuthorityCache();
});

test('terminal goal decisions remain visible and degrade blocked or expired coverage', async () => {
  const decisions = ['AWAITING_HUMAN', 'BLOCKED_FINAL', 'EXPIRED'];
  let decisionIndex = 0;
  const processRunner = async (_command, args) => {
    const gitArgs = commandArgs(args);
    if (gitArgs[0] === 'init') return { stdout: '', stderr: '', exitCode: 0 };
    if (gitArgs[0] === 'fetch') return { stdout: '', stderr: '', exitCode: 0 };
    if (gitArgs[0] === 'rev-parse') return { stdout: `${baseCommit}\n`, stderr: '', exitCode: 0 };
    if (gitArgs[0] === 'ls-tree' && gitArgs.at(-1) === goal.sourceRef) return { stdout: blobEntry(goal.sourceRef), stderr: '', exitCode: 0 };
    if (gitArgs[0] === 'cat-file' && gitArgs.at(-1).endsWith(`:${goal.sourceRef}`)) return { stdout: source, stderr: '', exitCode: 0 };
    if (gitArgs[0] === 'ls-tree') return { stdout: '', stderr: '', exitCode: 0 };
    throw new Error(`unexpected git args: ${gitArgs.join(' ')}`);
  };
  const goals = decisions.map((_, index) => ({ ...goal, goalId: `engineering-goal:decision-${index}:v1` }));
  const reconciler = new EngineeringGoalReconciler({
    config,
    api: {
      goals: async () => ({ goals, invalidGoals: [], nextCursor: null }),
      observeGoal: async () => ({ decision: decisions[decisionIndex++] }),
    },
    processRunner,
    logger: { info() {}, error() {} },
    now: () => 1_800_000_000_000,
  });
  const result = await reconciler.reconcileIfDue();
  assert.equal(result.awaitingHuman, 1);
  assert.equal(result.blockedFinal, 1);
  assert.equal(result.expired, 1);
  assert.equal(reconciler.snapshot().lastGoalDecision, 'DEGRADED');
  assert.equal(reconciler.snapshot().goalReconcilerHealthy, false);
});
