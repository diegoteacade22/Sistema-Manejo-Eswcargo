import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Eye, ShieldCheck } from 'lucide-react';
import { auth } from '@/lib/auth';
import { CompanyOsRuntimeControlCenter } from '@/components/company-os-runtime-control-center';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function CompanyOsOperationsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if ((session.user as { role?: string }).role !== 'ADMIN') redirect('/');

  return (
    <main className="min-h-screen bg-[#06080d] p-4 text-slate-100 md:p-8">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <header className="rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-slate-950 via-emerald-950/20 to-slate-950 p-6 shadow-2xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-3 flex flex-wrap gap-2">
                <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                  <Eye className="mr-1 h-3 w-3" /> PHASE 1 · READ ONLY
                </Badge>
                <Badge variant="outline" className="border-cyan-500/30 text-cyan-300">
                  <ShieldCheck className="mr-1 h-3 w-3" /> COMPANY OS CANONICAL DATA
                </Badge>
              </div>
              <h1 className="text-3xl font-black tracking-tight">Company OS Autonomous Operations</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">
                Tablero operativo integrado. Observa el control plane durable; no mantiene estado propio ni habilita ejecución de ingeniería continua.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link href="/company-os"><ArrowLeft className="mr-2 h-4 w-4" /> Volver a Company OS</Link>
            </Button>
          </div>
        </header>

        <CompanyOsRuntimeControlCenter readOnly />
      </div>
    </main>
  );
}
