import { buildPackingListDocument } from '@/app/email-actions';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session?.user) return new Response('No autorizado', { status: 401 });

    const { id: rawId } = await context.params;
    const shipmentId = Number(rawId);
    if (!Number.isInteger(shipmentId)) return new Response('Envío inválido', { status: 400 });

    const shipment = await prisma.shipment.findUnique({
        where: { id: shipmentId },
        select: { client: { select: { userId: true } } },
    });
    if (!shipment) return new Response('Envío no encontrado', { status: 404 });

    const role = (session.user as { role?: string }).role;
    const userId = (session.user as { id?: string }).id;
    if (role !== 'ADMIN' && shipment.client?.userId !== userId) {
        return new Response('No autorizado', { status: 403 });
    }

    const clientIdRaw = new URL(request.url).searchParams.get('clientId');
    const packingClientId = clientIdRaw ? Number(clientIdRaw) : undefined;
    if (clientIdRaw && !Number.isInteger(packingClientId)) {
        return new Response('Cliente inválido', { status: 400 });
    }

    try {
        const { pdfBuffer, fileName } = await buildPackingListDocument(shipmentId, packingClientId);
        const body = new Uint8Array(pdfBuffer.byteLength);
        body.set(pdfBuffer);
        return new Response(body.buffer, {
            headers: {
                'content-type': 'application/pdf',
                'content-length': String(pdfBuffer.byteLength),
                'content-disposition': `attachment; filename="${fileName.replaceAll('"', '')}"`,
                'cache-control': 'private, no-store',
                'x-content-type-options': 'nosniff',
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo generar el packing list.';
        return new Response(message, { status: 422 });
    }
}
