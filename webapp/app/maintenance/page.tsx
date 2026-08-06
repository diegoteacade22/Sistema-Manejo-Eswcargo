import { requireAdminUser } from '@/lib/access';
import { MaintenanceClient } from './maintenance-client';

export const maxDuration = 60;

export default async function MaintenancePage() {
    await requireAdminUser();
    return <MaintenanceClient directSyncEnabled={process.env.DIRECT_SHEETS_SYNC_ENABLED === 'true'} />;
}
