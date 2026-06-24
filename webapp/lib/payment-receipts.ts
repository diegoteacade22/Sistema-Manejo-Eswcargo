import crypto from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

type TxClient = PrismaClient | Prisma.TransactionClient;

const MAX_RECEIPT_SIZE = 8 * 1024 * 1024;
const ALLOWED_RECEIPT_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
]);

type PaymentInput = {
    clientId: number;
    amount: number;
    date?: Date | null;
    paymentMethod?: string | null;
    description?: string | null;
    reference?: string | null;
    receiptFile?: File | null;
};

function cleanText(value?: string | null) {
    const trimmed = value?.trim();
    return trimmed || null;
}

function normalizeDateRange(date: Date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
}

function sanitizeFileName(fileName: string) {
    return fileName
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160) || 'comprobante';
}

async function readReceiptFile(file: File | null | undefined) {
    if (!file || file.size === 0) return null;

    if (!ALLOWED_RECEIPT_TYPES.has(file.type)) {
        throw new Error('El comprobante debe ser JPG, PNG, WEBP o PDF.');
    }

    if (file.size > MAX_RECEIPT_SIZE) {
        throw new Error('El comprobante no puede superar 8 MB.');
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    return {
        fileName: sanitizeFileName(file.name),
        mimeType: file.type,
        size: file.size,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        data: buffer,
    };
}

export async function createClientPaymentWithReceipt(tx: TxClient, input: PaymentInput) {
    if (!input.clientId || !Number.isFinite(input.amount) || input.amount <= 0) {
        throw new Error('Cliente e importe válido son requeridos.');
    }

    const amount = Math.abs(input.amount);
    const date = input.date || new Date();
    const paymentMethod = cleanText(input.paymentMethod);
    const reference = cleanText(input.reference);
    const referenceValue = reference || 'Manual';
    const description = cleanText(input.description) || `Cobranza - ${paymentMethod || 'Pago'}`;
    const receipt = await readReceiptFile(input.receiptFile);
    const { start, end } = normalizeDateRange(date);

    const duplicate = await tx.transaction.findFirst({
        where: {
            clientId: input.clientId,
            type: 'PAGO',
            amount,
            paymentMethod,
            reference: referenceValue,
            date: {
                gte: start,
                lt: end,
            },
        },
        select: { id: true },
    });

    if (duplicate) {
        throw new Error('Ya existe un pago con el mismo cliente, fecha, monto, método y referencia.');
    }

    return tx.transaction.create({
        data: {
            clientId: input.clientId,
            type: 'PAGO',
            paymentMethod,
            amount,
            date,
            description,
            reference: referenceValue,
            receipt: receipt ? { create: receipt } : undefined,
        },
        include: { receipt: true },
    });
}
