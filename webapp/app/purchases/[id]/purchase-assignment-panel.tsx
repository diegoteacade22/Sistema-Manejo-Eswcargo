'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { assignPurchaseToClient } from '@/app/purchases/actions';

type Client = {
  id: number;
  name: string;
};

type PurchaseItemRow = {
  id: number;
  sku: string | null;
  productName: string;
  quantity: number;
  unit_cost: number;
  allocatedQty: number;
};

export function PurchaseAssignmentPanel({
  clients,
  item,
}: {
  clients: Client[];
  item: PurchaseItemRow;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const pendingQty = item.quantity - item.allocatedQty;

  const [clientId, setClientId] = useState('');
  const [quantity, setQuantity] = useState<number>(pendingQty > 0 ? 1 : 0);
  const [unitPrice, setUnitPrice] = useState<number>(item.unit_cost);
  const [notes, setNotes] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const onAssign = () => {
    if (pendingQty <= 0) {
      alert('Este ítem no tiene pendiente para asignar.');
      return;
    }
    if (!clientId) {
      alert('Selecciona un cliente.');
      return;
    }

    startTransition(async () => {
      const result = await assignPurchaseToClient({
        purchaseItemId: item.id,
        clientId: Number(clientId),
        quantity: Number(quantity),
        unitPrice: Number(unitPrice),
        notes,
        idempotencyKey,
      });

      if (!result.success) {
        alert(result.message);
        return;
      }

      setNotes('');
      setQuantity(1);
      setIdempotencyKey(crypto.randomUUID());
      router.refresh();
    });
  };

  return (
    <div className="grid md:grid-cols-12 gap-2 items-end">
      <div className="md:col-span-4 space-y-1">
        <Label>Cliente</Label>
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger>
            <SelectValue placeholder="Seleccionar cliente" />
          </SelectTrigger>
          <SelectContent>
            {clients.map((client) => (
              <SelectItem key={client.id} value={client.id.toString()}>{client.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="md:col-span-2 space-y-1">
        <Label>Cantidad</Label>
        <Input
          type="number"
          min="1"
          max={Math.max(1, pendingQty)}
          value={quantity}
          onChange={(e) => setQuantity(Number(e.target.value) || 0)}
          disabled={pendingQty <= 0}
        />
      </div>

      <div className="md:col-span-2 space-y-1">
        <Label>Precio sugerido</Label>
        <Input
          type="number"
          min="0"
          step="0.01"
          value={unitPrice}
          onChange={(e) => setUnitPrice(Number(e.target.value) || 0)}
          disabled={pendingQty <= 0}
        />
      </div>

      <div className="md:col-span-2 space-y-1">
        <Label>Notas</Label>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Opcional"
          disabled={pendingQty <= 0}
        />
      </div>

      <div className="md:col-span-2">
        <Button onClick={onAssign} disabled={isPending || pendingQty <= 0} className="w-full bg-orange-600 hover:bg-orange-700">
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Asignar
        </Button>
      </div>
    </div>
  );
}
