export function sourceShipmentStatus(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function sourceShipmentStatusChanged(existingStatus: string, sourceStatus: string | null) {
  return sourceStatus !== null && existingStatus !== sourceStatus;
}
