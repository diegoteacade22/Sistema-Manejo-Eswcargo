import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { EngineeringDaemon } from '../src/daemon.mjs';
import { runProcess } from '../src/process.mjs';

test('empty claim remains IDLE and never calls runner', async () => {
  let claims = 0;
  let runs = 0;
  const daemon = Object.create(EngineeringDaemon.prototype);
  Object.assign(daemon, {
    running: true, currentMissionId: null, state: 'STARTING', lastClaimAt: null, lastErrorCode: null,
    now: () => new Date('2028-01-01T00:00:00Z'),
    api: { claim: async () => { claims += 1; return null; } },
    runner: { execute: async () => { runs += 1; } }, logger: console,
  });
  await daemon.tick();
  assert.equal(claims, 1);
  assert.equal(runs, 0);
  assert.equal(daemon.state, 'IDLE');
});

test('runner failures degrade health without durable state invention', async () => {
  const daemon = Object.create(EngineeringDaemon.prototype);
  Object.assign(daemon, {
    running: true, currentMissionId: null, state: 'IDLE', lastClaimAt: null, lastErrorCode: null,
    now: () => new Date('2028-01-01T00:00:00Z'),
    api: { claim: async () => ({ mode: 'EXECUTE', mission: { missionId: 'm1' } }) },
    runner: { execute: async () => { throw Object.assign(new Error('failed'), { code: 'FAIL_CLOSED' }); } },
    logger: { error() {} },
  });
  await daemon.tick();
  assert.equal(daemon.state, 'DEGRADED');
  assert.equal(daemon.lastErrorCode, 'FAIL_CLOSED');
  assert.equal(daemon.currentMissionId, null);
});

test('installer references Keychain and local auth without embedding secrets', async () => {
  const script = await readFile(new URL('../../../company-os/engineering-runtime/manage.sh', import.meta.url), 'utf8');
  assert.match(script, /security find-generic-password/);
  assert.match(script, /docker_sandbox_ready/);
  assert.match(script, /company-os-codex:0\.150\.1/);
  assert.match(script, /codex sandbox linux --sandbox workspace-write/);
  assert.match(script, /COMPANY_OS_ENGINEERING_HMAC_SECRET="\$\(keychain_get\)"/);
  assert.match(script, /com\.esw\.company-os-runtime\.hmac/);
  assert.match(script, /com\.esw\.company-os-engineering-v2\.github-token/);
  assert.match(script, /COMPANY_OS_ENGINEERING_GITHUB_TOKEN="\$\(github_keychain_get\)"/);
  assert.doesNotMatch(script, /<key>COMPANY_OS_ENGINEERING_HMAC_SECRET<\/key>/);
  assert.doesNotMatch(script, /<key>COMPANY_OS_ENGINEERING_GITHUB_TOKEN<\/key>/);
  assert.match(script, /rollback\)/);
});

test('Docker runner is hardened and does not mount host HOME or GitHub auth', async () => {
  const runner = await readFile(new URL('../src/runner.mjs', import.meta.url), 'utf8');
  assert.match(runner, /'--read-only'/);
  assert.match(runner, /'--cap-drop', 'ALL'/);
  assert.match(runner, /'--security-opt', 'no-new-privileges'/);
  assert.match(runner, /'--user', `\$\{process\.getuid\(\)\}:\$\{process\.getgid\(\)\}`/);
  assert.match(runner, /'--sandbox', 'workspace-write'/);
  assert.match(runner, /dst=\/codex-auth,ro/);
  assert.doesNotMatch(runner, /GH_TOKEN|GH_CONFIG_DIR/);
  assert.doesNotMatch(runner, /--network', 'none/);
  assert.match(runner, /error\?\.uncertain !== true/);
});

test('RECONCILE claim bypasses execution runner', async () => {
  let runs = 0;
  let reconciles = 0;
  const daemon = Object.create(EngineeringDaemon.prototype);
  Object.assign(daemon, {
    running: true, currentMissionId: null, state: 'IDLE', lastClaimAt: null, lastErrorCode: null,
    now: () => new Date('2028-01-01T00:00:00Z'),
    api: { claim: async () => ({ mode: 'RECONCILE', mission: { missionId: 'm1' }, effects: [{ effectId: 'e1' }] }) },
    runner: { execute: async () => { runs += 1; } },
    reconciler: { reconcile: async () => { reconciles += 1; } },
    logger: console,
  });
  await daemon.tick();
  assert.equal(runs, 0);
  assert.equal(reconciles, 1);
  assert.equal(daemon.state, 'IDLE');
});

test('abort signal terminates a bounded process group', async () => {
  const controller = new AbortController();
  const running = runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 10_000, signal: controller.signal });
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(running, /PROCESS_ABORTED_BY_LEASE_CONTROL/);
});
