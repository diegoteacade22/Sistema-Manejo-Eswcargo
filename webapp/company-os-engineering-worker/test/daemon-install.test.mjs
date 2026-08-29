import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { EngineeringDaemon } from '../src/daemon.mjs';
import { createHealthServer } from '../src/health.mjs';
import { runProcess } from '../src/process.mjs';

const manageScriptUrl = new URL('../../../company-os/engineering-runtime/manage.sh', import.meta.url);
const manageScriptPath = fileURLToPath(manageScriptUrl);
const sourceRepoPath = fileURLToPath(new URL('../../../', import.meta.url));

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

test('health Engineering expone por separado versión binaria y de contrato', async (t) => {
  const health = createHealthServer({
    port: 0,
    snapshot: () => ({
      state: 'IDLE',
      controlPlaneObservedAt: '2028-01-01T00:00:00.000Z',
      goalReconcilerHealthy: true,
      lastGoalReconcileAt: '2028-01-01T00:00:00.000Z',
    }),
  });
  t.after(() => health.close());
  const address = await health.listen();
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.service, 'company-os-engineering-v2');
  assert.equal(body.binaryVersion, '2.0.0');
  assert.equal(body.contractVersion, '2.1.0');
});

test('an unmet durable goal is materialized and claimed in the same tick', async () => {
  let claims = 0;
  let runs = 0;
  const missionClaim = { mode: 'EXECUTE', mission: { missionId: 'goal-mission-1' } };
  const daemon = Object.create(EngineeringDaemon.prototype);
  Object.assign(daemon, {
    running: true, currentMissionId: null, state: 'IDLE', lastClaimAt: null, lastErrorCode: null,
    now: () => new Date('2028-01-01T00:00:00Z'),
    api: { claim: async () => { claims += 1; return missionClaim; } },
    runner: { execute: async () => { runs += 1; } },
    goalReconciler: { reconcileIfDue: async () => ({ materialized: 1 }), wake() {} },
    logger: console,
  });
  await daemon.tick();
  assert.equal(claims, 1);
  assert.equal(runs, 1);
  assert.equal(daemon.state, 'IDLE');
});

test('a continuously non-empty mission queue cannot starve goal reconciliation', async () => {
  let reconciles = 0;
  let runs = 0;
  const daemon = Object.create(EngineeringDaemon.prototype);
  Object.assign(daemon, {
    running: true, tickInFlight: false, currentMissionId: null, state: 'IDLE', lastClaimAt: null, lastErrorCode: null,
    now: () => new Date('2028-01-01T00:00:00Z'),
    api: { claim: async () => ({ mode: 'EXECUTE', mission: { missionId: 'queued-mission' } }) },
    runner: { execute: async () => { runs += 1; } },
    goalReconciler: {
      reconcileIfDue: async () => { reconciles += 1; return { materialized: 0 }; },
      snapshot: () => ({ goalReconcilerHealthy: true }),
      wake() {},
    },
    logger: { error() {} },
  });
  await daemon.tick();
  assert.equal(reconciles, 1);
  assert.equal(runs, 1);
  assert.equal(daemon.state, 'IDLE');
});

test('overlapping timer ticks remain single-flight while goals are reconciled', async () => {
  let releaseReconcile;
  const reconcileGate = new Promise((resolve) => { releaseReconcile = resolve; });
  let claims = 0;
  let reconciles = 0;
  let runs = 0;
  const daemon = Object.create(EngineeringDaemon.prototype);
  Object.assign(daemon, {
    running: true, tickInFlight: false, currentMissionId: null, state: 'IDLE', lastClaimAt: null, lastErrorCode: null,
    now: () => new Date('2028-01-01T00:00:00Z'),
    api: { claim: async () => { claims += 1; return null; } },
    runner: { execute: async () => { runs += 1; } },
    goalReconciler: {
      reconcileIfDue: async () => { reconciles += 1; await reconcileGate; return { materialized: 0 }; },
      wake() {},
    },
    logger: console,
  });

  const first = daemon.tick();
  await new Promise((resolve) => setImmediate(resolve));
  const second = daemon.tick();
  releaseReconcile();
  await Promise.all([first, second]);

  assert.equal(claims, 1);
  assert.equal(reconciles, 1);
  assert.equal(runs, 0);
  assert.equal(daemon.tickInFlight, false);
});

