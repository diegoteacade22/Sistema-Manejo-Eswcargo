'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { registerPurchasePayment } from '@/app/purchases/actions';

type Props = {
  purchaseId: number;
  balanceDue: number;
};

export function RegisterPurchasePaymentButton({ purchaseId, balanceDue }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const onClick = () => {
    const suggested = balanceDue > 0 ? balanceDue.toFixed(2) : '0';
    const amountRaw = window.prompt('Monto a pagar (USD):', suggested);
    if (!amountRaw) return;

    const amount = Number(amountRaw.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Monto inválido.');
      return;
    }

    const paymentMethod = window.prompt('Método de pago (opcional):', 'TRANSFERENCIA') || undefined;
    const reference = window.prompt('Referencia (opcional):', '') || undefined;

    startTransition(async () => {
      const result = await registerPurchasePayment({
        purchaseId,
        amount,
        payment_method: paymentMethod,
        reference,
      });

      if (!result.success) {
        alert(result.message);
        return;
      }

      alert(result.message);
      router.refresh();
    });
  };

  return (
    <Button onClick={onClick} disabled={isPending} className="bg-blue-600 hover:bg-blue-700 text-white">
      {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      Registrar pago proveedor
    </Button>
  );
}
