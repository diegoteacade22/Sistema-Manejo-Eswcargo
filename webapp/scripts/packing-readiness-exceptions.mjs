import fs from 'node:fs';
import path from 'node:path';

const normalizeStatus = (value) => String(value || '').trim().toUpperCase();

export function buildSourcePackingFingerprints(records) {
  const fingerprintsByShipment = new Map();

  for (const record of records) {
    if (!Number.isInteger(record?.shipment_number)) continue;
    const fingerprint = fingerprintsByShipment.get(record.shipment_number) || {
      statuses: new Set(),
      recordCount: 0,
    };
    fingerprint.statuses.add(normalizeStatus(record.status));
    fingerprint.recordCount += 1;
    fingerprintsByShipment.set(record.shipment_number, fingerprint);
  }

  return new Map(
    [...fingerprintsByShipment].map(([shipmentNumber, fingerprint]) => [
      shipmentNumber,
      {
        statuses: [...fingerprint.statuses].sort(),
        recordCount: fingerprint.recordCount,
      },
    ])
  );
}

export function buildSourceStatuses(records) {
  return new Map(
    [...buildSourcePackingFingerprints(records)].map(([shipmentNumber, fingerprint]) => [
      shipmentNumber,
      fingerprint.statuses,
    ])
  );
}

export function loadKnownEmptyPackingExceptions(prismaDir) {
  const exceptionPath = path.join(prismaDir, 'packing-readiness-exceptions.json');
  if (!fs.existsSync(exceptionPath)) return new Map();

  const payload = JSON.parse(fs.readFileSync(exceptionPath, 'utf8'));
  const exceptions = new Map();

  for (const entry of payload.knownEmptyOperationalShipments || []) {
    const shipmentNumbers = Number.isInteger(entry?.shipment_number)
      ? [entry.shipment_number]
      : entry?.shipment_numbers;
    if (!Array.isArray(shipmentNumbers)) continue;

    for (const shipmentNumber of shipmentNumbers) {
      if (!Number.isInteger(shipmentNumber)) continue;
      exceptions.set(shipmentNumber, {
        reason: entry.reason || 'Sin detalle',
        expected: entry.expected || null,
      });
    }
  }

  return exceptions;
}

export function matchesKnownEmptyPackingException(shipment, exception, sourceObservation = []) {
  if (!exception) return false;
  if (!exception.expected) return true;

  const expected = exception.expected;
  if (expected.database_status && normalizeStatus(shipment.status) !== normalizeStatus(expected.database_status)) {
    return false;
  }
  if (Number.isInteger(expected.item_count) && shipment.item_count !== expected.item_count) {
    return false;
  }
  const sourceStatuses = Array.isArray(sourceObservation)
    ? sourceObservation
    : sourceObservation?.statuses || [];
  if (Array.isArray(expected.source_statuses)) {
    const actualStatuses = [...sourceStatuses].map(normalizeStatus).sort();
    const expectedStatuses = expected.source_statuses.map(normalizeStatus).sort();
    if (JSON.stringify(actualStatuses) !== JSON.stringify(expectedStatuses)) return false;
  }
  if (
    Number.isInteger(expected.source_record_count)
    && (!sourceObservation || Array.isArray(sourceObservation) || sourceObservation.recordCount !== expected.source_record_count)
  ) {
    return false;
  }

  return true;
}
