'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { createAccountEvidence } from '@/lib/account-evidence';

export async function registerAccountEvidence(formData: FormData) {
    await requireAdminUser();

    const clientId = Number(formData.get('clientId'));
    const transactionIdValue = String(formData.get('transactionId') || '').trim();
    const evidenceValue = formData.get('evidenceFile');
    const evidenceFile = evidenceValue instanceof File ? evidenceValue : null;

    const evidence = await createAccountEvidence(prisma, {
        clientId,
        transactionId: /^\d+$/.test(transactionIdValue) ? Number(transactionIdValue) : null,
        category: String(formData.get('category') || ''),
        note: String(formData.get('note') || ''),
        source: String(formData.get('source') || ''),
        evidenceFile,
        duplicateConfirmed: formData.get('duplicateConfirmed') === 'true',
    });

    if (!evidence.created) {
        return { success: false as const, duplicate: evidence.duplicate };
    }

    revalidatePath('/maintenance');
    revalidatePath('/maintenance/evidence');
    revalidatePath(`/clients/${clientId}`);
    return { success: true as const, evidenceId: evidence.evidence.id };
}

export async function getClientEvidenceTransactions(clientId: number) {
    await requireAdminUser();
    if (!Number.isInteger(clientId) || clientId <= 0) throw new Error('Seleccioná una cuenta válida.');

    const transactions = await prisma.transaction.findMany({
        where: { clientId },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        take: 80,
        select: { id: true, date: true, type: true, amount: true, reference: true, description: true },
    });
    return transactions.map((transaction) => ({ ...transaction, date: transaction.date.toISOString() }));
}