test('goal reconciliation failures cannot be masked as IDLE health', async () => {
  const daemon = Object.create(EngineeringDaemon.prototype);
  Object.assign(daemon, {
    running: true, tickInFlight: false, currentMissionId: null, state: 'IDLE', lastClaimAt: null, lastErrorCode: null,
    now: () => new Date('2028-01-01T00:00:00Z'),
    api: { claim: async () => null },
    goalReconciler: {
      reconcileIfDue: async () => ({ materialized: 0, invalid: 1 }),
      snapshot: () => ({ goalReconcilerHealthy: false, goalReconcilerErrorCodes: ['ENGINEERING_GOAL_INVALID'] }),
    },
    logger: { error() {} },
  });
  await daemon.tick();
  assert.equal(daemon.state, 'DEGRADED');
  assert.equal(daemon.lastErrorCode, 'ENGINEERING_GOAL_INVALID');
});

test('goal-plane failure cannot starve a safety reconciliation claim', async () => {
  let safetyRuns = 0;
  let recorded = null;
  const goalState = { healthy: true };
  const daemon = Object.create(EngineeringDaemon.prototype);
  Object.assign(daemon, {
    running: true, tickInFlight: false, currentMissionId: null, state: 'IDLE', lastClaimAt: null, lastErrorCode: null,
    now: () => new Date('2028-01-01T00:00:00Z'),
    api: { claim: async () => ({ mode: 'RECONCILE', reconciliationOnly: true, mission: { missionId: 'safety-1' } }) },
    reconciler: { reconcile: async () => { safetyRuns += 1; } },
    goalReconciler: {
      reconcileIfDue: async () => { throw Object.assign(new Error('offline'), { code: 'GOAL_PLANE_OFFLINE' }); },
      recordFailure: (error) => { recorded = error.code; goalState.healthy = false; },
      snapshot: () => ({ goalReconcilerHealthy: goalState.healthy, goalReconcilerErrorCodes: ['GOAL_PLANE_OFFLINE'] }),
      wake() {},
    },
    logger: { error() {} },
  });
  await daemon.tick();
  assert.equal(recorded, 'GOAL_PLANE_OFFLINE');
  assert.equal(safetyRuns, 1);
  assert.equal(daemon.state, 'DEGRADED');
});

test('installer references Keychain and local auth without embedding secrets', async () => {
  const script = await readFile(manageScriptUrl, 'utf8');
  assert.match(script, /security find-generic-password/);
  assert.match(script, /docker_sandbox_ready/);
  assert.match(script, /company-os-codex:0\.150\.1/);
  assert.match(script, /codex sandbox -P engineering -C \/workspace/);
  assert.match(script, /test ! -r \/codex-home\/auth\.json/);
  assert.match(script, /COMPANY_OS_ENGINEERING_HMAC_SECRET="\$\(keychain_get\)"/);
  assert.match(script, /com\.esw\.company-os-engineering-v2\.hmac/);
  assert.match(script, /com\.esw\.company-os-engineering-v2\.github-token/);
  assert.match(script, /com\.esw\.company-os-engineering-v2\.github-read-token/);
  assert.match(script, /COMPANY_OS_ENGINEERING_GITHUB_TOKEN="\$\(github_keychain_get\)"/);
  assert.match(script, /COMPANY_OS_ENGINEERING_GITHUB_READ_TOKEN="\$\(github_read_keychain_get\)"/);
  assert.doesNotMatch(script, /<key>COMPANY_OS_ENGINEERING_HMAC_SECRET<\/key>/);
  assert.doesNotMatch(script, /<key>COMPANY_OS_ENGINEERING_GITHUB_TOKEN<\/key>/);
  assert.doesNotMatch(script, /<key>COMPANY_OS_ENGINEERING_GITHUB_READ_TOKEN<\/key>/);
  assert.match(script, /rollback\)/);
  assert.match(script, /engineering-secrets\.keychain-db/);
  assert.doesNotMatch(script, /ABSENT_ENGINEERING_KEYCHAIN/);
  assert.doesNotMatch(script, /displaced-engineering-keychain|failed-engineering-keychain/);
  assert.match(script, /mktemp -d "\$BACKUPS\/\$stamp-\$label\.XXXXXX"/);
  assert.match(script, /listener_owned_by_launchd\(\)/);
  assert.match(script, /lsof -nP -t -iTCP:"\$HEALTH_PORT" -sTCP:LISTEN/);
  assert.match(script, /owned_service_responding\(\) \{ loaded && listener_owned_by_launchd && service_responding; \}/);
  assert.match(script, /owned_service_responding \|\| die "Puerto \$HEALTH_PORT ocupado por un servicio ajeno o no verificable"/);
  assert.match(script, /DOCTOR_SERVICE previousVersion=true cutoverAllowed=true/);
  assert.match(script, /v\.binaryVersion==="2\.0\.0"&&v\.contractVersion==="2\.1\.0"&&v\.ok===true/);
  assert.match(script, /COMPANY_OS_ENGINEERING_TEST_MODE/);
  assert.match(script, /dst=\/workspace\/\.git,readonly/);
  assert.match(script, /! touch \/workspace\/\.git\/company-os-write-probe/);
  assert.match(script, /touch \/workspace\/write-ok/);
  assert.match(script, /GIT_OPTIONAL_LOCKS=0 git -C \/workspace status --porcelain=v1/);
  assert.match(script, /mv "\$last_backup_tmp" "\$STATE_DIR\/last-backup"/);
  assert.match(script, /backup_supports_goal_contract/);
  assert.match(script, /COMPANY_OS_ENGINEERING_ALLOW_CONTRACT_DOWNGRADE/);
  assert.match(script, /pausar intake\/ejecución, drenar misiones/);
  assert.match(script, /ROLLBACK_FAILED_AUTO_RESTORE_OK/);
  assert.match(script, /restore_snapshot "\$safety" "\$safety"/);
  assert.equal(script.match(/for attempt in \{1\.\.150\}; do/g)?.length, 2);
});

