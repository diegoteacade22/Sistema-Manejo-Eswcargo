import assert from 'node:assert/strict';
import test from 'node:test';
import {
    assertDriveBootstrapReady,
    assertSelectedOrderObserved,
    assertSelectedShipmentObserved,
    sanitizeDocumentExportFatalError,
    selectedOrderExitCode,
    shouldPersistDocumentExportState,
} from '../lib/document-export-run-contract';

test('export completo Drive falla cerrado hasta que exista un manifiesto piloto', () => {
    assert.throws(
        () => assertDriveBootstrapReady({
            targetName: 'drive',
            hasPreviousState: false,
            dryRun: false,
            selectedOrderId: null,
            selectedShipmentId: null,
        }),
        /ejecutá y verificá export-one/,
    );
    assert.doesNotThrow(() => assertDriveBootstrapReady({
        targetName: 'drive',
        hasPreviousState: false,
        dryRun: false,
        selectedOrderId: 42,
        selectedShipmentId: null,
    }));
    assert.doesNotThrow(() => assertDriveBootstrapReady({
        targetName: 'drive',
        hasPreviousState: false,
        dryRun: true,
        selectedOrderId: null,
        selectedShipmentId: null,
    }));
    assert.doesNotThrow(() => assertDriveBootstrapReady({
        targetName: 'drive',
        hasPreviousState: true,
        dryRun: false,
        selectedOrderId: null,
        selectedShipmentId: null,
    }));
    assert.doesNotThrow(() => assertDriveBootstrapReady({
        targetName: 'filesystem',
        hasPreviousState: false,
        dryRun: false,
        selectedOrderId: null,
        selectedShipmentId: null,
    }));
});

test('export-one inexistente falla en lugar de cerrar con cero exportados', () => {
    assert.throws(
        () => assertSelectedOrderObserved(999999, 0),
        /exactamente una orden/,
    );
    assert.doesNotThrow(() => assertSelectedOrderObserved(null, 0));
    assert.doesNotThrow(() => assertSelectedOrderObserved(42, 1));
});

test('piloto shipment inexistente o fallido nunca crea un manifiesto vacío', () => {
    assert.throws(
        () => assertSelectedShipmentObserved(999999, 0),
        /exactamente un envío/,
    );
    assert.doesNotThrow(() => assertSelectedShipmentObserved(42, 1));
    const failureExit = selectedOrderExitCode({
        selectedOrderId: null,
        selectedShipmentId: 42,
        dryRun: false,
        exported: 0,
        failureCount: 1,
    });
    assert.equal(failureExit, 2);
    assert.equal(shouldPersistDocumentExportState({
        dryRun: false,
        selectedOrderId: null,
        selectedShipmentId: 42,
        exitCode: failureExit,
    }), false);

    const successExit = selectedOrderExitCode({
        selectedOrderId: null,
        selectedShipmentId: 42,
        dryRun: false,
        exported: 2,
        failureCount: 0,
    });
    assert.equal(successExit, 0);
    assert.equal(shouldPersistDocumentExportState({
        dryRun: false,
        selectedOrderId: null,
        selectedShipmentId: 42,
        exitCode: successExit,
    }), true);
});

test('full conserva estado parcial para reintentos y dry-run nunca persiste', () => {
    assert.equal(shouldPersistDocumentExportState({
        dryRun: false,
        selectedOrderId: null,
        selectedShipmentId: null,
        exitCode: 2,
    }), true);
    assert.equal(shouldPersistDocumentExportState({
        dryRun: true,
        selectedOrderId: null,
        selectedShipmentId: null,
        exitCode: 0,
    }), false);
});

test('export-one exige exactamente un export y cero fallas', () => {
    assert.equal(selectedOrderExitCode({
        selectedOrderId: 42,
        dryRun: false,
        exported: 1,
        failureCount: 0,
    }), 0);
    assert.equal(selectedOrderExitCode({
        selectedOrderId: 42,
        dryRun: false,
        exported: 0,
        failureCount: 1,
    }), 1);
    assert.equal(selectedOrderExitCode({
        selectedOrderId: 42,
        dryRun: false,
        exported: 2,
        failureCount: 0,
    }), 1);
    assert.equal(selectedOrderExitCode({
        selectedOrderId: null,
        dryRun: false,
        exported: 3,
        failureCount: 1,
    }), 2);
});

test('fatal sólo devuelve texto saneado', () => {
    const privateKeyFixture = [
        '-----BEGIN ',
        'PRIVATE KEY-----\nfixture\n',
        '-----END ',
        'PRIVATE KEY-----',
    ].join('');
    const databaseFixture = ['postgresql', '://', 'user', ':', 'credential-fixture', '@', 'host/db'].join('');
    const bearerFixture = ['Bearer', ' ', 'token-fixture'].join('');
    const sanitized = sanitizeDocumentExportFatalError(
        `${databaseFixture} ${bearerFixture} ${privateKeyFixture}`,
    );
    assert.doesNotMatch(sanitized, /credential-fixture|token-fixture|BEGIN PRIVATE KEY/);
    assert.match(sanitized, /postgresql:\/\/\[REDACTED\]/);
    assert.match(sanitized, /Bearer \[REDACTED\]/);
    assert.match(sanitized, /\[REDACTED_KEY\]/);
});
