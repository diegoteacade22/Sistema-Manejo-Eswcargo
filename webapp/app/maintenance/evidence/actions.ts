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
        transactionId: transactionIdValue ? Number(transactionIdValue) : null,
        category: String(formData.get('category') || ''),
        note: String(formData.get('note') || ''),
        source: String(formData.get('source') || ''),
        evidenceFile,
    });

    revalidatePath('/maintenance');
    revalidatePath('/maintenance/evidence');
    revalidatePath(`/clients/${clientId}`);
    return { success: true, evidenceId: evidence.id };
}
