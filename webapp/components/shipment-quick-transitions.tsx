'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { updateShipment } from '@/app/actions';

type ShipmentQuickTransitionsProps = {
  shipment: {
    id: number;
    shipment_number: number | null;
    status: string | null;
    forwarder?: string | null;
    date_shipped?: Date | null;
    date_arrived?: Date | null;
    notes?: string | null;
  };
};

function normalizeStatus(status: string | null | undefined) {
  const value = (status || '').toUpperCase().trim();
  if (value === 'EN BSAS' || value === 'EN 🇦🇷' || value === 'RECIBIDO BSAS') return 'EN BSAS';
  if (value === 'FINALIZADO') return 'ENTREGADO';
  return value;
}

export function ShipmentQuickTransitions({ shipment }: ShipmentQuickTransitionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const current = normalizeStatus(shipment.status || 'SALIENDO');

  const goTo = (nextStatus: 'LLEGANDO' | 'EN BSAS' | 'ENTREGADO') => {
    startTransition(async () => {
      const result = await updateShipment({
        id: shipment.id,
        status: nextStatus,
        forwarder: shipment.forwarder || undefined,
        date_shipped: shipment.date_shipped ? new Date(shipment.date_shipped) : null,
        date_arrived: shipment.date_arrived ? new Date(shipment.date_arrived) : (nextStatus === 'EN BSAS' || nextStatus === 'ENTREGADO') ? new Date() : null,
        notes: shipment.notes || undefined,
      });

      if (!result.success) {
        alert(result.error || 'No se pudo actualizar estado.');
        return;
      }

      router.refresh();
    });
  };

  const canGoLlegando = current === 'SALIENDO';
  const canGoBsAs = current === 'LLEGANDO';
  const canGoEntregado = current === 'EN BSAS';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        disabled={isPending || !canGoLlegando}
        onClick={() => goTo('LLEGANDO')}
      >
        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        SALIENDO → LLEGANDO
      </Button>

      <Button
        variant="outline"
        disabled={isPending || !canGoBsAs}
        onClick={() => goTo('EN BSAS')}
      >
        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        LLEGANDO → BsAs
      </Button>

      {canGoEntregado && (
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
          Para marcar ENTREGADO, abrí el estado arriba y confirmá si quedó cobrado o pendiente.
        </p>
      )}
    </div>
  );
}
