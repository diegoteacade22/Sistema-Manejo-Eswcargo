import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session?.user) {
        return new Response('No autorizado', { status: 401 });
    }

    const params = await context.params;
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
        return new Response('Comprobante inválido', { status: 400 });
    }

    const receipt = await prisma.paymentReceipt.findUnique({
        where: { id },
        include: {
            transaction: {
                include: {
                    client: { select: { userId: true } },
                },
            },
        },
    });

    if (!receipt) {
        return new Response('Comprobante no encontrado', { status: 404 });
    }

    const role = (session.user as any).role;
    const userId = (session.user as any).id;
    const canView = role === 'ADMIN' || receipt.transaction.client?.userId === userId;

    if (!canView) {
        return new Response('No autorizado', { status: 403 });
    }

    const body = new Uint8Array(receipt.data);

    return new Response(body, {
        headers: {
            'content-type': receipt.mimeType,
            'content-length': String(receipt.size),
            'content-disposition': `inline; filename="${receipt.fileName.replaceAll('"', '')}"`,
            'cache-control': 'private, max-age=300',
        },
    });
}
