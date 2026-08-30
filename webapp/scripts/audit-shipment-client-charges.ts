import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { prisma } from '../lib/prisma';
import { getPackingSegments } from '../lib/packing-segments';
import { getShipmentClientCharge } from '../lib/shipment-client-charge';

dotenv.config({
    path: [
        path.resolve(process.cwd(), '.env.local'),
        path.resolve(process.cwd(), '.env'),
    ],
});

const shipmentNumberArg = process.argv.find((value) => value.startsWith('--shipment-number='))?.slice('--shipment-number='.length);
const summaryPathArg = process.argv.find((value) => value.startsWith('--summary-path='))?.slice('--summary-path='.length);
const shipmentNumber = Number(shipmentNumberArg);

function chargeReferenceKind(reference: string | null, description: string | null, key: number, clientId: number) {
    if (reference === `SHIP-${key}:CLIENT:${clientId}`) return 'STABLE';
    if (reference?.startsWith(`Envío #${key}-`)) return 'LEGACY_REFERENCE';
    if (description === `Flete - Envío #${key}`) return 'LEGACY_DESCRIPTION';
    if (description?.startsWith(`CARGA #${key}`)) return 'CARGA_DESCRIPTION';
    return reference ? 'OTHER_REFERENCE' : 'NO_REFERENCE';
}

async function writeSummary(summary: Record<string, unknown>) {
    if (!summaryPathArg) return;
    await mkdir(path.dirname(summaryPathArg), { recursive: true });
    await writeFile(summaryPathArg, `${JSON.stringify(summary, null, 2)}\n`);
}

async function main() {
    if (!Number.isInteger(shipmentNumber) || shipmentNumber <= 0) {
        throw new Error('--shipment-number debe ser un entero positivo.');
    }

    const shipment = await prisma.shipment.findFirst({
        where: { OR: [{ shipment_number: shipmentNumber }, { id: shipmentNumber }] },
        select: {
            id: true,
            shipment_number: true,
            date_shipped: true,
            createdAt: true,
            item_count: true,
            price_total: true,
            cargo_description: true,
            client: { select: { id: true, old_id: true, name: true } },
            items: {
                orderBy: { id: 'asc' },
                select: {
                    id: true,
                    quantity: true,
                    order: {
                        select: {
                            id: true,
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
                    shipmentId: true,
                    clientId: true,
                    client: { select: { id: true, old_id: true, name: true } },
                    items: {
                        orderBy: { id: 'asc' },
                        select: { id: true, quantity: true, shipmentId: true },
                    },
                },
            },
        },
    });
    if (!shipment) throw new Error(`No existe el envío ${shipmentNumber}.`);

    const key = shipment.shipment_number || shipment.id;
    const operationalDate = new Date(shipment.date_shipped || shipment.createdAt);
    const windowStart = new Date(operationalDate.getTime() - 45 * 24 * 60 * 60 * 1000);
    const windowEnd = new Date(operationalDate.getTime() + 45 * 24 * 60 * 60 * 1000);
    const segments = getPackingSegments(shipment);
    const clients = await Promise.all(segments.map(async (segment) => {
        const confirmed = segments.length > 1
            ? await getShipmentClientCharge(key, segment.clientId)
            : null;
        const candidates = await prisma.transaction.findMany({
            where: {
                clientId: segment.clientId,
                type: 'CARGO',
                amount: { lt: 0 },
                date: { gte: windowStart, lte: windowEnd },
                AND: [{ OR: [{ reference: null }, { NOT: { reference: { startsWith: 'CC-Import-' } } }] }],
            },
            select: { id: true, date: true, amount: true, reference: true, description: true },
            orderBy: [{ date: 'asc' }, { id: 'asc' }],
        });
        return {
            clientId: segment.clientId,
            clientCode: segment.client.old_id,
            clientName: segment.client.name,
            itemCount: segment.itemCount,
            confirmedCharge: confirmed ? { amount: confirmed.amount, referenceKind: chargeReferenceKind(confirmed.reference, null, key, segment.clientId) } : null,
            nearbyCandidates: candidates.map((candidate) => ({
                id: candidate.id,
                date: candidate.date.toISOString().slice(0, 10),
                amount: Math.abs(candidate.amount),
                referenceKind: chargeReferenceKind(candidate.reference, candidate.description, key, segment.clientId),
                mentionsShipment: [candidate.reference, candidate.description].some((value) => String(value || '').includes(String(key))),
            })),
        };
    }));

    const summary = {
        status: 'DIAGNOSED',
        shipment: { id: shipment.id, number: key, operationalDate: operationalDate.toISOString().slice(0, 10) },
        segmentCount: clients.length,
        confirmedCount: clients.filter((client) => client.confirmedCharge).length,
        missingCount: clients.filter((client) => !client.confirmedCharge).length,
        clients,
    };
    await writeSummary(summary);
    console.log(JSON.stringify(summary, null, 2));
}

main()
    .catch(async (error) => {
        const summary = { status: 'FAILED', message: error instanceof Error ? error.message : String(error) };
        await writeSummary(summary);
        console.error(JSON.stringify(summary));
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
