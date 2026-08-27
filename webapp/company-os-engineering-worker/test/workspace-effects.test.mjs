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
});

test('Draft PR idempotent replay requires marker readback and does not dispatch', async () => {
  const calls = [];
  const payloads = [];
  const fakeApi = { effect: async (action, _claim, payload) => { calls.push(action); payloads.push(payload); return action === 'reserve' ? { reused: true, dispatch: false, effectId: 'effect-1', status: 'UNKNOWN_OUTCOME' } : { status: 'CONFIRMED', retryDispatch: false }; } };
  const effects = new GitHubEffects({
    config: { repositorySlug: 'owner/repo', baseBranch: 'main', ghBin: '/missing', githubToken: 'test-token' }, api: fakeApi,
    claim: claim('a'.repeat(40), 'A2'), workspace: { repo: '/tmp', git: async () => { throw new Error('must not push'); } },
  });
  effects.findDraft = async (_marker, branch) => ({ remoteProvider: 'github', remoteId: '7', remoteUrl: 'https://example.invalid/pr/7', remoteReadback: { number: 7, url: 'https://example.invalid/pr/7', isDraft: true, branch } });
  const result = await effects.draftPr({ branch: 'codex/engineering-v2-mission-1-aaaaaaaa', commitSha: 'b'.repeat(40) });
  assert.equal(result.remoteReadback.isDraft, true);
  assert.deepEqual(calls, ['reserve', 'reconcile']);
  assert.equal(payloads[0].verb, 'CREATE_DRAFT_PR');
  assert.equal(payloads[0].targetCommitSha, 'b'.repeat(40));
  assert.deepEqual(payloads[1], { effectId: 'effect-1', outcome: 'CONFIRMED', remoteProvider: 'github', remoteId: '7', remoteUrl: 'https://example.invalid/pr/7', remoteReadback: result.remoteReadback });
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
  reconciler.readback = async () => ({ remoteProvider: 'github', remoteId: '7', remoteUrl: 'https://example.invalid/pr/7', remoteReadback: { number: 7, isDraft: true } });
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
