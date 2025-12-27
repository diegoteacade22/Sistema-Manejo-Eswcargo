
'use client';

import { useState, useRef, useEffect } from 'react';
import { updateShipment } from '@/app/actions';
import { toast } from 'sonner';
import { Loader2, Edit3, CheckCircle2 } from 'lucide-react';

interface Props {
    shipmentId: number;
    initialNotes: string | null;
    currentStatus: string;
}

export function ShipmentNotesEditor({ shipmentId, initialNotes, currentStatus }: Props) {
    const [notes, setNotes] = useState(() => {
        // Clean "nan" values which usually come from empty excel cells
        if (initialNotes === 'nan' || !initialNotes) return '';
        return initialNotes;
    });
    const [isSaving, setIsSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const handleSave = async () => {
        if (!hasChanges) return;

        setIsSaving(true);
        try {
            const result = await updateShipment({
                id: shipmentId,
                status: currentStatus,
                notes: notes
            });

            if (result.success) {
                setHasChanges(false);
                toast.success('Observaciones guardadas correctamente');
            } else {
                toast.error('Error al guardar: ' + result.error);
            }
        } catch (error) {
            toast.error('Error de red al guardar las notas');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-2 relative group mt-4">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    Observaciones Especiales
                    {isSaving ? (
                        <span className="flex items-center gap-1 text-fuchsia-600 animate-pulse">
                            <Loader2 className="h-3 w-3 animate-spin" /> Guardando...
                        </span>
                    ) : !hasChanges && notes ? (
                        <span className="flex items-center gap-1 text-emerald-600 text-[8px]">
                            <CheckCircle2 className="h-2.5 w-2.5" /> Sincronizado
                        </span>
                    ) : null}
                </span>
                <Edit3 className="h-3 w-3 text-slate-300 group-hover:text-fuchsia-400 transition-colors" />
            </div>

            <textarea
                ref={textareaRef}
                value={notes}
                onChange={(e) => {
                    setNotes(e.target.value);
                    setHasChanges(true);
                }}
                onBlur={handleSave}
                placeholder="Escribe aquí cualquier detalle importante del envío..."
                className="w-full min-h-[100px] text-sm bg-amber-50/30 dark:bg-slate-900/50 p-5 rounded-2xl border border-amber-100/50 dark:border-slate-800 italic text-slate-700 dark:text-slate-300 shadow-inner focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500/50 transition-all resize-none leading-relaxed"
            />

            {hasChanges && !isSaving && (
                <p className="text-[9px] text-fuchsia-400 absolute bottom-3 right-5 animate-bounce">
                    Haz clic fuera para guardar automáticamente
                </p>
            )}
        </div>
    );
}
