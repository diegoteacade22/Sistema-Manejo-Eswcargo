import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import { EngineeringApiClient } from '../src/api-client.mjs';
import { assertChangedPaths, branchName, isProhibitedPath, missionHash, validateClaim } from '../src/policy.mjs';
import { engineeringSignatureMessage, signedHeaders } from '../src/signing.mjs';
import { githubEnvironment, githubGitEnvironment, nonSecretEnvironment } from '../src/process.mjs';
import { loadConfig } from '../src/config.mjs';
import { homedir } from 'node:os';

const config = { repositorySlug: 'owner/repo', baseBranch: 'main', maxAutonomy: 'A1', workerId: 'worker' };
const mission = {
  missionId: 'mission-1', objective: 'Update bounded docs', repository: 'owner/repo',
  baseCommit: 'a'.repeat(40), allowedPaths: ['docs'], acceptanceCriteria: ['Exact text exists'],
  autonomyLevel: 'A1', budgetUsd: 1, deadline: '2030-01-01T00:00:00.000Z',
  policyHash: 'policy', expectedStateVersion: 3,
};
const lease = {
  leaseId: 'lease-1', missionId: 'mission-1', missionHash: missionHash(mission), actor: 'worker', resource: 'owner/repo',
  allowedVerbs: ['READ_REPOSITORY', 'WRITE_WORKTREE', 'RUN_TESTS', 'RUN_BUILD', 'COMMIT_LOCAL'], allowedPaths: ['docs'],
  autonomyLevel: 'A1', budgetUsd: 1, policyHash: 'policy', fencingToken: 4, expectedStateVersion: 3,
  issuedAt: '2027-01-01T00:00:00.000Z', expiresAt: '2030-01-01T00:00:00.000Z',
};
const claimed = (selectedMission = mission, selectedLease = lease, effects = [], mode = 'EXECUTE') => ({ mode, mission: selectedMission, lease: selectedLease, effects });

function canonicalJsonV20(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonV20).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, nested]) => nested !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJsonV20(nested)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

test('Engineering HMAC v3 binds domain, version, method, path, worker, nonce, timestamp and exact body', () => {
  const rawBody = '{"workerId":"worker-1"}';
  const input = {
    secret: 'secret', method: 'POST', pathname: '/api/company-os/engineering/v2/claim',
    workerId: 'worker-1', rawBody, nowMs: 1_800_000_000_000, nonce: 'abcdefghijklmnop',
  };
  const headers = signedHeaders(input);
  const expected = createHmac('sha256', 'secret').update(engineeringSignatureMessage({
    method: input.method, pathname: input.pathname, workerId: input.workerId,
    nonce: input.nonce, timestamp: '1800000000', rawBody,
  })).digest('hex');
  assert.equal(headers['x-company-os-signature-version'], 'engineering-v3');
  assert.equal(headers['x-company-os-signature'], `sha256=${expected}`);
  const crossRoute = signedHeaders({ ...input, pathname: '/api/company-os/engineering/v2/heartbeat' });
  assert.notEqual(crossRoute['x-company-os-signature'], headers['x-company-os-signature']);
});

test('claim validates fixed repository, authority and time', () => {
  const validated = validateClaim(claimed(), config, new Date('2028-01-01T00:00:00.000Z'));
  assert.deepEqual(validated, { missionPaths: ['docs'], leasePaths: ['docs'], desiredState: null });
  assert.throws(() => validateClaim(claimed({ ...mission, repository: 'owner/other' }, lease), config, new Date('2028-01-01')), /REPOSITORY_NOT_ALLOWLISTED/);
  const prohibitedMission = { ...mission, allowedPaths: ['.github'] };
  assert.throws(() => validateClaim(claimed(prohibitedMission, { ...lease, missionHash: missionHash(prohibitedMission) }), config, new Date('2028-01-01')), /PROHIBITED_PATH_AUTHORITY/);
  assert.throws(() => validateClaim(claimed(mission, { ...lease, expiresAt: '2027-01-01T00:00:00Z' }), config, new Date('2028-01-01')), /LEASE_EXPIRED/);
  assert.doesNotThrow(() => validateClaim(claimed(mission, { ...lease, issuedAt: '2028-01-01T00:00:04.999Z' }), config, new Date('2028-01-01T00:00:00Z')));
  assert.throws(() => validateClaim(claimed(mission, { ...lease, issuedAt: '2028-01-01T00:00:05.001Z' }), config, new Date('2028-01-01T00:00:00Z')), /LEASE_NOT_ACTIVE/);
  assert.throws(() => validateClaim(claimed(mission, { ...lease, missionHash: 'b'.repeat(64) }), config, new Date('2028-01-01')), /LEASE_BINDING_MISMATCH/);
  assert.throws(() => validateClaim(claimed(mission, { ...lease, actor: 'other-worker' }), config, new Date('2028-01-01')), /ACTOR_MISMATCH/);
});

