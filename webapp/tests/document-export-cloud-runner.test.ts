import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const workflowPath = path.resolve(process.cwd(), '..', '.github', 'workflows', 'export-operational-documents-cloud.yml');

test('la agenda cloud queda cerrada hasta el cutover explícito', async () => {
    const workflow = await readFile(workflowPath, 'utf8');
    assert.match(workflow, /cron: '\*\/30 \* \* \* \*'/);
    assert.match(workflow, /vars\.ESW_DOCUMENT_EXPORT_CLOUD_ENABLED == 'true'/);
    assert.match(workflow, /concurrency:\s+[\s\S]*group: eswcargo-document-export-cloud/);
    assert.match(workflow, /cancel-in-progress: false/);
});

test('probe, credenciales y readback son gates obligatorios', async () => {
    const workflow = await readFile(workflowPath, 'utf8');
    assert.match(workflow, /default: probe/);
    assert.match(workflow, /--drive-probe/);
    assert.match(workflow, /export-one/);
    assert.match(workflow, /--order-id=\$ORDER_ID/);
    assert.match(workflow, /ESW_DOCUMENT_EXPORT_DRIVE_FOLDER_ID/);
    assert.match(workflow, /GOOGLE_CREDENTIALS/);
    assert.match(workflow, /--summary-path/);
    assert.match(workflow, /actions\/upload-artifact@v4/);
});
