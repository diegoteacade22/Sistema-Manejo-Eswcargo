import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const managerSource = resolve('../company-os/codex-task-collector/manage.sh');
const darwinOnly = process.platform !== 'darwin';

function waitForFile(path: string, timeoutMs = 5_000) {
  return new Promise<void>((resolveWait, rejectWait) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      if (existsSync(path)) return resolveWait();
      if (Date.now() >= deadline) return rejectWait(new Error(`timeout waiting for ${path}`));
      setTimeout(poll, 25);
    };
    poll();
  });
}

function runManager(path: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveRun, rejectRun) => {
    const child = spawn('/bin/zsh', [path, 'uninstall'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', rejectRun);
    child.once('close', (code) => resolveRun({ code, stdout, stderr }));
  });
}

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'company-os-manager-test-')));
  const home = join(root, 'home');
  const state = join(home, '.company-os-codex-collector');
  const current = join(state, 'current');
  const launchAgents = join(home, 'Library', 'LaunchAgents');
  const bin = join(root, 'bin');
  const manager = join(current, 'manage.sh');
  const collector = join(current, 'collector.mjs');
  const plist = join(launchAgents, 'com.esw.company-os-codex-collector.plist');
  mkdirSync(current, { recursive: true, mode: 0o700 });
  mkdirSync(launchAgents, { recursive: true, mode: 0o700 });
  mkdirSync(bin, { recursive: true, mode: 0o700 });
  cpSync(managerSource, manager);
  chmodSync(manager, 0o700);
  const launchctl = join(bin, 'launchctl');
  writeFileSync(launchctl, '#!/bin/zsh\ncase "$1" in\n  print) exit 1 ;;\n  bootout|bootstrap|kickstart) exit 0 ;;\n  *) exit 1 ;;\nesac\n', { mode: 0o700 });
  writeFileSync(collector, 'import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.ORPHAN_READY, "ready");\nsetInterval(() => {}, 1000);\n', { mode: 0o700 });
  writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.esw.company-os-codex-collector</string>
<key>ProgramArguments</key><array><string>/bin/zsh</string><string>${manager}</string><string>run</string></array>
<key>EnvironmentVariables</key><dict><key>COMPANY_OS_CODEX_NODE_BIN</key><string>${process.execPath}</string></dict>
</dict></plist>
`, { mode: 0o600 });
  const legacyLock = join(state, 'run.lock');
  mkdirSync(legacyLock, { mode: 0o700 });
  writeFileSync(join(legacyLock, 'pid'), '999999\n', { mode: 0o600 });
  writeFileSync(join(legacyLock, 'start'), 'dead-owner\n', { mode: 0o600 });
  writeFileSync(join(legacyLock, 'command'), 'dead-manager\n', { mode: 0o600 });
  writeFileSync(join(legacyLock, 'token'), 'legacy-token\n', { mode: 0o600 });
  const stale = new Date(Date.now() - 31_000);
  utimesSync(legacyLock, stale, stale);
  const env = {
    ...process.env,
    HOME: home,
    PATH: `${bin}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
    COMPANY_OS_CODEX_COLLECTOR_STATE_DIR: state,
    COMPANY_OS_CODEX_NODE_BIN: process.execPath,
    COMPANY_OS_CODEX_INSTALL_ID: 'manager-regression-test',
  };
  return { root, state, manager, collector, plist, legacyLock, env };
}

test('un collector legacy huérfano bloquea la migración del lock stale', { skip: darwinOnly }, async (t) => {
  const value = fixture();
  const ready = join(value.root, 'orphan-ready');
  const orphan = spawn(process.execPath, [value.collector], { env: { ...process.env, ORPHAN_READY: ready }, stdio: 'ignore' });
  t.after(() => {
    orphan.kill('SIGTERM');
    rmSync(value.root, { recursive: true, force: true });
  });
  await waitForFile(ready);

  const result = await runManager(value.manager, value.env);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /LEGACY_COLLECTOR_ORPHANED/);
  assert.equal(existsSync(value.legacyLock), true);
  assert.equal(existsSync(value.plist), true);
  assert.equal(existsSync(join(value.state, 'uninstall-transaction.json')), true);
});

test('un lock legacy stale sin collector vivo se migra y la desinstalación converge', { skip: darwinOnly }, async (t) => {
  const value = fixture();
  t.after(() => rmSync(value.root, { recursive: true, force: true }));

  const result = await runManager(value.manager, value.env);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /UNINSTALLED/);
  assert.equal(existsSync(value.legacyLock), false);
  assert.equal(existsSync(value.plist), false);
  assert.equal(existsSync(join(value.state, 'uninstall-transaction.json')), false);
  assert.equal(readdirSync(value.state).some((name) => name.startsWith('run.lock.legacy.')), true);
  assert.equal(readdirSync(value.state).some((name) => name.startsWith('com.esw.company-os-codex-collector.plist.disabled.')), true);
});
