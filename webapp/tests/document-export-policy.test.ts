import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DOCUMENT_EXPORT_LOOKBACK_DAYS,
    isWithinDocumentExportWindow,
    shouldAdvanceShipmentBaseFingerprint,
    shouldExportOperationalDocument,
} from '../lib/document-export-policy';

const now = new Date('2026-08-05T14:00:00.000Z');

test('acepta documentos operativos modificados dentro de los ultimos 10 dias', () => {
    assert.equal(DOCUMENT_EXPORT_LOOKBACK_DAYS, 10);
    assert.equal(isWithinDocumentExportWindow('2026-07-30T14:00:00.000Z', now), true);
    assert.equal(shouldExportOperationalDocument({
        currentFingerprint: 'nuevo',
        previousFingerprint: 'anterior',
        hasPreviousState: true,
        isWithinLookback: true,
        isRequestedDate: false,
        force: false,
    }), true);
});

test('bloquea documentos viejos aunque su huella haya cambiado', () => {
    assert.equal(isWithinDocumentExportWindow('2026-06-01T14:00:00.000Z', now), false);
    assert.equal(shouldExportOperationalDocument({
        currentFingerprint: 'nuevo',
        previousFingerprint: 'anterior',
        hasPreviousState: true,
        isWithinLookback: false,
        isRequestedDate: false,
        force: false,
    }), false);
});

test('force sin fecha tampoco atraviesa el limite historico', () => {
    assert.equal(shouldExportOperationalDocument({
        currentFingerprint: 'nuevo',
        previousFingerprint: 'anterior',
        hasPreviousState: true,
        isWithinLookback: false,
        isRequestedDate: false,
        force: true,
    }), false);
});

test('force reevalúa un documento reciente pero conserva la misma huella lógica', () => {
    assert.equal(shouldExportOperationalDocument({
        currentFingerprint: 'igual',
        previousFingerprint: 'igual',
        hasPreviousState: true,
        isWithinLookback: true,
        isRequestedDate: false,
        force: true,
    }), true);
});

test('una fecha solicitada manualmente permite regenerar un documento puntual', () => {
    assert.equal(shouldExportOperationalDocument({
        currentFingerprint: 'igual',
        previousFingerprint: 'igual',
        hasPreviousState: true,
        isWithinLookback: false,
        isRequestedDate: true,
        force: true,
    }), true);
});

test('un segmento fallido no avanza el fingerprint base y obliga a reintentar', () => {
    assert.equal(shouldAdvanceShipmentBaseFingerprint(0), true);
    assert.equal(shouldAdvanceShipmentBaseFingerprint(1), false);
    assert.equal(shouldAdvanceShipmentBaseFingerprint(2), false);

    const previous = { shipment: 'base-anterior' };
    const next = { ...previous, successfulSegment: 'segmento-nuevo' };
    if (shouldAdvanceShipmentBaseFingerprint(1)) next.shipment = 'base-nueva';

    assert.equal(next.shipment, 'base-anterior');
    assert.equal(next.successfulSegment, 'segmento-nuevo');
    assert.equal(shouldExportOperationalDocument({
        currentFingerprint: 'base-nueva',
        previousFingerprint: next.shipment,
        hasPreviousState: true,
        isWithinLookback: true,
        isRequestedDate: false,
        force: false,
    }), true);
});