test('installer shell is valid and snapshots cannot collide within one timestamp', async (t) => {
  await runProcess('/bin/zsh', ['-n', manageScriptPath]);
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'company-os-engineering-snapshot-')));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const home = join(fixture, 'home');
  const state = join(home, 'state');
  const current = join(state, 'current');
  const plist = join(home, 'Library', 'LaunchAgents', 'com.esw.company-os-engineering-v2.plist');
  const fakeBin = join(fixture, 'bin');
  await mkdir(join(current, 'worker', 'src'), { recursive: true });
  await mkdir(join(home, 'Library', 'LaunchAgents'), { recursive: true });
  await mkdir(fakeBin, { recursive: true });
  await writeFile(join(current, 'worker', 'src', 'server.mjs'), 'old-worker');
  await writeFile(plist, 'old-plist');
  const fakeDate = join(fakeBin, 'date');
  await writeFile(fakeDate, '#!/bin/sh\nprintf "20260829T120000\\n"\n');
  await chmod(fakeDate, 0o700);
  const env = {
    ...process.env,
    HOME: home,
    PATH: `${fakeBin}:${process.env.PATH}`,
    COMPANY_OS_ENGINEERING_TEST_MODE: '1',
    COMPANY_OS_ENGINEERING_STATE_DIR: state,
    COMPANY_OS_ENGINEERING_GITHUB_KEYCHAIN_PATH: join(state, 'engineering-secrets.keychain-db'),
  };
  const first = (await runProcess('/bin/zsh', [manageScriptPath, '__test_snapshot', 'collision'], { env })).stdout.trim();
  const second = (await runProcess('/bin/zsh', [manageScriptPath, '__test_snapshot', 'collision'], { env })).stdout.trim();
  assert.notEqual(first, second);
  assert.match(first, /20260829T120000-collision\.[A-Za-z0-9]{6}$/);
  assert.match(second, /20260829T120000-collision\.[A-Za-z0-9]{6}$/);
  assert.equal(await readFile(join(first, 'current', 'worker', 'src', 'server.mjs'), 'utf8'), 'old-worker');
  assert.equal(await readFile(join(first, 'launchd.plist'), 'utf8'), 'old-plist');
});

