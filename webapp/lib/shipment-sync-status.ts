function normalizedShipmentStatus(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isInvalidShipmentStatus(status: string): boolean {
  return status.toUpperCase() === 'COMPRAR';
}

export function sourceShipmentStatus(value: unknown): string | null {
  const status = normalizedShipmentStatus(value);
  return status !== null && !isInvalidShipmentStatus(status) ? status : null;
}

export function validateManualShipmentStatus(value: unknown): string {
  const status = normalizedShipmentStatus(value);
  if (status === null) {
    throw new Error('El estado del envío es obligatorio.');
  }
  if (isInvalidShipmentStatus(status)) {
    throw new Error('COMPRAR no es un estado válido para un envío.');
  }
  return status;
}

export function shipmentStatusPatch(value: unknown): { status?: string } {
  const status = sourceShipmentStatus(value);
  return status === null ? {} : { status };
}

export function shipmentOrderItemStatusWhere(shipmentIds: number[]) {
  return {
    OR: [
      { shipmentId: { in: shipmentIds } },
      {
        shipmentId: null,
        order: { shipmentId: { in: shipmentIds } },
      },
    ],
  };
}

export function sourceShipmentStatusChanged(existingStatus: string | null, sourceStatus: string | null) {
  return sourceStatus !== null && existingStatus !== sourceStatus;
}
