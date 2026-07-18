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
    duplicateConfirmed?: boolean;
};

type DuplicateEvidence = {
    id: number;
    clientId: number;
    clientName: string;
    category: string;
    fileName: string | null;
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
    const detectedMimeType = detectEvidenceMimeType(data);
    if (!detectedMimeType || detectedMimeType !== file.type) {
        throw new Error('El contenido del archivo no coincide con el tipo declarado. Adjuntá el comprobante original.');
    }
    return {
        fileName: cleanFileName(file.name),
        mimeType: file.type,
        size: file.size,
        sha256: crypto.createHash('sha256').update(data).digest('hex'),
        data,
    };
}

function detectEvidenceMimeType(data: Buffer) {
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
    if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (data.length >= 12 && data.subarray(0, 4).equals(Buffer.from('RIFF')) && data.subarray(8, 12).equals(Buffer.from('WEBP'))) return 'image/webp';
    if (data.length >= 5 && data.subarray(0, 5).equals(Buffer.from('%PDF-'))) return 'application/pdf';
    return null;
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
    if (category === 'PAYMENT_RECEIPT' && !transactionId) {
        throw new Error('Un recibo de pago debe quedar vinculado al movimiento que respalda.');
    }
    let transactionSnapshot: {
        date: Date;
        type: string;
        amount: number;
        reference: string | null;
    } | null = null;
    if (transactionId) {
        const transaction = await db.transaction.findUnique({
            where: { id: transactionId },
            select: { id: true, clientId: true, date: true, type: true, amount: true, reference: true },
        });
        if (!transaction || transaction.clientId !== input.clientId) {
            throw new Error('El movimiento no pertenece a la cuenta seleccionada.');
        }
        transactionSnapshot = transaction;
    }

    const duplicate = file ? await db.accountEvidence.findFirst({
        where: { sha256: file.sha256 },
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            clientId: true,
            category: true,
            fileName: true,
            client: { select: { name: true } },
        },
    }) : null;
    if (duplicate && !input.duplicateConfirmed) {
        return {
            created: false as const,
            duplicate: {
                id: duplicate.id,
                clientId: duplicate.clientId,
                clientName: duplicate.client.name,
                category: duplicate.category,
                fileName: duplicate.fileName,
            } satisfies DuplicateEvidence,
        };
    }
    if (duplicate && duplicate.clientId !== input.clientId && category === 'PAYMENT_RECEIPT' && !note) {
        throw new Error('Este recibo ya está asociado a otra cuenta. Indicá en la nota por qué debe reutilizarse antes de confirmarlo.');
    }

    const evidence = await db.accountEvidence.create({
        data: {
            clientId: input.clientId,
            transactionId,
            transactionReference: transactionSnapshot?.reference || null,
            transactionDate: transactionSnapshot?.date || null,
            transactionType: transactionSnapshot?.type || null,
            transactionAmount: transactionSnapshot?.amount || null,
            category,
            note,
            source,
            ...file,
        },
    });
    return { created: true as const, evidence };
}
