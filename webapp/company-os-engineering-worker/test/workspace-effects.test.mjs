import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { GitWorkspace } from '../src/git-workspace.mjs';
import { EngineeringReconciler, GitHubEffects } from '../src/github-effect.mjs';
import { missionHash } from '../src/policy.mjs';
import { runProcess } from '../src/process.mjs';

async function sourceFixture() {
  const root = await mkdtemp(join(tmpdir(), 'engineering-v2-test-'));
  const source = join(root, 'source');
  await mkdir(join(source, 'docs'), { recursive: true });
  await runProcess('/usr/bin/git', ['init', '-b', 'main', source], { cwd: root });
  await writeFile(join(source, 'docs', 'proof.md'), 'before\n');
  await runProcess('/usr/bin/git', ['-C', source, 'add', '.']);
  await runProcess('/usr/bin/git', ['-C', source, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'base']);
  await runProcess('/usr/bin/git', ['-C', source, 'remote', 'add', 'origin', 'https://github.com/owner/repo.git']);
  const baseCommit = (await runProcess('/usr/bin/git', ['-C', source, 'rev-parse', 'HEAD'])).stdout.trim();
  return { root, source, baseCommit };
}

function claim(baseCommit, autonomyLevel = 'A1') {
  const mission = { missionId: 'mission-1', objective: 'Update proof', repository: 'owner/repo', baseCommit, allowedPaths: ['docs'], acceptanceCriteria: ['updated'], autonomyLevel, budgetUsd: 1, deadline: '2030-01-01T00:00:00Z', policyHash: 'policy', expectedStateVersion: 1 };
  const lease = { leaseId: 'lease-1', missionId: 'mission-1', missionHash: missionHash(mission), actor: 'worker', resource: 'owner/repo', allowedVerbs: autonomyLevel === 'A2' ? ['READ_REPOSITORY','WRITE_WORKTREE','RUN_TESTS','RUN_BUILD','COMMIT_LOCAL','PUSH_BRANCH','CREATE_DRAFT_PR'] : ['READ_REPOSITORY','WRITE_WORKTREE','RUN_TESTS','RUN_BUILD','COMMIT_LOCAL'], allowedPaths: ['docs'], autonomyLevel, budgetUsd: 1, policyHash: 'policy', fencingToken: 1, expectedStateVersion: 1, issuedAt: '2027-01-01T00:00:00Z', expiresAt: '2030-01-01T00:00:00Z' };
  return { mode: 'EXECUTE', mission, lease, effects: [] };
}

test('A1 creates disposable clone, removes remote, commits only allowed paths and cleans', async (t) => {
  const fixture = await sourceFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const config = { jobsDir: join(fixture.root, 'jobs'), repositoryPath: fixture.source, repositorySlug: 'owner/repo', gitBin: '/usr/bin/git', fetchBaseCommit: false };
  const workspace = new GitWorkspace({ config, claim: claim(fixture.baseCommit), policy: { missionPaths: ['docs'], leasePaths: ['docs'] } });
  await workspace.prepare();
  assert.rejects(workspace.git(['remote', 'get-url', 'origin']));
  await writeFile(join(workspace.repo, 'docs', 'proof.md'), 'after\n');
  const receipt = await workspace.verifyAndCommit();
  assert.deepEqual(receipt.changedPaths, ['docs/proof.md']);
  assert.match(receipt.commitSha, /^[a-f0-9]{40}$/);
  assert.match(receipt.branch, /^codex\/engineering-v2-/);
  await workspace.cleanup();
  await assert.rejects(readFile(join(workspace.repo, 'docs', 'proof.md')));
});

test('workspace rejects symlink and prohibited changed path', async (t) => {
  const fixture = await sourceFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const config = { jobsDir: join(fixture.root, 'jobs'), repositoryPath: fixture.source, repositorySlug: 'owner/repo', gitBin: '/usr/bin/git', fetchBaseCommit: false };
  const workspace = new GitWorkspace({ config, claim: claim(fixture.baseCommit), policy: { missionPaths: ['docs'], leasePaths: ['docs'] } });
  await workspace.prepare();
  await symlink('/etc/hosts', join(workspace.repo, 'docs', 'linked'));
  await assert.rejects(workspace.verifyAndCommit(), /SYMLINK_CHANGED/);
  await rm(join(workspace.repo, 'docs', 'linked'));
  await mkdir(join(workspace.repo, '.github'));
  await writeFile(join(workspace.repo, '.github', 'workflow.yml'), 'x');
  await assert.rejects(workspace.verifyAndCommit(), /PROHIBITED_PATH_CHANGED/);
});

