export const DOCUMENT_EXPORT_LOOKBACK_DAYS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isWithinDocumentExportWindow(
    operationalDate: Date | string | null | undefined,
    now = new Date(),
    lookbackDays = DOCUMENT_EXPORT_LOOKBACK_DAYS,
) {
    if (!operationalDate || !Number.isFinite(lookbackDays) || lookbackDays <= 0) return false;

    const timestamp = new Date(operationalDate).getTime();
    if (!Number.isFinite(timestamp)) return false;

    const age = now.getTime() - timestamp;
    return age >= 0 && age <= lookbackDays * DAY_MS;
}

export function shouldExportOperationalDocument({
    currentFingerprint,
    previousFingerprint,
    hasPreviousState,
    isWithinLookback,
    isRequestedDate,
    force,
}: {
    currentFingerprint: string;
    previousFingerprint?: string;
    hasPreviousState: boolean;
    isWithinLookback: boolean;
    isRequestedDate: boolean;
    force: boolean;
}) {
    if (isRequestedDate) return true;
    if (!isWithinLookback) return false;
    if (force) return true;
    return hasPreviousState && previousFingerprint !== currentFingerprint;
}
