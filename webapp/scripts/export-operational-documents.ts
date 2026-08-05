import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import {
    DOCUMENT_EXPORT_LOOKBACK_DAYS,
    isWithinDocumentExportWindow,
    shouldExportOperationalDocument,
} from '../lib/document-export-policy';
import { getShipmentClientCharge } from '../lib/shipment-client-charge';
import { getPackingSegments } from '../lib/packing-segments';

dotenv.config({
    path: [
        path.resolve(process.cwd(), '.env.local'),
        path.resolve(process.cwd(), '.env'),
    ],
});

type ExportState = {
    version: 1;
    orders: Record<string, string>;
    shipments: Record<string, string>;
    updatedAt: string;
};

const args = new Set(process.argv.slice(2));
const dateArg = process.argv.find((value) => value.startsWith('--date='))?.slice('--date='.length);
const force = args.has('--force');
const exportDir = process.env.ESW_DOWNLOADS_DOCUMENT_DIR
    || path.join(os.homedir(), 'Downloads', 'Documentos');
const runtimeDir = process.env.ESW_DOCUMENT_EXPORT_RUNTIME_DIR
    || path.join(os.homedir(), '.eswcargo', 'document-export');
const statePath = path.join(runtimeDir, 'state.json');
const logPath = path.join(runtimeDir, 'events.jsonl');
let prisma: (typeof import('../lib/prisma'))['prisma'] | undefined;

function fingerprint(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function utcDateKey(value: Date | string | null | undefined) {
    if (!value) return null;
    return new Date(value).toISOString().slice(0, 10);
}

async function loadState(): Promise<ExportState | null> {
    try {
        return JSON.parse(await readFile(statePath, 'utf8')) as ExportState;
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

async function logEvent(event: Record<string, unknown>) {
    await mkdir(runtimeDir, { recursive: true });
    await appendFile(logPath, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
}

async function main() {
    const prismaModule = await import('../lib/prisma');
    const documentBuilders = await import('../app/email-actions');
    prisma = prismaModule.prisma;
    const { buildInvoiceDocument, buildPackingListDocument } = documentBuilders;

    await mkdir(runtimeDir, { recursive: true });
    const previous = await loadState();
    const next: ExportState = {
        version: 1,
        orders: { ...(previous?.orders || {}) },
        shipments: { ...(previous?.shipments || {}) },
        updatedAt: new Date().toISOString(),
    };

    const orders = await prisma.order.findMany({
        orderBy: { id: 'asc' },
        select: {
            id: true,
            order_number: true,
            date: true,
            total_amount: true,
            client: { select: { id: true, old_id: true, name: true, address: true, city: true, country: true } },
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

    let exported = 0;
    let ignoredOutsideLookback = 0;
    const failures: Array<{ type: string; number: number; message: string }> = [];

    for (const order of orders) {
        const key = String(order.id);
        const currentFingerprint = fingerprint(order);
        const isRequestedDate = Boolean(dateArg && utcDateKey(order.date) === dateArg);
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

        try {
            const document = await buildInvoiceDocument(order.id);
            const destination = await atomicWrite(document.fileName, document.pdfBuffer);
            next.orders[key] = currentFingerprint;
            exported += 1;
            await logEvent({ type: 'INVOICE', id: order.id, number: order.order_number, fileName: document.fileName, destination });
        } catch (error: unknown) {
            failures.push({ type: 'INVOICE', number: Number(order.order_number ?? order.id), message: error instanceof Error ? error.message : String(error) });
        }
    }

    for (const shipment of shipments) {
        const key = String(shipment.id);
        const currentFingerprint = fingerprint(shipment);
        const operationalDate = shipment.date_shipped || shipment.createdAt;
        const isRequestedDate = Boolean(dateArg && utcDateKey(operationalDate) === dateArg);
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

        for (const segment of segments) {
            const segmentKey = `${key}:${segment.clientId}`;
            const clientCharge = segments.length > 1 && shipment.shipment_number
                ? await getShipmentClientCharge(shipment.shipment_number, segment.clientId)
                : null;
            const segmentFingerprint = fingerprint({ shipment, segment, clientCharge });
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

            try {
                const document = await buildPackingListDocument(shipment.id, segment.clientId);
                const destination = await atomicWrite(document.fileName, document.pdfBuffer);
                next.shipments[segmentKey] = segmentFingerprint;
                exported += 1;
                await logEvent({ type: 'PACKING_LIST', id: shipment.id, number: shipment.shipment_number, clientId: segment.clientId, fileName: document.fileName, destination });
            } catch (error: unknown) {
                failures.push({ type: 'PACKING_LIST', number: Number(shipment.shipment_number ?? shipment.id), message: error instanceof Error ? error.message : String(error) });
            }
        }

        next.shipments[key] = currentFingerprint;
    }

    const temporaryState = `${statePath}.${process.pid}.tmp`;
    await writeFile(temporaryState, JSON.stringify(next, null, 2));
    await rename(temporaryState, statePath);
    await logEvent({
        type: 'RUN',
        exported,
        failures,
        lookbackDays: DOCUMENT_EXPORT_LOOKBACK_DAYS,
        ignoredOutsideLookback,
    });

    console.log(JSON.stringify({
        exportDir,
        exported,
        failures,
        lookbackDays: DOCUMENT_EXPORT_LOOKBACK_DAYS,
        ignoredOutsideLookback,
    }, null, 2));
    if (failures.length > 0) process.exitCode = 1;
}

main()
    .catch(async (error) => {
        await logEvent({ type: 'FATAL', message: error instanceof Error ? error.message : String(error) });
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma?.$disconnect();
    });
