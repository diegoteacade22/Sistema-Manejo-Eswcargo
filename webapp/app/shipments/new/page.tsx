
import { prisma } from '@/lib/prisma';
import NewShipmentForm from './new-shipment-form';

export default async function NewShipmentPage() {
    const clients = await prisma.client.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' }
    });

    return (
        <div className="p-8 space-y-8">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Nuevo Envío</h1>
            <NewShipmentForm clients={clients} />
        </div>
    );
}
