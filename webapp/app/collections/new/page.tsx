
import { prisma } from '@/lib/prisma'
import { NewCollectionForm } from '@/components/collections/new-collection-form'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default async function NewCollectionPage() {
    const clients = await prisma.client.findMany({
        select: {
            id: true,
            name: true,
            old_id: true,
            document_id: true,
            email: true,
            phone: true,
            instagram: true,
            webpage: true,
            address: true,
            city: true,
            state: true,
            country: true,
            zipCode: true,
            type: true,
            notes: true,
            userId: true,
            createdAt: true,
            updatedAt: true
        },
    })

    // Cast to match exact type if needed, but Prisma types usually align well enough. 
    // Re-mapping just to be safe if strict types complain about optional fields vs null
    const serializedClients = clients.map(c => ({
        ...c,
        // ensure nulls are handled if component creates issues, but mostly ok
    }))

    return (
        <div className="p-8 space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" asChild>
                    <Link href="/collections"><ArrowLeft className="h-5 w-5" /></Link>
                </Button>
                <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Nueva Cobranza</h1>
            </div>

            <NewCollectionForm clients={serializedClients} />
        </div>
    )
}
