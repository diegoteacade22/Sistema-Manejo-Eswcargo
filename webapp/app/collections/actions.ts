
'use server'

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { requireAdminUser } from '@/lib/access'

export async function createCollection(formData: FormData) {
    await requireAdminUser();

    const dateStr = formData.get('date') as string
    const clientIdStr = formData.get('clientId') as string
    const amountStr = formData.get('amount') as string
    const method = formData.get('paymentMethod') as string
    const description = formData.get('description') as string

    if (!dateStr || !clientIdStr || !amountStr || !method) {
        throw new Error('Todos los campos requeridos deben ser completados')
    }

    const clientId = parseInt(clientIdStr)
    const amount = parseFloat(amountStr)
    const date = new Date(dateStr)

    // Convención del sistema: pagos/créditos son positivos.
    const transactionAmount = Math.abs(amount)

    await prisma.transaction.create({
        data: {
            type: 'PAGO',
            date: date,
            clientId: clientId,
            amount: transactionAmount,
            paymentMethod: method,
            description: description || `Cobranza - ${method}`,
            reference: 'Manual'
        }
    })

    revalidatePath('/collections')
    revalidatePath('/clients/' + clientId)
    revalidatePath('/')

    // Return success instead of redirecting to avoid client-side error catching
    return { success: true }
}