test('workspace rejects an allowed change that does not satisfy the structured desired state', async (t) => {
  const fixture = await sourceFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const config = { jobsDir: join(fixture.root, 'jobs'), repositoryPath: fixture.source, repositorySlug: 'owner/repo', gitBin: '/usr/bin/git', fetchBaseCommit: false };
  const claimed = claim(fixture.baseCommit, 'A2');
  claimed.mission.desiredState = {
    type: 'FILE_CONTAINS_ALL',
    path: 'docs/proof.md',
    needles: ['goalKey: exact-proof', 'decisionAuthority: deterministic-orchestrator'],
  };
  claimed.lease.missionHash = missionHash(claimed.mission);
  const policy = { missionPaths: ['docs'], leasePaths: ['docs'], desiredState: claimed.mission.desiredState };
  const workspace = new GitWorkspace({ config, claim: claimed, policy });
  await workspace.prepare();
  await writeFile(join(workspace.repo, 'docs', 'proof.md'), 'changed but wrong\n');
  await assert.rejects(workspace.verifyAndCommit(), /DESIRED_STATE_NOT_SATISFIED/);
  assert.equal((await workspace.git(['status', '--porcelain=v1'])).stdout.includes('proof.md'), true);
  await writeFile(join(workspace.repo, 'docs', 'proof.md'), 'goalKey: exact-proof\n');
  await assert.rejects(workspace.verifyAndCommit(), /DESIRED_STATE_NOT_SATISFIED/);
  await writeFile(join(workspace.repo, 'docs', 'proof.md'), 'goalKey: exact-proof\ndecisionAuthority: deterministic-orchestrator\n');
  const receipt = await workspace.verifyAndCommit();
  assert.deepEqual(receipt.desiredStateReadback, {
    type: 'FILE_CONTAINS_ALL', path: 'docs/proof.md', matched: true,
    contentHash: '7a64aeee4862a235d44506fd1421b12fd42a26019e5f68f2239de5621fc36a43',
    matchedNeedleHashes: [
      '15e1c2e74b8d43317289343d7503b8beff06634816a4e9adbd25b2b9090d461c',
      '2f321d7b341a0d486a7c15cc343f74d7e3e9bd9df421f216967a396575f81499',
    ],
  });
});

test('post-run scan rejects exact Codex auth material and generic secrets', async (t) => {
  const fixture = await sourceFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const authDir = join(fixture.root, 'codex-auth');
  await mkdir(authDir);
  await writeFile(join(authDir, 'auth.json'), JSON.stringify({ token: 'exact-auth-material-1234567890' }));
  const config = { jobsDir: join(fixture.root, 'jobs'), repositoryPath: fixture.source, repositorySlug: 'owner/repo', gitBin: '/usr/bin/git', fetchBaseCommit: false };
  const workspace = new GitWorkspace({ config, claim: claim(fixture.baseCommit), policy: { missionPaths: ['docs'], leasePaths: ['docs'] } });
  await workspace.prepare();
  await writeFile(join(workspace.repo, 'docs', 'proof.md'), 'exact-auth-material-1234567890\n');
  await assert.rejects(workspace.assertNoSecretMaterial('', authDir), /CODEX_AUTH_MATERIAL_DETECTED/);
  await writeFile(join(workspace.repo, 'docs', 'proof.md'), 'api_key=abcdefghijklmnop123456\n');
  await assert.rejects(workspace.assertNoSecretMaterial('', authDir), /SECRET_PATTERN_DETECTED/);
  await writeFile(join(workspace.repo, 'docs', 'proof.md'), `api_key=secret-at-prefix-1234567890\n${'x'.repeat(96 * 1024)}`);
  await assert.rejects(workspace.assertNoSecretMaterial('', authDir), /SECRET_PATTERN_DETECTED/);
});

