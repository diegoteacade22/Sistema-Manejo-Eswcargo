import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { CompanyOsContinuousObjectives } from '@/components/company-os-continuous-objectives';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function CompanyOsObjectivesPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if ((session.user as { role?: string }).role !== 'ADMIN') redirect('/');
  return (
    <main className="min-h-screen bg-[#06080d] p-4 text-slate-100 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-sm text-cyan-300">Company OS · Gerente General, Sistemas y Datos</p><h1 className="mt-2 text-3xl font-bold">Objetivos continuos</h1><p className="mt-2 max-w-2xl text-sm text-slate-400">Asigná una meta y su plazo. Los gerentes revisan las fuentes permitidas, toman tareas y conservan sus resultados.</p></div>
          <nav aria-label="Company OS" className="flex gap-4 text-sm text-cyan-300"><Link href="/company-os">Gerentes</Link><Link href="/company-os/operations">Tareas y resultados</Link></nav>
        </header>
        <CompanyOsContinuousObjectives />
      </div>
    </main>
  );
}
