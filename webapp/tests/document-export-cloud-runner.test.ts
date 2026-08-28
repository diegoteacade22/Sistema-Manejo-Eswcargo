import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const workflowPath = path.resolve(process.cwd(), '..', '.github', 'workflows', 'export-operational-documents-cloud.yml');
const exporterPath = path.resolve(process.cwd(), 'scripts', 'export-operational-documents.ts');
const buildersPath = path.resolve(process.cwd(), 'app', 'email-actions.ts');

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

test('el runner aplica el gate de bootstrap antes de consultar o persistir un export completo', async () => {
    const exporter = await readFile(exporterPath, 'utf8');
    const loadState = exporter.indexOf('const previous = await target.loadState()');
    const pilotReadback = exporter.indexOf('await target.verifyPilot(previous.pilotCompleted)');
    const bootstrap = exporter.indexOf('assertDriveBootstrapReady({');
    const query = exporter.indexOf('const orders = await prisma.order.findMany({');
    const persist = exporter.indexOf('if (shouldPersistState) await target.saveState(next)');
    assert.ok(loadState >= 0);
    assert.ok(pilotReadback > loadState);
    assert.doesNotMatch(exporter, /hasVerifiedPilot:\s*Boolean\(previous\?\.pilotCompleted\)/);
    assert.ok(bootstrap > loadState);
    assert.ok(bootstrap > pilotReadback);
    assert.ok(query > bootstrap);
    assert.ok(persist > query);
    assert.match(exporter, /payloadSha256:\s*destination\.sha256/);
    assert.match(exporter, /contentFingerprint:\s*options\.contentFingerprint/);
    assert.match(exporter, /contentFingerprint:\s*document\.contentFingerprint/);
    assert.match(exporter, /next\.orders\[key\] = document\.contentFingerprint/);
    assert.match(exporter, /next\.pilotCompleted = observedPilot/);
    assert.doesNotMatch(exporter, /&&\s*!next\.pilotCompleted/);
});

test('invoice carga weight_cli y usa el contrato de render en huella y HTML', async () => {
    const exporter = await readFile(exporterPath, 'utf8');
    const builders = await readFile(buildersPath, 'utf8');
    assert.match(exporter, /shipment:\s*\{\s*select:\s*\{\s*weight_cli:\s*true/);
    assert.match(exporter, /invoiceDocumentContentFingerprint\(order\)/);
    assert.match(exporter, /packingListDocumentContentFingerprint\(\{[\s\S]*?segmentCount: segments\.length,[\s\S]*?clientCharge/);
    assert.match(exporter, /shipmentChargeKey = shipment\.shipment_number \|\| shipment\.id/);
    assert.doesNotMatch(exporter, /date_arrived:\s*true|updatedAt:\s*true/);
    assert.match(builders, /INVOICE_DOCUMENT_RENDER_VERSION/);
    assert.match(builders, /PACKING_LIST_DOCUMENT_RENDER_VERSION/);
    assert.match(builders, /const contentFingerprint = invoiceDocumentContentFingerprint\(order\)/);
    assert.match(builders, /fileName,\s*contentFingerprint/);
    assert.match(builders, /where:\s*\{ id: orderId \}[\s\S]*?items:\s*\{\s*orderBy:\s*\{ id: 'asc' \}/);
    assert.match(builders, /shipment\.date_shipped \|\| shipment\.createdAt/);
    assert.doesNotMatch(builders, /new Date\(\)\.toLocaleDateString\(\)/);
});
