'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent } from 'react';
import { Clipboard, FileText, ImageIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ACCEPTED_RECEIPT_TYPES = 'image/jpeg,image/png,image/webp,application/pdf';

function isAcceptedReceipt(file: File) {
    return ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type);
}

export function ReceiptInput({
    file,
    onFileChange,
    inputId = 'proof',
}: {
    file: File | null;
    onFileChange: (file: File | null) => void;
    inputId?: string;
}) {
    const [pasteMessage, setPasteMessage] = useState<string | null>(null);
    const previewUrl = useMemo(() => {
        if (!file || !file.type.startsWith('image/')) return null;
        return URL.createObjectURL(file);
    }, [file]);

    useEffect(() => {
        return () => {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
        };
    }, [previewUrl]);

    const handleFile = (nextFile: File | null) => {
        if (nextFile && !isAcceptedReceipt(nextFile)) {
            alert('El comprobante debe ser JPG, PNG, WEBP o PDF.');
            return;
        }
        setPasteMessage(nextFile ? 'Imagen lista para adjuntar.' : null);
        onFileChange(nextFile);
    };

    const fileFromClipboard = (items: DataTransferItemList) => {
        const imageItem = Array.from(items).find((item) => item.type.startsWith('image/'));
        const pastedFile = imageItem?.getAsFile();
        if (!pastedFile) return null;

        const fileName = pastedFile.name && pastedFile.name !== 'image.png'
            ? pastedFile.name
            : `comprobante-${new Date().toISOString().replace(/[:.]/g, '-')}.${pastedFile.type.split('/')[1] || 'png'}`;

        return new File([pastedFile], fileName, { type: pastedFile.type });
    };

    const handlePaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
        const pastedFile = fileFromClipboard(event.clipboardData.items);
        if (!pastedFile) return;

        event.preventDefault();
        event.stopPropagation();
        handleFile(pastedFile);
    };

    useEffect(() => {
        const handleWindowPaste = (event: ClipboardEvent) => {
            if (!event.clipboardData?.items?.length) return;

            const pastedFile = fileFromClipboard(event.clipboardData.items);
            if (!pastedFile) return;

            event.preventDefault();
            handleFile(pastedFile);
        };

        window.addEventListener('paste', handleWindowPaste as unknown as EventListener);
        return () => window.removeEventListener('paste', handleWindowPaste as unknown as EventListener);
    });

    const handleClipboardButton = async () => {
        try {
            const items = await navigator.clipboard?.read?.();
            const imageItem = items?.find((item) => item.types.some((type) => type.startsWith('image/')));
            const mimeType = imageItem?.types.find((type) => type.startsWith('image/'));
            if (!imageItem || !mimeType) {
                alert('No encontré una imagen copiada.');
                return;
            }

            const blob = await imageItem.getType(mimeType);
            handleFile(new File([blob], `comprobante-${new Date().toISOString().replace(/[:.]/g, '-')}.${mimeType.split('/')[1] || 'png'}`, { type: mimeType }));
        } catch {
            alert('No pude leer el portapapeles. Probá con Cmd+V o seleccioná la foto.');
        }
    };

    return (
        <div className="space-y-2">
            <Label htmlFor={inputId}>Comprobante</Label>
            <div
                tabIndex={0}
                onPaste={handlePaste}
                className="rounded-md border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
                <div className="flex flex-col gap-3">
                    <Input
                        id={inputId}
                        type="file"
                        accept={ACCEPTED_RECEIPT_TYPES}
                        onChange={(event) => handleFile(event.target.files?.[0] || null)}
                    />
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clipboard className="h-4 w-4" />
                        <span>Podés pegar una imagen copiada desde WhatsApp con Cmd+V o adjuntar un PDF.</span>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={handleClipboardButton} className="w-fit">
                        <Clipboard className="mr-2 h-4 w-4" />
                        Pegar imagen
                    </Button>
                    {file && (
                        <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/40 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                            <div className="flex items-center justify-between gap-3">
                                <span className="flex min-w-0 items-center gap-2">
                                    {file.type === 'application/pdf' ? <FileText className="h-4 w-4 shrink-0" /> : <ImageIcon className="h-4 w-4 shrink-0" />}
                                    <span className="truncate">{file.name}</span>
                                </span>
                                <Button type="button" variant="ghost" size="sm" onClick={() => handleFile(null)}>
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                            {previewUrl && (
                                <img
                                    src={previewUrl}
                                    alt="Vista previa del comprobante"
                                    className="mt-3 max-h-44 w-full rounded-md border border-emerald-200 object-contain dark:border-emerald-900"
                                />
                            )}
                        </div>
                    )}
                    {pasteMessage && !file && <p className="text-xs text-muted-foreground">{pasteMessage}</p>}
                </div>
            </div>
        </div>
    );
}