test('worker nuevo acepta payload legacy 2.0 sin contractVersion ni desiredState con el mismo hash', () => {
  const legacyMission = { ...mission };
  delete legacyMission.contractVersion;
  delete legacyMission.desiredState;
  const { expectedStateVersion: _mutableStateVersion, ...immutableMission } = legacyMission;
  const worker20Hash = createHash('sha256')
    .update(canonicalJsonV20({ contractVersion: '2.0.0', ...immutableMission }))
    .digest('hex');
  assert.equal(missionHash(legacyMission), worker20Hash);
  assert.deepEqual(
    validateClaim(claimed(legacyMission, { ...lease, missionHash: worker20Hash }), config, new Date('2028-01-01T00:00:00.000Z')),
    { missionPaths: ['docs'], leasePaths: ['docs'], desiredState: null },
  );
});

test('A2 needs explicit local maximum and effect verbs', () => {
  const a2Mission = { ...mission, autonomyLevel: 'A2' };
  const a2Lease = { ...lease, missionHash: missionHash(a2Mission), autonomyLevel: 'A2', allowedVerbs: [...lease.allowedVerbs, 'PUSH_BRANCH', 'CREATE_DRAFT_PR'] };
  assert.throws(() => validateClaim(claimed(a2Mission, a2Lease), config, new Date('2028-01-01')), /AUTONOMY_DENIED/);
  assert.doesNotThrow(() => validateClaim(claimed(a2Mission, a2Lease), { ...config, maxAutonomy: 'A2' }, new Date('2028-01-01')));
  const effects = ['PUSH_BRANCH', 'CREATE_DRAFT_PR'].map((verb, index) => ({
    effectId: `effect-${index}`, idempotencyKey: `key-${index}`, targetRepository: a2Mission.repository,
    targetBaseBranch: 'main', targetHeadBranch: 'codex/engineering-v2-mission-1-aaaaaaaa',
    targetCommitSha: 'b'.repeat(40), verb, status: 'UNKNOWN_OUTCOME',
  }));
  assert.doesNotThrow(() => validateClaim(claimed(a2Mission, a2Lease, effects, 'RECONCILE'), { ...config, maxAutonomy: 'A2' }, new Date('2028-01-01')));
  assert.throws(() => validateClaim(claimed(a2Mission, a2Lease, effects, 'EXECUTE'), { ...config, maxAutonomy: 'A2' }, new Date('2028-01-01')), /EXECUTE_EFFECTS_MUST_BE_EMPTY/);
});

test('reconciliation-only tolerates an expired mission only with an exact read-only lease', () => {
  const a2Mission = {
    ...mission,
    autonomyLevel: 'A2',
    deadline: '2027-12-31T23:59:00.000Z',
  };
  const effect = {
    effectId: 'effect-unknown', idempotencyKey: 'unknown-key',
    targetRepository: a2Mission.repository, targetBaseBranch: 'main',
    targetHeadBranch: 'codex/engineering-v2-mission-1-aaaaaaaa',
    targetCommitSha: 'b'.repeat(40), verb: 'PUSH_BRANCH', status: 'UNKNOWN_OUTCOME',
  };
  const safetyLease = {
    ...lease,
    missionHash: missionHash(a2Mission),
    autonomyLevel: 'A2',
    allowedVerbs: ['READ_REPOSITORY'],
  };
  const safetyClaim = {
    ...claimed(a2Mission, safetyLease, [effect], 'RECONCILE'),
    reconciliationOnly: true,
  };
  assert.doesNotThrow(() => validateClaim(
    safetyClaim,
    { ...config, maxAutonomy: 'A2' },
    new Date('2028-01-01T00:00:00.000Z'),
  ));
  assert.throws(() => validateClaim(
    { ...safetyClaim, lease: { ...safetyLease, allowedVerbs: ['READ_REPOSITORY', 'PUSH_BRANCH'] } },
    { ...config, maxAutonomy: 'A2' },
    new Date('2028-01-01T00:00:00.000Z'),
  ), /RECONCILIATION_AUTHORITY_ESCALATION/);
  assert.throws(() => validateClaim(
    { ...safetyClaim, mode: 'EXECUTE' },
    { ...config, maxAutonomy: 'A2' },
    new Date('2028-01-01T00:00:00.000Z'),
  ), /RECONCILIATION_MODE_INVALID/);
});

test('paths fail closed for traversal and prohibited surfaces', () => {
  assert.equal(isProhibitedPath('docs/.env.production'), true);
  assert.equal(isProhibitedPath('supabase/migrations/x.sql'), true);
  assert.throws(() => assertChangedPaths(['../escape'], ['docs'], ['docs']), /PATH_INVALID/);
  assert.throws(() => assertChangedPaths(['src/file.ts'], ['docs'], ['docs']), /PATH_OUTSIDE_CAPABILITY/);
  assert.doesNotThrow(() => assertChangedPaths(['docs/file.md'], ['docs'], ['docs']));
  assert.match(branchName(mission), /^codex\/engineering-v2-/);
});

