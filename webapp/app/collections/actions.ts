
'use server'

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { requireAdminUser } from '@/lib/access'
import { createClientPaymentWithReceipt } from '@/lib/payment-receipts'

export async function createCollection(formData: FormData) {
    await requireAdminUser();

    const dateStr = formData.get('date') as string
    const clientIdStr = formData.get('clientId') as string
    const amountStr = formData.get('amount') as string
    const method = formData.get('paymentMethod') as string
    const description = formData.get('description') as string
    const reference = formData.get('reference') as string
    const proofValue = formData.get('proof')
    const proof = proofValue instanceof File ? proofValue : null

    if (!dateStr || !clientIdStr || !amountStr || !method) {
        throw new Error('Todos los campos requeridos deben ser completados')
    }

    const clientId = parseInt(clientIdStr)
    const amount = parseFloat(amountStr)
    const date = new Date(dateStr)

    await createClientPaymentWithReceipt(prisma, {
        clientId,
        amount,
        date,
        paymentMethod: method,
        description,
        reference,
        receiptFile: proof,
    })

    revalidatePath('/collections')
    revalidatePath('/clients/' + clientId)
    revalidatePath('/clients')
    revalidatePath('/payments')
    revalidatePath('/analytics/financial')
    revalidatePath('/')

    // Return success instead of redirecting to avoid client-side error catching
    return { success: true }
}