test('workspace fails closed on oversized changed files instead of scanning a truncated diff', async (t) => {
  const fixture = await sourceFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const config = { jobsDir: join(fixture.root, 'jobs'), repositoryPath: fixture.source, repositorySlug: 'owner/repo', gitBin: '/usr/bin/git', fetchBaseCommit: false };
  const workspace = new GitWorkspace({ config, claim: claim(fixture.baseCommit), policy: { missionPaths: ['docs'], leasePaths: ['docs'] } });
  await workspace.prepare();
  await writeFile(join(workspace.repo, 'docs', 'proof.md'), `safe\n${'x'.repeat(1024 * 1024)}`);
  await assert.rejects(workspace.assertNoSecretMaterial('', join(fixture.root, 'missing-auth')), /CHANGED_FILE_TOO_LARGE/);
});

test('workspace rejects Git config or hook tampering before any host commit can execute', async (t) => {
  const fixture = await sourceFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const config = { jobsDir: join(fixture.root, 'jobs'), repositoryPath: fixture.source, repositorySlug: 'owner/repo', gitBin: '/usr/bin/git', fetchBaseCommit: false };
  const first = new GitWorkspace({ config, claim: claim(fixture.baseCommit), policy: { missionPaths: ['docs'], leasePaths: ['docs'] } });
  await first.prepare();
  await writeFile(join(first.repo, '.git', 'config'), '\n[core]\n\thooksPath = /tmp/host-rce\n', { flag: 'a' });
  await writeFile(join(first.repo, 'docs', 'proof.md'), 'after\n');
  await assert.rejects(first.verifyAndCommit(), /GIT_CONFIG_CHANGED/);

  const secondClaim = claim(fixture.baseCommit);
  secondClaim.mission.missionId = 'mission-2';
  secondClaim.lease.missionId = 'mission-2';
  secondClaim.lease.missionHash = missionHash(secondClaim.mission);
  const second = new GitWorkspace({ config, claim: secondClaim, policy: { missionPaths: ['docs'], leasePaths: ['docs'] } });
  await second.prepare();
  await writeFile(join(second.repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\ntouch /tmp/company-os-hook-must-not-run\n');
  await writeFile(join(second.repo, 'docs', 'proof.md'), 'after\n');
  await assert.rejects(second.verifyAndCommit(), /GIT_HOOK_PRESENT/);
});

test('Draft PR idempotent replay requires marker readback and does not dispatch', async () => {
  const calls = [];
  const payloads = [];
  const fakeApi = { effect: async (action, _claim, payload) => { calls.push(action); payloads.push(payload); return action === 'reserve' ? { reused: true, dispatch: false, effectId: 'effect-1', status: 'UNKNOWN_OUTCOME' } : { status: 'CONFIRMED', retryDispatch: false }; } };
  const effects = new GitHubEffects({
    config: { repositorySlug: 'owner/repo', baseBranch: 'main', ghBin: '/missing', githubToken: 'test-token' }, api: fakeApi,
    claim: claim('a'.repeat(40), 'A2'), workspace: { repo: '/tmp', git: async () => { throw new Error('must not push'); } },
  });
  effects.findDraft = async (_marker, branch, commitSha) => ({
    remoteProvider: 'github', remoteId: '7', remoteUrl: 'https://github.com/owner/repo/pull/7',
    remoteReadback: { number: 7, url: 'https://github.com/owner/repo/pull/7', isDraft: true, branch, commitSha },
  });
  const result = await effects.draftPr({ branch: 'codex/engineering-v2-mission-1-aaaaaaaa', commitSha: 'b'.repeat(40) });
  assert.equal(result.remoteReadback.isDraft, true);
  assert.deepEqual(calls, ['reserve', 'reconcile']);
  assert.equal(payloads[0].verb, 'CREATE_DRAFT_PR');
  assert.equal(payloads[0].targetCommitSha, 'b'.repeat(40));
  assert.equal(payloads[0].idempotencyKey, 'engineering-v2:create-draft-pr:lease-1');
  assert.deepEqual(payloads[1], { effectId: 'effect-1', outcome: 'CONFIRMED', remoteProvider: 'github', remoteId: '7', remoteUrl: 'https://github.com/owner/repo/pull/7', remoteReadback: result.remoteReadback });
});

test('post-dispatch readback failure is durably marked unknown and never reported as a normal failure', async () => {
  const actions = [];
  const fakeApi = {
    effect: async (action, _claim, payload) => {
      actions.push({ action, payload });
      if (action === 'reserve') return { dispatch: true, effectId: 'effect-1', status: 'RESERVED' };
      if (action === 'dispatching') return { status: 'DISPATCHING' };
      if (action === 'unknown') return { status: 'UNKNOWN_OUTCOME', retryDispatch: false };
      throw new Error(`unexpected:${action}`);
    },
  };
  const effects = new GitHubEffects({
    config: { repositorySlug: 'owner/repo', baseBranch: 'main' },
    api: fakeApi,
    claim: claim('a'.repeat(40), 'A2'),
    workspace: {},
  });
  const effect = effects.effect('PUSH_BRANCH', {
    branch: 'codex/engineering-v2-mission-1-aaaaaaaa',
    commitSha: 'b'.repeat(40),
  });
  await assert.rejects(
    effects.dispatch(effect, async () => {}, async () => {
      throw Object.assign(new Error('readback unavailable'), { code: 'REMOTE_READBACK_UNAVAILABLE' });
    }),
    (failure) => failure?.uncertain === true && failure?.code === 'REMOTE_READBACK_UNAVAILABLE',
  );
  assert.deepEqual(actions.map(({ action }) => action), ['reserve', 'dispatching', 'unknown']);
  assert.equal(actions[2].payload.errorCode, 'REMOTE_READBACK_UNAVAILABLE');
});

test('RECONCILE performs readback and reconcile only, never redispatch', async () => {
  const actions = [];
  const claimed = claim('a'.repeat(40), 'A2');
  claimed.mode = 'RECONCILE';
  claimed.effects = [{ effectId: 'effect-pr', verb: 'CREATE_DRAFT_PR', status: 'UNKNOWN_OUTCOME', targetRepository: 'owner/repo', targetBaseBranch: 'main', targetHeadBranch: 'codex/engineering-v2-mission-1-aaaaaaaa', targetCommitSha: 'b'.repeat(40), idempotencyKey: 'draft-key' }];
  const api = {
    effect: async (action, _claim, payload) => { actions.push({ action, payload }); return { status: 'CONFIRMED', retryDispatch: false }; },
    complete: async (_claim, evidence) => { actions.push({ action: 'complete', payload: evidence }); return { status: 'COMPLETED' }; },
  };
  const reconciler = new EngineeringReconciler({ config: {}, api, claimValidator: () => {} });
  reconciler.readback = async () => ({
    remoteProvider: 'github', remoteId: '7', remoteUrl: 'https://github.com/owner/repo/pull/7',
    remoteReadback: {
      number: 7, url: 'https://github.com/owner/repo/pull/7', isDraft: true,
      branch: claimed.effects[0].targetHeadBranch, commitSha: claimed.effects[0].targetCommitSha,
    },
  });
  const result = await reconciler.reconcile(claimed);
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(actions.map((item) => item.action), ['reconcile', 'complete']);
  assert.equal(actions.some((item) => ['reserve', 'dispatching', 'confirm', 'unknown'].includes(item.action)), false);
});

test('RECONCILE skips confirmed effects and creates only missing Draft PR', async () => {
  const actions = [];
  const claimed = claim('a'.repeat(40), 'A2');
  claimed.mode = 'RECONCILE';
  claimed.effects = [{ effectId: 'effect-push', verb: 'PUSH_BRANCH', status: 'CONFIRMED', targetRepository: 'owner/repo', targetBaseBranch: 'main', targetHeadBranch: 'codex/engineering-v2-mission-1-aaaaaaaa', targetCommitSha: 'b'.repeat(40), idempotencyKey: 'push-key' }];
  const api = { complete: async () => { actions.push('complete'); return { status: 'COMPLETED' }; } };
  const reconciler = new EngineeringReconciler({
    config: {}, api,
    effectsFactory: () => ({ draftPr: async (receipt) => { actions.push(`draft:${receipt.branch}`); return { remoteReadback: { isDraft: true } }; } }),
    claimValidator: () => {},
  });
  reconciler.readback = async () => { throw new Error('confirmed effects must not be read back again'); };
  const result = await reconciler.reconcile(claimed);
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(actions, ['draft:codex/engineering-v2-mission-1-aaaaaaaa', 'complete']);
});

test('RECONCILE converts authoritative remote absence into a bounded mission retry', async () => {
  const actions = [];
  const claimed = claim('a'.repeat(40), 'A2');
  claimed.mode = 'RECONCILE';
  claimed.effects = [{
    effectId: 'effect-pr', verb: 'CREATE_DRAFT_PR', status: 'UNKNOWN_OUTCOME',
    targetRepository: 'owner/repo', targetBaseBranch: 'main',
    targetHeadBranch: 'codex/engineering-v2-mission-1-aaaaaaaa',
    targetCommitSha: 'b'.repeat(40), idempotencyKey: 'draft-key',
  }];
  const reconciler = new EngineeringReconciler({
    config: {},
    api: {
      effect: async (action, _claim, payload) => {
        actions.push({ action, payload });
        return { status: 'FAILED', retryDispatch: false };
      },
      fail: async (_claim, payload) => {
        actions.push({ action: 'fail', payload });
        return { status: 'FAILED_RETRYABLE' };
      },
    },
    claimValidator: () => {},
  });
  reconciler.readback = async () => null;
  const result = await reconciler.reconcile(claimed);
  assert.equal(result.status, 'FAILED_RETRYABLE');
  assert.deepEqual(actions.map((item) => item.action), ['reconcile', 'fail']);
  assert.equal(actions[1].payload.code, 'REMOTE_NOT_FOUND_AFTER_READBACK');
});

test('RECONCILE tolerates failed history once new confirmed push and Draft PR exist', async () => {
  const actions = [];
  const claimed = claim('a'.repeat(40), 'A2');
  claimed.mode = 'RECONCILE';
  const common = {
    targetRepository: 'owner/repo', targetBaseBranch: 'main',
    targetHeadBranch: 'codex/engineering-v2-mission-1-aaaaaaaa', targetCommitSha: 'b'.repeat(40),
  };
  claimed.effects = [
    { effectId: 'effect-old', verb: 'PUSH_BRANCH', status: 'FAILED', idempotencyKey: 'old-key', ...common },
    { effectId: 'effect-push', verb: 'PUSH_BRANCH', status: 'CONFIRMED', idempotencyKey: 'push-key', ...common },
    { effectId: 'effect-pr', verb: 'CREATE_DRAFT_PR', status: 'CONFIRMED', idempotencyKey: 'draft-key', ...common },
  ];
  const reconciler = new EngineeringReconciler({
    config: {},
    api: { complete: async () => { actions.push('complete'); return { status: 'COMPLETED' }; } },
    claimValidator: () => {},
  });
  reconciler.readback = async () => { throw new Error('settled effects must not be redispatched'); };
  const result = await reconciler.reconcile(claimed);
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(actions, ['complete']);
});

test('RECONCILE with no reserved effects fails safely so the next attempt re-executes', async () => {
  const claimed = claim('a'.repeat(40), 'A2');
  claimed.mode = 'RECONCILE';
  claimed.effects = [];
  let failure = null;
  const reconciler = new EngineeringReconciler({
    config: {},
    api: { fail: async (_claim, payload) => { failure = payload; return { status: 'FAILED_RETRYABLE' }; } },
    claimValidator: () => {},
  });
  const result = await reconciler.reconcile(claimed);
  assert.equal(result.status, 'FAILED_RETRYABLE');
  assert.equal(failure.code, 'RECONCILE_EFFECTS_MISSING');
});

test('reconciliation-only settles history and cannot create a missing Draft PR', async () => {
  const actions = [];
  const claimed = claim('a'.repeat(40), 'A2');
  claimed.mode = 'RECONCILE';
  claimed.reconciliationOnly = true;
  claimed.lease.allowedVerbs = ['READ_REPOSITORY'];
  claimed.effects = [{
    effectId: 'effect-push', verb: 'PUSH_BRANCH', status: 'CONFIRMED',
    targetRepository: 'owner/repo', targetBaseBranch: 'main',
    targetHeadBranch: 'codex/engineering-v2-mission-1-aaaaaaaa',
    targetCommitSha: 'b'.repeat(40), idempotencyKey: 'push-key',
  }];
  const reconciler = new EngineeringReconciler({
    config: {},
    api: {
      fail: async (_claim, payload) => {
        actions.push({ action: 'fail', payload });
        return { status: 'FAILED_FINAL' };
      },
    },
    effectsFactory: () => {
      actions.push({ action: 'effectsFactory' });
      throw new Error('reconciliation-only must never create an effect adapter');
    },
    claimValidator: () => {},
  });
  const result = await reconciler.reconcile(claimed);
  assert.equal(result.status, 'FAILED_FINAL');
  assert.deepEqual(actions.map(({ action }) => action), ['fail']);
  assert.deepEqual(actions[0].payload, { code: 'RECONCILIATION_AUTHORITY_ENDED', retryable: false });
});