test('health classification accepts an owned previous version but target health remains strict', async (t) => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'company-os-engineering-health-')));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const fakeLaunchctl = join(fixture, 'launchctl');
  await writeFile(fakeLaunchctl, `#!/bin/sh\nif [ "$1" = "print" ]; then printf "pid = ${process.pid}\\n"; exit 0; fi\nexit 0\n`);
  await chmod(fakeLaunchctl, 0o700);
  let payload = { service: 'company-os-engineering-v2', binaryVersion: '1.9.0', contractVersion: '2.0.0', ok: true };
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const env = {
    ...process.env,
    PATH: `${fixture}:${process.env.PATH}`,
    COMPANY_OS_ENGINEERING_TEST_MODE: '1',
    COMPANY_OS_ENGINEERING_NODE_BIN: process.execPath,
    COMPANY_OS_ENGINEERING_HEALTH_PORT: String(address.port),
  };
  const previous = await runProcess('/bin/zsh', [manageScriptPath, '__test_health'], { env });
  assert.match(previous.stdout, /serviceResponding=true ownedService=true targetHealthy=false/);

  payload = { service: 'company-os-engineering-v2', binaryVersion: '2.0.0', contractVersion: '2.1.0', ok: true };
  const target = await runProcess('/bin/zsh', [manageScriptPath, '__test_health'], { env });
  assert.match(target.stdout, /serviceResponding=true ownedService=true targetHealthy=true/);

  await writeFile(fakeLaunchctl, '#!/bin/sh\nif [ "$1" = "print" ]; then printf "pid = 999999\\n"; exit 0; fi\nexit 0\n');
  const spoofedPid = await runProcess('/bin/zsh', [manageScriptPath, '__test_health'], { env });
  assert.match(spoofedPid.stdout, /serviceResponding=true ownedService=false targetHealthy=true/);

  payload = { service: 'foreign-service', binaryVersion: '2.0.0', contractVersion: '2.1.0', ok: true };
  const foreign = await runProcess('/bin/zsh', [manageScriptPath, '__test_health'], { env });
  assert.match(foreign.stdout, /serviceResponding=false ownedService=false targetHealthy=false/);
});

test('doctor composes a Docker smoke with nested read-only git metadata', async (t) => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'company-os-engineering-docker-smoke-')));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const home = join(fixture, 'home');
  const state = join(home, 'state');
  const auth = join(state, 'codex-auth');
  const fakeBin = join(fixture, 'bin');
  const fakeDocker = join(fakeBin, 'docker');
  const capture = join(fixture, 'docker-args.txt');
  await mkdir(auth, { recursive: true });
  await mkdir(fakeBin, { recursive: true });
  await writeFile(join(auth, 'auth.json'), '{}');
  await writeFile(fakeDocker, '#!/bin/sh\nprintf "%s\\n" "$@" > "$COMPANY_OS_ENGINEERING_TEST_CAPTURE"\n');
  await chmod(fakeDocker, 0o700);
  const env = {
    ...process.env,
    HOME: home,
    COMPANY_OS_ENGINEERING_TEST_MODE: '1',
    COMPANY_OS_ENGINEERING_TEST_CAPTURE: capture,
    COMPANY_OS_ENGINEERING_STATE_DIR: state,
    COMPANY_OS_ENGINEERING_GITHUB_KEYCHAIN_PATH: join(state, 'engineering-secrets.keychain-db'),
    COMPANY_OS_ENGINEERING_SOURCE_REPO: sourceRepoPath,
    COMPANY_OS_ENGINEERING_CODEX_AUTH_DIR: auth,
    COMPANY_OS_ENGINEERING_DOCKER_BIN: fakeDocker,
    COMPANY_OS_ENGINEERING_GIT_BIN: '/usr/bin/git',
  };
  const result = await runProcess('/bin/zsh', [manageScriptPath, '__test_docker_sandbox'], { env });
  assert.match(result.stdout, /DOCKER_SANDBOX_TEST_OK/);
  const args = await readFile(capture, 'utf8');
  assert.match(args, /dst=\/workspace\/\.git,readonly/);
  assert.match(args, /! touch \/workspace\/\.git\/company-os-write-probe/);
  assert.match(args, /touch \/workspace\/write-ok/);
  assert.match(args, /GIT_OPTIONAL_LOCKS=0 git -C \/workspace status --porcelain=v1/);
});

test('Docker runner is hardened and does not mount host HOME or GitHub auth', async () => {
  const runner = await readFile(new URL('../src/runner.mjs', import.meta.url), 'utf8');
  const workspace = await readFile(new URL('../src/git-workspace.mjs', import.meta.url), 'utf8');
  assert.match(runner, /'--read-only'/);
  assert.match(runner, /'--cap-drop', 'ALL'/);
  assert.match(runner, /'--security-opt', 'no-new-privileges'/);
  assert.match(runner, /'--security-opt', 'seccomp=unconfined'/);
  assert.match(runner, /'--user', `\$\{process\.getuid\(\)\}:\$\{process\.getgid\(\)\}`/);
  assert.match(runner, /dst=\/codex-home\/auth\.json,readonly/);
  assert.match(runner, /dst=\/codex-home\/config\.toml,readonly/);
  assert.match(runner, /dst=\/workspace\/\.git,readonly/);
  assert.match(workspace, /core\.hooksPath=\/dev\/null/);
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
