
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import EditShipmentForm from './edit-shipment-form';

interface Props {
    params: Promise<{ id: string }>;
}

export default async function EditShipmentPage(props: Props) {
    const params = await props.params;
    const shipmentId = parseInt(params.id);

    if (isNaN(shipmentId)) return notFound();

    const shipment = await prisma.shipment.findUnique({
        where: { id: shipmentId }
    });

    if (!shipment) return notFound();

    return (
        <div className="p-8 max-w-2xl mx-auto">
            <EditShipmentForm shipment={shipment} />
        </div>
    );
}
