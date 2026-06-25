import { requireAdminUser } from '@/lib/access';
import { MaintenanceClient } from './maintenance-client';

export default async function MaintenancePage() {
    await requireAdminUser();
    return <MaintenanceClient />;
}
