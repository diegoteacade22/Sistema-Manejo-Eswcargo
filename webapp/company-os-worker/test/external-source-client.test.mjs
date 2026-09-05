import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeExternalSources } from '../src/external-source-client.mjs';

const observedAt = new Date('2026-09-05T18:00:00.000Z');
const identitySecret = 'external-item-test-secret';

function serviceAccount() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return JSON.stringify({ type: 'service_account', client_email: 'runtime-reader@example.invalid',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
}

test('Drive y Sheets emiten sólo identidades HMAC y Contacts exige un puente OAuth separado', async () => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const value = String(url);
    if (value.includes('oauth2.googleapis.com/token')) {
      assert.match(String(init.body), /urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);
      return new Response(JSON.stringify({ access_token: 'ephemeral-test-token' }), { status: 200 });
    }
    assert.doesNotMatch(value, /name|owners|emailAddress|permissions|description/i);
    if (value.includes('mimeType%20%3D')) return new Response(JSON.stringify({ files: [
      { id: 'raw-sheet-id', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: observedAt.toISOString(), version: '8' },
    ] }), { status: 200 });
    if (value.includes('/spreadsheets/')) return new Response(JSON.stringify({ spreadsheetId: 'raw-sheet-id', sheets: [] }), { status: 200 });
    return new Response(JSON.stringify({ files: [
      { id: 'raw-drive-id', mimeType: 'application/pdf', modifiedTime: observedAt.toISOString(), version: '4' },
    ] }), { status: 200 });
  };
  try {
    const results = await probeExternalSources({ googleServiceAccountJson: serviceAccount(), externalIdentitySecret: identitySecret,
      googleContactsExportPath: '/definitely/missing/google-contacts.json',
      chatgptWorkExportPath: '/definitely/missing/chatgpt-work.json', now: () => observedAt });
    const drive = results.find((entry) => entry.sourceId === 'GOOGLE_DRIVE');
    const sheets = results.find((entry) => entry.sourceId === 'GOOGLE_SHEETS');
    const contacts = results.find((entry) => entry.sourceId === 'GOOGLE_CONTACTS');
    assert.equal(drive.status, 'HEALTHY');
    assert.equal(sheets.status, 'HEALTHY');
    assert.equal(contacts.status, 'UNAVAILABLE');
    assert.match(contacts.detail, /ENOENT/);
    const durable = JSON.stringify([drive.itemBatch, sheets.itemBatch]);
    assert.doesNotMatch(durable, /raw-drive-id|raw-sheet-id|runtime-reader@example|ephemeral-test-token/);
    assert.match(drive.itemBatch.items[0].itemKey, /^[a-f0-9]{64}$/);
    assert.equal(drive.itemBatch.authorityMode, 'GOOGLE_SERVICE_ACCOUNT_READONLY');
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test('Google Contacts acepta un export OAuth 0600 sin persistir datos personales', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'company-os-contacts-export-'));
  const exportPath = join(directory, 'google-contacts.json');
  const document = { schemaVersion: 1, canonicalSource: 'codex_app', principalRef: 'google-contacts-bridge-v1',
    exportedAt: observedAt.toISOString(), queryCursor: 'a', complete: false,
    items: [{ contactId: 'people/c1234567890', status: 'PENDING_REVIEW' },
      { contactId: 'otherContacts/c0987654321', status: 'PENDING_REVIEW' }] };
  writeFileSync(exportPath, JSON.stringify(document), { mode: 0o600 });
  chmodSync(exportPath, 0o600);
  const results = await probeExternalSources({ externalIdentitySecret: identitySecret, googleContactsExportPath: exportPath,
    chatgptWorkExportPath: '/definitely/missing/chatgpt-work.json', now: () => observedAt });
  const contacts = results.find((entry) => entry.sourceId === 'GOOGLE_CONTACTS');
  assert.equal(contacts.status, 'HEALTHY');
  assert.equal(contacts.itemBatch.authorityMode, 'GOOGLE_USER_OAUTH_READONLY');
  assert.equal(contacts.itemBatch.complete, false);
  assert.equal(contacts.itemBatch.items.length, 2);
  assert.doesNotMatch(JSON.stringify(contacts.itemBatch), /people\/c|otherContacts\/c|google-contacts-bridge/);

  writeFileSync(exportPath, JSON.stringify({ ...document, items: [{ ...document.items[0], email: 'private@example.invalid' }] }));
  chmodSync(exportPath, 0o600);
  const rejected = await probeExternalSources({ externalIdentitySecret: identitySecret, googleContactsExportPath: exportPath,
    chatgptWorkExportPath: '/definitely/missing/chatgpt-work.json', now: () => observedAt });
  assert.equal(rejected.find((entry) => entry.sourceId === 'GOOGLE_CONTACTS').status, 'UNAVAILABLE');
});

test('ChatGPT Work acepta sólo exportación canónica 0600 allowlisted y nunca el índice local', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'company-os-chatgpt-export-'));
  const exportPath = join(directory, 'chatgpt-work.json');
  const document = { schemaVersion: 1, canonicalSource: 'codex_app', principalRef: 'workspace-authorized',
    exportedAt: observedAt.toISOString(), items: [{ threadId: '6a9c54e5-c7a8-83ea-80b1-8aa95bb50ebf',
      projectId: 'g-p-allowed-project', updatedAt: observedAt.toISOString(), status: 'PENDING_REVIEW' }] };
  writeFileSync(exportPath, JSON.stringify(document), { mode: 0o600 });
  chmodSync(exportPath, 0o600);
  const results = await probeExternalSources({ externalIdentitySecret: identitySecret, chatgptWorkExportPath: exportPath,
    chatgptWorkProjectIds: ['g-p-allowed-project'], now: () => observedAt });
  const chatgpt = results.find((entry) => entry.sourceId === 'CHATGPT_WORK');
  assert.equal(chatgpt.status, 'HEALTHY');
  assert.equal(chatgpt.itemBatch.authorityMode, 'AUTHORIZED_CHATGPT_WORK_EXPORT_V1');
  assert.doesNotMatch(JSON.stringify(chatgpt.itemBatch), /6a9c54e5|g-p-allowed-project|workspace-authorized/);

  writeFileSync(exportPath, JSON.stringify({ ...document, items: [{ ...document.items[0], body: 'contenido privado' }] }));
  chmodSync(exportPath, 0o600);
  const rejected = await probeExternalSources({ externalIdentitySecret: identitySecret, chatgptWorkExportPath: exportPath,
    chatgptWorkProjectIds: ['g-p-allowed-project'], now: () => observedAt });
  assert.equal(rejected.find((entry) => entry.sourceId === 'CHATGPT_WORK').status, 'UNAVAILABLE');
});
