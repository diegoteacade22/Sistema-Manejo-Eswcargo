import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import type {
    DocumentExportState,
    DrivePutOptions,
    DrivePutResult,
} from '../lib/document-cloud-drive';
import { GoogleDriveDocumentStore } from '../lib/document-cloud-drive';
import {
    assertDriveBootstrapReady,
    assertSelectedOrderObserved,
    assertSelectedShipmentObserved,
    sanitizeDocumentExportFatalError,
    selectedOrderExitCode,
    shouldPersistDocumentExportState,
} from '../lib/document-export-run-contract';
import {
    DOCUMENT_EXPORT_LOOKBACK_DAYS,
    isWithinDocumentExportWindow,
    shouldAdvanceShipmentBaseFingerprint,
    shouldExportOperationalDocument,
} from '../lib/document-export-policy';
import { getShipmentClientCharge } from '../lib/shipment-client-charge';
import { getPackingSegments } from '../lib/packing-segments';
import {
    invoiceDocumentContentFingerprint,
    packingListDocumentContentFingerprint,
} from '../lib/document-export-fingerprint';

dotenv.config({
    path: [
        path.resolve(process.cwd(), '.env.local'),
        path.resolve(process.cwd(), '.env'),
    ],
});

const args = new Set(process.argv.slice(2));
const dateArg = process.argv.find((value) => value.startsWith('--date='))?.slice('--date='.length);
const orderIdArg = process.argv.find((value) => value.startsWith('--order-id='))?.slice('--order-id='.length);
const shipmentIdArg = process.argv.find((value) => value.startsWith('--shipment-id='))?.slice('--shipment-id='.length);
const targetArg = process.argv.find((value) => value.startsWith('--target='))?.slice('--target='.length);
const summaryPathArg = process.argv.find((value) => value.startsWith('--summary-path='))?.slice('--summary-path='.length);
const force = args.has('--force');
const dryRun = args.has('--dry-run');
const driveProbe = args.has('--drive-probe');
const targetName = targetArg || process.env.ESW_DOCUMENT_EXPORT_TARGET || 'filesystem';
const selectedOrderId = orderIdArg ? Number(orderIdArg) : null;
const selectedShipmentId = shipmentIdArg ? Number(shipmentIdArg) : null;
const exportDir = process.env.ESW_DOWNLOADS_DOCUMENT_DIR
    || path.join(os.homedir(), 'Downloads', 'Documentos');
const runtimeDir = process.env.ESW_DOCUMENT_EXPORT_RUNTIME_DIR
    || path.join(os.homedir(), '.eswcargo', 'document-export');
const statePath = path.join(runtimeDir, 'state.json');
const logPath = path.join(runtimeDir, 'events.jsonl');
let prisma: (typeof import('../lib/prisma'))['prisma'] | undefined;

function validateArguments() {
    if (selectedOrderId !== null && (!Number.isInteger(selectedOrderId) || selectedOrderId <= 0)) {
        throw new Error('--order-id debe ser un entero positivo.');
    }
    if (selectedShipmentId !== null && (!Number.isInteger(selectedShipmentId) || selectedShipmentId <= 0)) {
        throw new Error('--shipment-id debe ser un entero positivo.');
    }
    if (selectedOrderId !== null && selectedShipmentId !== null) {
        throw new Error('Usá sólo uno entre --order-id y --shipment-id.');
    }
}

type ExportTarget = {
    name: 'filesystem' | 'drive';
    loadState(): Promise<DocumentExportState | null>;
    saveDocument(fileName: string, contents: Uint8Array, options: DrivePutOptions): Promise<DrivePutResult | { action: 'UPDATED'; destination: string }>;
    saveState(state: DocumentExportState): Promise<unknown>;
    probe?(): Promise<unknown>;
};

function utcDateKey(value: Date | string | null | undefined) {
    if (!value) return null;
    return new Date(value).toISOString().slice(0, 10);
}

function cloudFailureReason(message: string) {
    if (/subtotal/i.test(message)) return 'MISSING_CONFIRMED_SUBTOTAL';
    if (/clientes o artículos confirmados/i.test(message)) return 'MISSING_CONFIRMED_ITEMS';
    if (/bloque|inconsisten|fuente/i.test(message)) return 'SOURCE_DOCUMENT_BLOCKED';
    return 'DOCUMENT_BUILD_FAILED';
}

async function loadLocalState(): Promise<DocumentExportState | null> {
    try {
        return JSON.parse(await readFile(statePath, 'utf8')) as DocumentExportState;
    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
        throw error;
    }
}

