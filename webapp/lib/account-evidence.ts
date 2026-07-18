import crypto from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

type TxClient = PrismaClient | Prisma.TransactionClient;

const MAX_EVIDENCE_SIZE = 8 * 1024 * 1024;
const ALLOWED_EVIDENCE_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
]);

type AccountEvidenceInput = {
    clientId: number;
    transactionId?: number | null;
    category: string;
    note?: string | null;
    source?: string | null;
    evidenceFile?: File | null;
};

function cleanText(value?: string | null) {
    const trimmed = value?.trim();
    return trimmed || null;
}

function cleanFileName(fileName: string) {
    return fileName
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160) || 'evidencia';
}

async function readEvidenceFile(file: File | null | undefined) {
    if (!file || file.size === 0) return null;
    if (!ALLOWED_EVIDENCE_TYPES.has(file.type)) {
        throw new Error('La evidencia debe ser JPG, PNG, WEBP o PDF.');
    }
    if (file.size > MAX_EVIDENCE_SIZE) {
        throw new Error('La evidencia no puede superar 8 MB.');
    }

    const data = Buffer.from(await file.arrayBuffer());
    return {
        fileName: cleanFileName(file.name),
        mimeType: file.type,
        size: file.size,
        sha256: crypto.createHash('sha256').update(data).digest('hex'),
        data,
    };
}

export async function createAccountEvidence(db: TxClient, input: AccountEvidenceInput) {
    if (!Number.isInteger(input.clientId) || input.clientId <= 0) {
        throw new Error('Seleccioná una cuenta válida.');
    }

    const category = cleanText(input.category);
    const note = cleanText(input.note);
    const source = cleanText(input.source);
    const file = await readEvidenceFile(input.evidenceFile);
    if (!category) throw new Error('Indicá el tipo de evidencia.');
    if (!note && !source && !file) {
        throw new Error('Adjuntá un archivo, una referencia externa o una nota de respaldo.');
    }

    const client = await db.client.findUnique({ where: { id: input.clientId }, select: { id: true } });
    if (!client) throw new Error('La cuenta seleccionada ya no existe.');

    const transactionId = input.transactionId || null;
    if (transactionId) {
        const transaction = await db.transaction.findUnique({
            where: { id: transactionId },
            select: { clientId: true },
        });
        if (!transaction || transaction.clientId !== input.clientId) {
            throw new Error('El movimiento no pertenece a la cuenta seleccionada.');
        }
    }

    return db.accountEvidence.create({
        data: {
            clientId: input.clientId,
            transactionId,
            category,
            note,
            source,
            ...file,
        },
    });
}
