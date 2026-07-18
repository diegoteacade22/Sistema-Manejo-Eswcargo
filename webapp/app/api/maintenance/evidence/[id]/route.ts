import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== 'ADMIN') {
        return new Response('No autorizado', { status: 401 });
    }

    const { id: rawId } = await context.params;
    const id = Number(rawId);
    if (!Number.isInteger(id)) return new Response('Evidencia inválida', { status: 400 });

    const evidence = await prisma.accountEvidence.findUnique({
        where: { id },
        select: { data: true, fileName: true, mimeType: true, size: true },
    });
    if (!evidence) return new Response('Evidencia no encontrada', { status: 404 });
    if (!evidence.data || !evidence.fileName || !evidence.mimeType || !evidence.size) {
        return new Response('Esta evidencia no tiene archivo adjunto', { status: 404 });
    }

    return new Response(new Uint8Array(evidence.data), {
        headers: {
            'content-type': evidence.mimeType,
            'content-length': String(evidence.size),
            'content-disposition': `attachment; filename="${evidence.fileName.replaceAll('"', '')}"`,
            'cache-control': 'private, max-age=300',
            'x-content-type-options': 'nosniff',
        },
    });
}
