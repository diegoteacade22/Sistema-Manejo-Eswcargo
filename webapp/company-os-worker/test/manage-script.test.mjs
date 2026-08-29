import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

async function manageScript() {
  const packagedManage = new URL('../../manage.sh', import.meta.url);
  const repositoryManage = new URL('../../../company-os/runtime/manage.sh', import.meta.url);
  const manageUrl = existsSync(fileURLToPath(packagedManage)) ? packagedManage : repositoryManage;
  return readFile(manageUrl, 'utf8');
}

function functionBody(script, name) {
  return script.match(new RegExp(`${name}\\(\\) \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
}

test('restart usa kickstart -k sin descargar el LaunchAgent', async () => {
  const script = await manageScript();
  const restartAction = functionBody(script, 'restart_action');

  assert.match(restartAction, /launchctl kickstart -k/);
  assert.doesNotMatch(restartAction, /bootout_if_loaded/);
  assert.doesNotMatch(restartAction, /launchctl bootstrap/);
  assert.match(restartAction, /wait_for_target_health/);

  const bootstrapCalls = script.match(/launchctl bootstrap "gui/g) ?? [];
  const bootstrapHelper = functionBody(script, 'bootstrap_service');
  assert.equal(bootstrapCalls.length, 1);
  assert.match(bootstrapHelper, /for attempt in \{1\.\.10\}/);
  assert.match(bootstrapHelper, /sleep 1/);
});

test('health genérico acepta versión propia previa y health objetivo fija runtime 1.1', async () => {
  const script = await manageScript();
  const ownHealth = functionBody(script, 'health_is_own_operational');
  const targetIdentity = functionBody(script, 'health_is_target_runtime');
  const targetHealth = functionBody(script, 'health_is_target_operational');
  const ownOperational = functionBody(script, 'runtime_own_is_operational');
  const targetOperational = functionBody(script, 'runtime_target_is_operational');

  assert.match(ownHealth, /value\.service === "company-os-runtime"/);
  assert.match(ownHealth, /value\.ok === true/);
  assert.match(ownHealth, /lastWorkerHeartbeatAt/);
  assert.doesNotMatch(ownHealth, /binaryVersion|contractVersion/);
  assert.match(targetIdentity, /value\.binaryVersion === "1\.1\.0"/);
  assert.match(targetIdentity, /value\.contractVersion === "runtime-v1"/);
  assert.match(targetHealth, /value\.binaryVersion === "1\.1\.0"/);
  assert.match(targetHealth, /value\.contractVersion === "runtime-v1"/);
  assert.match(ownOperational, /health_is_own_operational && runtime_listener_is_owned/);
  assert.match(targetOperational, /health_is_target_operational && runtime_listener_is_owned/);
});

test('propiedad del listener exige que el PID único del puerto sea el PID de launchd', async () => {
  const script = await manageScript();
  const launchdPid = functionBody(script, 'launchd_pid');
  const listeners = functionBody(script, 'listener_pids');
  const owned = functionBody(script, 'runtime_listener_is_owned');

  assert.match(launchdPid, /launchctl print/);
  assert.match(launchdPid, /\$1 == "pid"/);
  assert.match(listeners, /lsof -nP -tiTCP/);
  assert.match(listeners, /!seen\[\$0\]\+\+/);
  assert.match(owned, /service_loaded/);
  assert.match(owned, /service_pid="\$\(launchd_pid/);
  assert.match(owned, /"\$listeners" == "\$service_pid"/);
});

test('doctor permite cutover de runtime propio previo, rechaza puerto ajeno y valida Qwen local exacto', async () => {
  const script = await manageScript();
  const doctor = functionBody(script, 'doctor_action');
  const ollama = functionBody(script, 'check_ollama_fallback');

  const targetIndex = doctor.indexOf('runtime_target_is_operational');
  const targetIdentifiedIndex = doctor.indexOf('runtime_target_is_identified');
  const ownIndex = doctor.indexOf('runtime_own_is_identified');
  const occupiedIndex = doctor.indexOf('port_has_listener');
  assert.ok(targetIndex >= 0 && targetIdentifiedIndex > targetIndex && ownIndex > targetIdentifiedIndex && occupiedIndex > ownIndex);
  assert.match(doctor, /cutover_allowed=true/);
  assert.match(functionBody(script, 'runtime_own_is_identified'), /health_is_own_runtime && runtime_listener_is_owned/);
  assert.match(doctor, /Puerto \$RUNTIME_HEALTH_PORT ocupado por otro proceso/);
  assert.match(doctor, /check_ollama_fallback/);

  assert.match(ollama, /url\.hostname === "127\.0\.0\.1"/);
  assert.match(ollama, /url\.hostname === "\[::1\]"/);
  assert.match(ollama, /url\.protocol !== "http:"/);
  assert.match(ollama, /--location --max-redirs 0/);
  assert.match(ollama, /\$RUNTIME_OLLAMA_BASE_URL\/api\/tags/);
  assert.match(ollama, /item\.name === expected/);
  assert.doesNotMatch(ollama, /say .*\$tags/);
  assert.match(ollama, /print -rn -- "\$tags" \| "\$NODE_BIN"/);
});

test('install y restart esperan versión objetivo; rollback y restauración esperan runtime propio genérico', async () => {
  const script = await manageScript();
  const install = functionBody(script, 'install_action');
  const restart = functionBody(script, 'restart_action');
  const rollback = functionBody(script, 'rollback_action');
  const restore = functionBody(script, 'restore_snapshot_and_verify');

  assert.match(install, /wait_for_target_health/);
  assert.match(restart, /wait_for_target_health/);
  assert.doesNotMatch(install, /wait_for_own_health/);
  assert.match(rollback, /wait_for_own_health/);
  assert.match(restore, /wait_for_own_health/);
  assert.match(restore, /bootstrap_service/);
  assert.match(restore, /! service_loaded && ! port_has_listener/);
});

test('snapshot es único, actualiza last-backup atómicamente y auto-rollback verifica readback', async () => {
  const script = await manageScript();
  const snapshot = functionBody(script, 'backup_snapshot');
  const install = functionBody(script, 'install_action');
  const rollback = functionBody(script, 'rollback_action');

  assert.match(snapshot, /mktemp -d .*\.XXXXXX/);
  assert.match(snapshot, /mktemp .*\.last-backup\.XXXXXX/);
  assert.match(snapshot, /mv -f "\$reference_tmp" "\$RUNTIME_STATE_DIR\/last-backup"/);
  assert.doesNotMatch(snapshot, /> "\$RUNTIME_STATE_DIR\/last-backup"/);
  assert.ok((install.match(/restore_snapshot_and_verify "\$backup"/g) ?? []).length >= 2);
  assert.ok((rollback.match(/restore_snapshot_and_verify "\$safety"/g) ?? []).length >= 2);
  assert.match(install, /restaurado y verificado/);
  assert.match(rollback, /restaurado y verificado/);
});
