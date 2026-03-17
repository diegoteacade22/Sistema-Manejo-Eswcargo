'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { markPurchaseAsPaid } from '@/app/purchases/actions';

export function MarkPurchasePaidButton({ purchaseId }: { purchaseId: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const onClick = () => {
    startTransition(async () => {
      const result = await markPurchaseAsPaid(purchaseId);
      if (!result.success) {
        alert(result.message);
        return;
      }
      alert(result.message);
      router.refresh();
    });
  };

  return (
    <Button onClick={onClick} disabled={isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white">
      {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      Marcar logística → ENCARGADO
    </Button>
  );
}
