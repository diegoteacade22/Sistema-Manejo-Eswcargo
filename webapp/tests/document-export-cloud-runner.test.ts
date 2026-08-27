import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const workflowPath = path.resolve(process.cwd(), '..', '.github', 'workflows', 'export-operational-documents-cloud.yml');

function jobLevelEnvBlocks(workflow: string) {
    const lines = workflow.split('\n');
    const blocks: string[] = [];
    for (let index = 0; index < lines.length; index += 1) {
        if (!/^ {4}env:\s*$/.test(lines[index])) continue;
        const block: string[] = [];
        for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
            const line = lines[cursor];
            if (line.trim() && (line.match(/^ */)?.[0].length ?? 0) <= 4) break;
            block.push(line);
        }
        blocks.push(block.join('\n'));
    }
    return blocks;
}

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

test('job env no usa runner context y las rutas nacen desde RUNNER_TEMP', async () => {
    const workflow = await readFile(workflowPath, 'utf8');
    const jobEnv = jobLevelEnvBlocks(workflow);
    assert.equal(jobEnv.length, 1);
    assert.doesNotMatch(jobEnv[0], /\$\{\{\s*runner\./);
    assert.match(workflow, /ESW_DOCUMENT_EXPORT_RUNTIME_DIR=\$RUNNER_TEMP\/eswcargo-document-export/);
    assert.match(workflow, /GOOGLE_CREDENTIALS_FILE=\$RUNNER_TEMP\/google_credentials\.json/);
    assert.match(workflow, />> "\$GITHUB_ENV"/);
});

test('export-one conserva cualquier salida parcial como error', async () => {
    const workflow = await readFile(workflowPath, 'utf8');
    assert.match(workflow, /\[ "\$status" -eq 2 \] && \[ "\$MODE" = "export" \]/);
    assert.doesNotMatch(workflow, /if \[ "\$status" -eq 2 \]; then/);
});