test('API client uses only engineering v2 endpoints and unique signed nonce', async () => {
  const requests = [];
  let nonce = 0;
  const client = new EngineeringApiClient({
    baseUrl: 'https://manager.example', secret: 'secret', workerId: 'worker-1', instanceId: 'instance-1',
    nonceFactory: () => `nonce00000000000${++nonce}`,
    fetchImpl: async (url, init) => { requests.push({ url, init }); return new Response(null, { status: 204 }); },
  });
  assert.equal(await client.claim(), null);
  assert.equal(await client.claim(), null);
  assert.equal(requests[0].url, 'https://manager.example/api/company-os/engineering/v2/claim');
  assert.notEqual(requests[0].init.headers['x-company-os-nonce'], requests[1].init.headers['x-company-os-nonce']);
  assert.deepEqual(JSON.parse(requests[0].init.body), { workerId: 'worker-1', instanceId: 'instance-1' });
});

test('API payloads are flat and route error code is preserved', async () => {
  const requests = [];
  const client = new EngineeringApiClient({
    baseUrl: 'https://manager.example', secret: 'secret', workerId: 'worker', instanceId: 'instance', nonceFactory: () => 'abcdefghijklmnop',
    fetchImpl: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      if (url.endsWith('/transition')) return Response.json({ reused: false, status: 'VERIFYING' });
      if (url.endsWith('/effect/reserve')) return Response.json({ reused: false, dispatch: true, effectId: 'effect-1', status: 'RESERVED' });
      return Response.json({ error: 'denied', code: 'FENCING_TOKEN_STALE' }, { status: 409 });
    },
  });
  await client.transition(claimed(), 'VERIFYING', 'ENGINEERING_VERIFYING', { proof: true }, 'transition-key');
  await client.effect('reserve', claimed(), { verb: 'PUSH_BRANCH', targetRepository: 'owner/repo', targetBaseBranch: 'main', targetHeadBranch: 'codex/engineering-v2-mission-1-aaaaaaaa', targetCommitSha: 'b'.repeat(40), idempotencyKey: 'effect-key' });
  assert.deepEqual(requests[0].body, { missionId: 'mission-1', leaseId: 'lease-1', fencingToken: 4, toStatus: 'VERIFYING', eventType: 'ENGINEERING_VERIFYING', payload: { proof: true }, idempotencyKey: 'transition-key', workerId: 'worker', instanceId: 'instance' });
  assert.equal(requests[1].body.verb, 'PUSH_BRANCH');
  assert.equal('effect' in requests[1].body, false);
  await assert.rejects(client.complete(claimed(), { ok: true }), (error) => error.code === 'FENCING_TOKEN_STALE');
});

test('Codex environment excludes GitHub credentials while gh receives only explicit token', () => {
  const source = { HOME: '/home/test', PATH: '/bin', GH_TOKEN: 'host-token', GH_CONFIG_DIR: '/host/gh', COMPANY_OS_ENGINEERING_GITHUB_TOKEN: 'runtime-token' };
  assert.deepEqual(nonSecretEnvironment(source), { HOME: '/home/test', PATH: '/bin' });
  assert.deepEqual(githubEnvironment('adapter-token', source), { HOME: '/home/test', PATH: '/bin', GH_TOKEN: 'adapter-token' });
  const gitEnv = githubGitEnvironment('adapter-token', source);
  assert.equal(gitEnv.GIT_CONFIG_COUNT, '1');
  assert.equal(gitEnv.GIT_TERMINAL_PROMPT, '0');
  assert.equal(Buffer.from(gitEnv.GIT_CONFIG_VALUE_0.split(' ').at(-1), 'base64').toString('utf8'), 'x-access-token:adapter-token');
  assert.equal('GH_CONFIG_DIR' in gitEnv, false);
});

test('A1 config does not require GitHub token while A2 does', () => {
  const base = {
    COMPANY_OS_ENGINEERING_HMAC_SECRET: 'hmac',
    COMPANY_OS_ENGINEERING_REPOSITORY_PATH: '/tmp/repo',
    COMPANY_OS_ENGINEERING_REPOSITORY_SLUG: 'owner/repo',
    COMPANY_OS_ENGINEERING_CODEX_AUTH_DIR: '/tmp/codex-auth',
    COMPANY_OS_ENGINEERING_STATE_DIR: `${homedir()}/.company-os-engineering-v2-test`,
  };
  assert.equal(loadConfig(base).githubToken, null);
  assert.equal(loadConfig(base).binaryVersion, '2.0.0');
  assert.equal(loadConfig(base).contractVersion, '2.1.0');
  assert.throws(() => loadConfig({ ...base, COMPANY_OS_ENGINEERING_WORKER_ID: 'x' }), /ENGINEERING_WORKER_ID_INVALID/);
  assert.throws(() => loadConfig({ ...base, COMPANY_OS_ENGINEERING_MAX_AUTONOMY: 'A2' }), /GITHUB_TOKEN_REQUIRED/);
  assert.equal(loadConfig({ ...base, COMPANY_OS_ENGINEERING_MAX_AUTONOMY: 'A2', COMPANY_OS_ENGINEERING_GITHUB_TOKEN: 'token' }).githubToken, 'token');
});
