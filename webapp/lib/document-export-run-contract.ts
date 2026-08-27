export function assertSelectedOrderObserved(selectedOrderId: number | null, observedOrders: number) {
    if (selectedOrderId === null) return;
    if (observedOrders !== 1) {
        throw new Error('La selección export-one debe resolver exactamente una orden.');
    }
}

export function assertSelectedShipmentObserved(selectedShipmentId: number | null, observedShipments: number) {
    if (selectedShipmentId === null) return;
    if (observedShipments !== 1) {
        throw new Error('La selección de shipment debe resolver exactamente un envío.');
    }
}

export function assertDriveBootstrapReady({
    targetName,
    hasPreviousState,
    dryRun,
    selectedOrderId,
    selectedShipmentId,
}: {
    targetName: string;
    hasPreviousState: boolean;
    dryRun: boolean;
    selectedOrderId: number | null;
    selectedShipmentId: number | null;
}) {
    const isFullDriveExport = targetName === 'drive'
        && !dryRun
        && selectedOrderId === null
        && selectedShipmentId === null;
    if (isFullDriveExport && !hasPreviousState) {
        throw new Error('Falta el manifiesto Drive: ejecutá y verificá export-one antes del export completo.');
    }
}

export function selectedOrderExitCode({
    selectedOrderId,
    selectedShipmentId = null,
    dryRun,
    exported,
    failureCount,
}: {
    selectedOrderId: number | null;
    selectedShipmentId?: number | null;
    dryRun: boolean;
    exported: number;
    failureCount: number;
}) {
    if (selectedOrderId !== null && !dryRun && (exported !== 1 || failureCount !== 0)) return 1;
    if (failureCount > 0) return 2;
    if (selectedShipmentId !== null && !dryRun && exported < 1) return 1;
    return 0;
}

export function shouldPersistDocumentExportState({
    dryRun,
    selectedOrderId,
    selectedShipmentId,
    exitCode,
}: {
    dryRun: boolean;
    selectedOrderId: number | null;
    selectedShipmentId: number | null;
    exitCode: number;
}) {
    const failedSelection = (selectedOrderId !== null || selectedShipmentId !== null) && exitCode !== 0;
    return !dryRun && !failedSelection;
}

export function sanitizeDocumentExportFatalError(value: string) {
    return value
        .replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://[REDACTED]')
        .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
        .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED_KEY]');
}
