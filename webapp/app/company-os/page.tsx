import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { CompanyOsDashboard } from '@/components/company-os-dashboard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function CompanyOsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if ((session.user as { role?: string }).role !== 'ADMIN') redirect('/');

  return <CompanyOsDashboard />;
}
