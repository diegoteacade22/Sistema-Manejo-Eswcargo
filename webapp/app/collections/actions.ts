
'use server'

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { requireAdminUser } from '@/lib/access'
import { createPaymentLedgerEntry } from '@/lib/client-ledger'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

async function saveCollectionProof(file: File | null) {
    if (!file || file.size === 0) return null

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    if (!allowedTypes.includes(file.type)) {
        throw new Error('El comprobante debe ser JPG, PNG, WEBP o PDF.')
    }

    const extension = file.name.split('.').pop()?.toLowerCase() || 'bin'
    const safeName = `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}.${extension}`
    const relativeDir = '/payment-proofs'
    const absoluteDir = path.join(process.cwd(), 'public', relativeDir)
    await mkdir(absoluteDir, { recursive: true })

    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(path.join(absoluteDir, safeName), buffer)
    return `${relativeDir}/${safeName}`
}

export async function createCollection(formData: FormData) {
    await requireAdminUser();

    const dateStr = formData.get('date') as string
    const clientIdStr = formData.get('clientId') as string
    const amountStr = formData.get('amount') as string
    const method = formData.get('paymentMethod') as string
    const description = formData.get('description') as string
    const reference = (formData.get('reference') as string | null)?.trim() || ''
    const proofValue = formData.get('proof')
    const proofFile = proofValue instanceof File ? proofValue : null

    if (!dateStr || !clientIdStr || !amountStr || !method) {
        throw new Error('Todos los campos requeridos deben ser completados')
    }

    const clientId = parseInt(clientIdStr)
    const amount = parseFloat(amountStr)
    const date = new Date(dateStr)

    const proofUrl = await saveCollectionProof(proofFile)
    const cleanDescription = description?.trim() || `Cobranza - ${method}`
    const fullDescription = proofUrl
        ? `${cleanDescription} | Comprobante: ${proofUrl}`
        : cleanDescription

    await createPaymentLedgerEntry(prisma, {
        clientId,
        amount,
        date,
        paymentMethod: method,
        description: fullDescription,
        reference: reference || proofUrl || 'Manual'
    })

    revalidatePath('/collections')
    revalidatePath('/clients/' + clientId)
    revalidatePath('/clients')
    revalidatePath('/analytics/financial')
    revalidatePath('/')

    // Return success instead of redirecting to avoid client-side error catching
    return { success: true }
}
