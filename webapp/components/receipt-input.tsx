'use client';

import type { ClipboardEvent } from 'react';
import { Clipboard, ImageIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp';

function isAcceptedImage(file: File) {
    return ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
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
    const handleFile = (nextFile: File | null) => {
        if (nextFile && !isAcceptedImage(nextFile)) {
            alert('El comprobante debe ser una imagen JPG, PNG o WEBP.');
            return;
        }
        onFileChange(nextFile);
    };

    const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
        const imageItem = Array.from(event.clipboardData.items).find((item) => item.type.startsWith('image/'));
        const pastedFile = imageItem?.getAsFile();
        if (!pastedFile) return;

        event.preventDefault();
        const fileName = pastedFile.name && pastedFile.name !== 'image.png'
            ? pastedFile.name
            : `comprobante-${new Date().toISOString().replace(/[:.]/g, '-')}.${pastedFile.type.split('/')[1] || 'png'}`;

        handleFile(new File([pastedFile], fileName, { type: pastedFile.type }));
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
                        accept={ACCEPTED_IMAGE_TYPES}
                        onChange={(event) => handleFile(event.target.files?.[0] || null)}
                    />
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clipboard className="h-4 w-4" />
                        <span>También podés pegar acá una imagen copiada desde WhatsApp.</span>
                    </div>
                    {file && (
                        <div className="flex items-center justify-between rounded-md bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                            <span className="flex min-w-0 items-center gap-2">
                                <ImageIcon className="h-4 w-4 shrink-0" />
                                <span className="truncate">{file.name}</span>
                            </span>
                            <Button type="button" variant="ghost" size="sm" onClick={() => handleFile(null)}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