async function atomicWrite(fileName: string, contents: Uint8Array) {
    await mkdir(exportDir, { recursive: true });
    const destination = path.join(exportDir, fileName);
    const temporary = path.join(exportDir, `.${fileName}.${process.pid}.tmp`);
    await writeFile(temporary, contents);
    await rename(temporary, destination);
    return destination;
}

async function saveLocalState(state: DocumentExportState) {
    await mkdir(runtimeDir, { recursive: true });
    const temporaryState = `${statePath}.${process.pid}.tmp`;
    await writeFile(temporaryState, JSON.stringify(state, null, 2));
    await rename(temporaryState, statePath);
}

async function createExportTarget(): Promise<ExportTarget> {
    if (targetName === 'filesystem') {
        return {
            name: 'filesystem',
            loadState: loadLocalState,
            async saveDocument(fileName, contents) {
                return { action: 'UPDATED', destination: await atomicWrite(fileName, contents) };
            },
            saveState: saveLocalState,
        };
    }
    if (targetName !== 'drive') {
        throw new Error(`Target documental no soportado: ${targetName}.`);
    }
    const store = await GoogleDriveDocumentStore.fromEnvironment();
    return {
        name: 'drive',
        loadState: () => store.loadState(),
        saveDocument: (fileName, contents, options) => store.put(fileName, contents, 'application/pdf', options),
        saveState: (state) => store.saveState(state),
        probe: () => store.probe(),
    };
}

async function writeSummary(summary: Record<string, unknown>) {
    if (!summaryPathArg) return;
    await mkdir(path.dirname(summaryPathArg), { recursive: true });
    await writeFile(summaryPathArg, `${JSON.stringify(summary, null, 2)}\n`);
}

