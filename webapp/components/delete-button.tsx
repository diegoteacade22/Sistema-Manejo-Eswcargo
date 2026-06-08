'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { deleteEntity } from '@/app/actions';
import { useRouter } from 'next/navigation';

interface DeleteButtonProps {
    id: number;
    type: 'client' | 'supplier' | 'product' | 'order' | 'shipment';
}

export function DeleteButton({ id, type }: DeleteButtonProps) {
    const [isPending, startTransition] = useTransition();
    const router = useRouter();

    const handleDelete = async () => {
        if (!confirm('¿Estás seguro de que deseas eliminar este registro? Esta acción no se puede deshacer.')) {
            return;
        }

        startTransition(async () => {
            const result = await deleteEntity(type, id);

            if (result.success) {
                // Refresh is usually handled by revalidatePath in action, but router.refresh helps client update too
                router.refresh();
            } else {
                alert(result.message || 'Error al eliminar');
            }
        });
    };

    return (
        <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
            onClick={handleDelete}
            disabled={isPending}
            title="Eliminar"
        >
            <Trash2 className="h-4 w-4" />
        </Button>
    );
}
