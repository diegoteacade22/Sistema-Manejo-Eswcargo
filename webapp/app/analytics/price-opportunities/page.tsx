import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, BadgeDollarSign } from 'lucide-react';
import { auth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { PriceOpportunitiesClient } from './price-opportunities-client';

export const dynamic = 'force-dynamic';

export default async function PriceOpportunitiesPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if ((session.user as { role?: string }).role !== 'ADMIN') redirect('/');

  return (
    <main className="min-h-screen bg-slate-950 p-5 text-slate-100 md:p-8">
      <div className="mx-auto max-w-7xl space-y-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <BadgeDollarSign className="h-8 w-8 text-cyan-400" />
              <h1 className="text-3xl font-black">Oportunidades de listas</h1>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              Compara listas de proveedores con compras y ventas reales de IMPORTSYS.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver al Menu Principal
            </Link>
          </Button>
        </div>

        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-sm text-slate-300">
          <p className="font-bold text-cyan-300">Cómo usar las oportunidades</p>
          <p className="mt-2">
            1. Envía o recibe por WhatsApp una lista XLS, XLSX, CSV o TXT. El bot la analiza
            automáticamente y te avisa por WhatsApp con el enlace al Google Sheet.
          </p>
          <p className="mt-1">
            2. Prioriza <strong className="text-emerald-400">Oferta probable</strong>; revisa
            SKU, región, condición y stock antes de comprar. En <strong>Posible oferta</strong>,
            confirma el producto y el historial.
          </p>
          <p className="mt-1">
            3. Si recibes la lista fuera de WhatsApp, puedes cargarla manualmente debajo.
          </p>
          <p className="mt-1">
            La carga queda registrada con fecha, estado y proveedor para que Telegram pueda responder
            cuántas listas cargaste sin consultar el correo.
          </p>
        </div>

        <PriceOpportunitiesClient />
      </div>
    </main>
  );
}
