
'use server'

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { requireAdminUser } from '@/lib/access'
import { createPaymentLedgerEntry } from '@/lib/client-ledger'

export async function createCollection(formData: FormData) {
    await requireAdminUser();

    const dateStr = formData.get('date') as string
    const clientIdStr = formData.get('clientId') as string
    const amountStr = formData.get('amount') as string
    const method = formData.get('paymentMethod') as string
    const description = formData.get('description') as string
    const reference = (formData.get('reference') as string | null)?.trim() || ''

    if (!dateStr || !clientIdStr || !amountStr || !method) {
        throw new Error('Todos los campos requeridos deben ser completados')
    }

    const clientId = parseInt(clientIdStr)
    const amount = parseFloat(amountStr)
    const date = new Date(dateStr)

    const cleanDescription = description?.trim() || `Cobranza - ${method}`

    await createPaymentLedgerEntry(prisma, {
        clientId,
        amount,
        date,
        paymentMethod: method,
        description: cleanDescription,
        reference: reference || 'Manual'
    })

    revalidatePath('/collections')
    revalidatePath('/clients/' + clientId)
    revalidatePath('/clients')
    revalidatePath('/analytics/financial')
    revalidatePath('/')

    // Return success instead of redirecting to avoid client-side error catching
    return { success: true }
}
