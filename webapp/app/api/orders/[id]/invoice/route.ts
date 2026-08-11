import { buildInvoiceDocument } from '@/app/email-actions';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const maxDuration = 60;

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session?.user) {
        return new Response('No autorizado', { status: 401 });
    }

    const { id: rawId } = await context.params;
    const id = Number(rawId);
    if (!Number.isInteger(id)) {
        return new Response('Pedido invalido', { status: 400 });
    }

    const order = await prisma.order.findUnique({
        where: { id },
        select: { client: { select: { userId: true } } },
    });
    if (!order) {
        return new Response('Pedido no encontrado', { status: 404 });
    }

    const role = (session.user as any).role;
    const userId = (session.user as any).id;
    if (role !== 'ADMIN' && order.client.userId !== userId) {
        return new Response('No autorizado', { status: 403 });
    }

    try {
        const { pdfBuffer, fileName } = await buildInvoiceDocument(id);
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
        const message = error instanceof Error ? error.message : 'No se pudo generar el invoice.';
        return new Response(message, { status: 422 });
    }
}
