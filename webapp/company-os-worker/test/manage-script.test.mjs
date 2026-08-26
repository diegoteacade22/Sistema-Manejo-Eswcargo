import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('restart usa kickstart -k sin descargar el LaunchAgent', async () => {
  const packagedManage = new URL('../../manage.sh', import.meta.url);
  const repositoryManage = new URL('../../../company-os/runtime/manage.sh', import.meta.url);
  const manageUrl = existsSync(fileURLToPath(packagedManage)) ? packagedManage : repositoryManage;
  const script = await readFile(manageUrl, 'utf8');
  const restartAction = script.match(/restart_action\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';

  assert.match(restartAction, /launchctl kickstart -k/);
  assert.doesNotMatch(restartAction, /bootout_if_loaded/);
  assert.doesNotMatch(restartAction, /launchctl bootstrap/);
  assert.match(restartAction, /wait_for_health/);

  const bootstrapCalls = script.match(/launchctl bootstrap "gui/g) ?? [];
  const bootstrapHelper = script.match(/bootstrap_service\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.equal(bootstrapCalls.length, 1);
  assert.match(bootstrapHelper, /for attempt in \{1\.\.10\}/);
  assert.match(bootstrapHelper, /sleep 1/);
});
