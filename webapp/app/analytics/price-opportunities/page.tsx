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

        <PriceOpportunitiesClient />
      </div>
    </main>
  );
}

