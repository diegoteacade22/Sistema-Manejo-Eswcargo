'use client';

import dynamic from 'next/dynamic';
import { ComponentProps } from 'react';

// Dynamically import EditClientDialog to avoid hydration warnings
// Radix UI generates random IDs for accessibility which causes
// server/client mismatch warnings when used in lists
const EditClientDialogComponent = dynamic(
    () => import('./edit-client-dialog').then(mod => ({ default: mod.EditClientDialog })),
    { ssr: false } // Disable server-side rendering for this component
);

export function EditClientDialogWrapper(props: ComponentProps<typeof EditClientDialogComponent>) {
    return <EditClientDialogComponent {...props} />;
}
