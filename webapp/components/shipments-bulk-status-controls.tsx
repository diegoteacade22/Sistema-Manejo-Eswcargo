'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { transitionShipmentsByDate } from '@/app/actions';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';

export function ShipmentsBulkStatusControls() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const runTransition = (fromStatus: string, toStatus: string) => {
    if (!date) {
      alert('Selecciona una fecha.');
      return;
    }

    startTransition(async () => {
      try {
        const result = await transitionShipmentsByDate({ date, fromStatus, toStatus });
        alert(result.message);
        if (result.success) {
          router.refresh();
        }
      } catch (error) {
        console.error('Error running shipment transition:', error);
        alert('No se pudo ejecutar la transición. Revisá la conexión e intentá nuevamente.');
      }
    });
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-950 space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="space-y-1 min-w-[220px]">
          <Label>Fecha de envíos (salida)</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={isPending} />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => runTransition('SALIENDO', 'LLEGANDO')}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            SALIENDO → LLEGANDO
          </Button>

          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => runTransition('LLEGANDO', 'EN BSAS')}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            LLEGANDO → BsAs
          </Button>

          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={isPending}
            onClick={() => runTransition('EN BSAS', 'ENTREGADO')}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            BsAs → ENTREGADO
          </Button>
        </div>
      </div>
    </div>
  );
}