async function logEvent(event: Record<string, unknown>) {
    await mkdir(runtimeDir, { recursive: true });
    await appendFile(logPath, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
}

async function main() {
    validateArguments();
    const target = await createExportTarget();
    if (driveProbe) {
        if (!target.probe) throw new Error('El probe Drive requiere --target=drive.');
        const probe = await target.probe();
        const summary = { status: 'PROBED', target: target.name, probe };
        await writeSummary(summary);
        console.log(JSON.stringify(summary, null, 2));
        return;
    }

    const prismaModule = await import('../lib/prisma');
    const documentBuilders = await import('../app/email-actions');
    prisma = prismaModule.prisma;
    const { buildInvoiceDocument, buildPackingListDocument } = documentBuilders;

    await mkdir(runtimeDir, { recursive: true });
    const previous = await target.loadState();
    assertDriveBootstrapReady({
        targetName: target.name,
        hasPreviousState: Boolean(previous),
        dryRun,
        selectedOrderId,
        selectedShipmentId,
    });
    const next: DocumentExportState = {
        version: 1,
        orders: { ...(previous?.orders || {}) },
        shipments: { ...(previous?.shipments || {}) },
        updatedAt: new Date().toISOString(),
    };

    const orders = await prisma.order.findMany({
        where: selectedShipmentId !== null
            ? { id: -1 }
            : selectedOrderId !== null ? { id: selectedOrderId } : undefined,
        orderBy: { id: 'asc' },
        select: {
            id: true,
            order_number: true,
            date: true,
            total_amount: true,
            client: { select: { id: true, old_id: true, name: true, address: true, city: true, country: true } },
            shipment: { select: { weight_cli: true } },
            items: {
                orderBy: { id: 'asc' },
                select: {
                    id: true,
                    productName: true,
                    quantity: true,
                    unit_price: true,
                    status: true,
                    product: { select: { color_grade: true } },
                },
            },
        },
    });
    const shipments = await prisma.shipment.findMany({
        where: selectedOrderId !== null
            ? { id: -1 }
            : selectedShipmentId !== null ? { id: selectedShipmentId } : undefined,
        orderBy: { id: 'asc' },
        select: {
            id: true,
            shipment_number: true,
            date_shipped: true,
            date_arrived: true,
            createdAt: true,
            updatedAt: true,
            item_count: true,
            price_total: true,
            cargo_description: true,
            client: { select: { id: true, old_id: true, name: true } },
            items: {
                orderBy: { id: 'asc' },
                select: {
                    id: true,
                    quantity: true,
                    productName: true,
                    product: { select: { color_grade: true } },
                    order: {
                        select: {
                            id: true,
                            order_number: true,
                            clientId: true,
                            client: { select: { id: true, old_id: true, name: true } },
                        },
                    },
                },
            },
            orders: {
                orderBy: { id: 'asc' },
                select: {
                    id: true,
                    order_number: true,
                    clientId: true,
                    client: { select: { id: true, old_id: true, name: true } },
                    items: {
                        orderBy: { id: 'asc' },
                        select: {
                            id: true,
                            quantity: true,
                            productName: true,
                            shipmentId: true,
                            product: { select: { color_grade: true } },
                        },
                    },
                },
            },
        },
    });
    assertSelectedOrderObserved(selectedOrderId, orders.length);
    assertSelectedShipmentObserved(selectedShipmentId, shipments.length);

    let exported = 0;
    let planned = 0;
    let ignoredOutsideLookback = 0;
    const writes = { created: 0, updated: 0, unchanged: 0 };
    const artifactReadbacks: Array<{ action: string; kind: string; size?: number; idSuffix?: string; sha256Prefix?: string }> = [];
    const failures: Array<{ type: string; number: number; message: string }> = [];

    for (const order of orders) {
        const key = String(order.id);
        const currentFingerprint = invoiceDocumentContentFingerprint(order);
        const isRequestedDate = Boolean(
            selectedOrderId === order.id
            || (dateArg && utcDateKey(order.date) === dateArg),
        );
        const isWithinLookback = isWithinDocumentExportWindow(order.date);
        const shouldExport = shouldExportOperationalDocument({
            currentFingerprint,
            previousFingerprint: previous?.orders[key],
            hasPreviousState: Boolean(previous),
            isWithinLookback,
            isRequestedDate,
            force,
        });
        if (!shouldExport) {
            if (!isWithinLookback && !isRequestedDate && previous?.orders[key] !== currentFingerprint) {
                ignoredOutsideLookback += 1;
            }
            next.orders[key] = currentFingerprint;
            continue;
        }
        planned += 1;
        if (dryRun) continue;

        try {
            const document = await buildInvoiceDocument(order.id);
            const destination = await target.saveDocument(document.fileName, document.pdfBuffer, {
                kind: 'INVOICE',
                identity: `order:${order.id}`,
                contentFingerprint: currentFingerprint,
            });
            next.orders[key] = currentFingerprint;
            exported += 1;
            writes[destination.action.toLowerCase() as keyof typeof writes] += 1;
            artifactReadbacks.push({
                action: destination.action,
                kind: 'INVOICE',
                ...('size' in destination ? {
                    size: destination.size,
                    idSuffix: destination.idSuffix,
                    sha256Prefix: destination.sha256.slice(0, 12),
                } : {}),
            });
            await logEvent(target.name === 'drive'
                ? { type: 'INVOICE', destination: artifactReadbacks.at(-1) }
                : { type: 'INVOICE', id: order.id, number: order.order_number, fileName: document.fileName, destination });
        } catch (error: unknown) {
            failures.push({ type: 'INVOICE', number: Number(order.order_number ?? order.id), message: error instanceof Error ? error.message : String(error) });
        }
    }

    for (const shipment of shipments) {
        const key = String(shipment.id);
        const currentFingerprint = packingListDocumentContentFingerprint({
            shipment,
            segment: null,
            clientCharge: null,
        });
        const operationalDate = shipment.date_shipped || shipment.createdAt;
        const isRequestedDate = Boolean(
            selectedShipmentId === shipment.id
            || (dateArg && utcDateKey(operationalDate) === dateArg),
        );
        const isWithinLookback = isWithinDocumentExportWindow(operationalDate);
        if (!isWithinLookback && !isRequestedDate) {
            if (previous?.shipments[key] !== currentFingerprint) {
                ignoredOutsideLookback += 1;
            }
            next.shipments[key] = currentFingerprint;
            continue;
        }

        const segments = getPackingSegments(shipment);
        if (segments.length === 0) {
            failures.push({
                type: 'PACKING_LIST',
                number: Number(shipment.shipment_number ?? shipment.id),
                message: 'El envío no tiene clientes o artículos confirmados.',
            });
            continue;
        }

        let segmentFailures = 0;

        for (const segment of segments) {
            const segmentKey = `${key}:${segment.clientId}`;
            const clientCharge = segments.length > 1 && shipment.shipment_number
                ? await getShipmentClientCharge(shipment.shipment_number, segment.clientId)
                : null;
            const segmentFingerprint = packingListDocumentContentFingerprint({ shipment, segment, clientCharge });
            const previousSegmentFingerprint = previous?.shipments[segmentKey];
            const comparisonFingerprint = previousSegmentFingerprint === undefined
                ? currentFingerprint
                : segmentFingerprint;
            const previousComparisonFingerprint = previousSegmentFingerprint === undefined
                ? previous?.shipments[key]
                : previousSegmentFingerprint;
            const shouldExportSegment = shouldExportOperationalDocument({
                currentFingerprint: comparisonFingerprint,
                previousFingerprint: previousComparisonFingerprint,
                hasPreviousState: Boolean(previous),
                isWithinLookback,
                isRequestedDate,
                force,
            });

            if (!shouldExportSegment) {
                next.shipments[segmentKey] = segmentFingerprint;
                continue;
            }
            planned += 1;
            if (dryRun) continue;

            try {
                const document = await buildPackingListDocument(shipment.id, segment.clientId);
                const destination = await target.saveDocument(document.fileName, document.pdfBuffer, {
                    kind: 'PACKING_LIST',
                    identity: `shipment:${shipment.id}:client:${segment.clientId}`,
                    contentFingerprint: segmentFingerprint,
                });
                next.shipments[segmentKey] = segmentFingerprint;
                exported += 1;
                writes[destination.action.toLowerCase() as keyof typeof writes] += 1;
                artifactReadbacks.push({
                    action: destination.action,
                    kind: 'PACKING_LIST',
                    ...('size' in destination ? {
                        size: destination.size,
                        idSuffix: destination.idSuffix,
                        sha256Prefix: destination.sha256.slice(0, 12),
                    } : {}),
                });
                await logEvent(target.name === 'drive'
                    ? { type: 'PACKING_LIST', destination: artifactReadbacks.at(-1) }
                    : { type: 'PACKING_LIST', id: shipment.id, number: shipment.shipment_number, clientId: segment.clientId, fileName: document.fileName, destination });
            } catch (error: unknown) {
                segmentFailures += 1;
                failures.push({ type: 'PACKING_LIST', number: Number(shipment.shipment_number ?? shipment.id), message: error instanceof Error ? error.message : String(error) });
            }
        }

        if (shouldAdvanceShipmentBaseFingerprint(segmentFailures)) {
            next.shipments[key] = currentFingerprint;
        }
    }

    const exitCode = selectedOrderExitCode({
        selectedOrderId,
        selectedShipmentId,
        dryRun,
        exported,
        failureCount: failures.length,
    });
    const shouldPersistState = shouldPersistDocumentExportState({
        dryRun,
        selectedOrderId,
        selectedShipmentId,
        exitCode,
    });
    if (shouldPersistState) await target.saveState(next);
    const summaryFailures = target.name === 'drive'
        ? Object.entries(failures.reduce<Record<string, number>>((counts, { message }) => {
            const reason = cloudFailureReason(message);
            counts[reason] = (counts[reason] || 0) + 1;
            return counts;
        }, {})).map(([reasonCode, count]) => ({ reasonCode, count }))
        : failures;
    const summary = {
        status: dryRun
            ? 'DRY_RUN'
            : (selectedOrderId !== null || selectedShipmentId !== null) && exitCode !== 0
                ? 'FAILED_SELECTION'
                : failures.length > 0 ? 'PARTIAL' : 'COMPLETED',
        target: target.name,
        selection: selectedOrderId !== null
            ? { type: 'ORDER', id: selectedOrderId }
            : selectedShipmentId !== null ? { type: 'SHIPMENT', id: selectedShipmentId } : null,
        planned,
        exported,
        writes,
        failures: summaryFailures,
        failureCount: failures.length,
        lookbackDays: DOCUMENT_EXPORT_LOOKBACK_DAYS,
        ignoredOutsideLookback,
        stateUpdatedAt: shouldPersistState ? next.updatedAt : null,
        artifactReadbacks,
    };
    if (!dryRun) await logEvent({ type: 'RUN', ...summary });
    await writeSummary(summary);
    console.log(JSON.stringify(summary, null, 2));
    if (exitCode !== 0) process.exitCode = exitCode;
}

main()
    .catch(async (error) => {
        const message = sanitizeDocumentExportFatalError(error instanceof Error ? error.message : String(error));
        const summary = { status: 'FAILED', target: targetName, message };
        await Promise.allSettled([
            logEvent({ type: 'FATAL', message }),
            writeSummary(summary),
        ]);
        console.error(JSON.stringify(summary));
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma?.$disconnect();
    });
