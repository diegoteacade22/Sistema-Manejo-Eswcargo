import { requireAdminUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { EvidenceClient } from './evidence-client';

export default async function EvidencePage() {
    await requireAdminUser();
    const [clients, evidence] = await Promise.all([
        prisma.client.findMany({
            where: { transactions: { some: {} } },
            select: { id: true, name: true, old_id: true, document_id: true, phone: true },
            orderBy: { name: 'asc' },
        }),
        prisma.accountEvidence.findMany({
            take: 30,
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                category: true,
                note: true,
                source: true,
                fileName: true,
                createdAt: true,
                client: { select: { id: true, name: true, old_id: true } },
                transaction: { select: { id: true, type: true, amount: true, reference: true } },
            },
        }),
    ]);

    return <EvidenceClient clients={clients} evidence={evidence.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() }))} />;
}
