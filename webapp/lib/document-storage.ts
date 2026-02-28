import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { toInvFileName } from '@/lib/inv-filename';

const DEFAULT_EXPORT_DIR = '/Users/diegorodriguez/Library/CloudStorage/GoogleDrive-electronica.ventas@gmail.com/Mi unidad/2. AREAS/ESW_CONTABILIDAD/VENTAS - INVOICES/INV VTAS 2026 - SISTEMA';

export function getDriveExportDir() {
    return process.env.ESW_DOCS_EXPORT_DIR || DEFAULT_EXPORT_DIR;
}

export function getInvPdfFileName(rawValue: unknown, fallbackValue: unknown) {
    return toInvFileName(rawValue, fallbackValue);
}

export async function savePdfToDriveFolder(pdfBuffer: Uint8Array | Buffer, fileName: string) {
    const baseDir = getDriveExportDir();
    await mkdir(baseDir, { recursive: true });
    const fullPath = path.join(baseDir, fileName);
    await writeFile(fullPath, pdfBuffer);
    return fullPath;
}