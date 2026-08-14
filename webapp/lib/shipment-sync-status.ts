const BUSINESS_TIME_ZONE = 'America/New_York';

export type ShipmentStatus =
  | 'MIAMI'
  | 'SALIENDO'
  | 'LLEGANDO'
  | 'EN BSAS'
  | 'ENTREGADO'
  | 'CANCELADO';

export const SHIPMENT_RELATED_LOGISTICAL_STATUSES = [
  'MIAMI',
  'SALIENDO',
  'SALIENDO MIAMI',
  'LLEGANDO',
  'EN TRANSITO',
  'EN_TRANSITO',
  'EN BSAS',
  'EN 🇦🇷',
  'RECIBIDO BSAS',
  'ARRIBADO',
] as const;

type ShipmentStatusResolution = {
  sourceStatus?: unknown;
  existingStatus?: unknown;
  dateShipped?: Date | string | null;
  dateArrived?: Date | string | null;
  now?: Date;
};

function normalizedShipmentStatus(value: unknown): ShipmentStatus | null {
  const status = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!status) return null;
  if (status === 'MIAMI') return 'MIAMI';
  if (status === 'SALIENDO' || status === 'SALIENDO MIAMI') return 'SALIENDO';
  if (status === 'LLEGANDO' || status === 'EN TRANSITO' || status === 'EN_TRANSITO') return 'LLEGANDO';
  if (['EN BSAS', 'EN 🇦🇷', 'RECIBIDO BSAS', 'ARRIBADO'].includes(status)) return 'EN BSAS';
  if (status === 'ENTREGADO' || status === 'FINALIZADO') return 'ENTREGADO';
  if (status === 'CANCELADO') return 'CANCELADO';
  return null;
}

function storedDateKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function shipmentBusinessDateKey(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function sourceShipmentStatus(value: unknown): ShipmentStatus | null {
  return normalizedShipmentStatus(value);
}

export function unanimousSourceShipmentStatus(values: unknown[]): ShipmentStatus | null {
  if (values.length === 0) return null;
  const statuses = values.map(sourceShipmentStatus);
  if (statuses.some((status) => status === null)) return null;
  const unique = [...new Set(statuses)];
  return unique.length === 1 ? unique[0] : null;
}

export function shouldUseAuthoritativeShipmentHeader(options: {
  shipmentNumber: number;
  status: string | null;
  previousHeaders?: Record<string, string | null>;
  previousAuthority?: Record<string, string>;
}) {
  if (!options.status) return false;
  const key = String(options.shipmentNumber);
  if (options.previousAuthority?.[key] === options.status) return true;
  if (options.previousHeaders === undefined) return false;
  return !Object.prototype.hasOwnProperty.call(options.previousHeaders, key)
    || options.previousHeaders[key] !== options.status;
}

export function resolveShipmentStatus({
  sourceStatus,
  existingStatus,
  dateShipped,
  dateArrived,
  now = new Date(),
}: ShipmentStatusResolution): ShipmentStatus {
  const source = sourceShipmentStatus(sourceStatus);
  const existing = sourceShipmentStatus(existingStatus);
  const explicitStatus = source ?? existing;
  const arrivedKey = storedDateKey(dateArrived);
  const shippedKey = storedDateKey(dateShipped);
  const todayKey = shipmentBusinessDateKey(now);

  if (explicitStatus === 'CANCELADO' || explicitStatus === 'ENTREGADO') {
    return explicitStatus;
  }
  if (arrivedKey && arrivedKey < todayKey) return 'ENTREGADO';
  if (arrivedKey === todayKey) return 'EN BSAS';
  if (explicitStatus) return explicitStatus;
  if (arrivedKey) return 'LLEGANDO';
  if (shippedKey && shippedKey <= todayKey) return 'SALIENDO';
  return 'MIAMI';
}

export function resolveSheetShipmentStatus({
  sourceStatus,
  existingStatus,
  dateShipped,
  dateArrived,
  now = new Date(),
}: ShipmentStatusResolution): ShipmentStatus {
  const explicitSource = sourceShipmentStatus(sourceStatus);
  if (explicitSource) return explicitSource;
  return resolveShipmentStatus({
    existingStatus,
    dateShipped,
    dateArrived,
    now,
  });
}

export function validateManualShipmentStatus(
  value: unknown,
  options: { dateArrived?: Date | string | null; now?: Date } = {},
): ShipmentStatus {
  const status = normalizedShipmentStatus(value);
  if (status === null) {
    throw new Error('El estado del envío no es válido.');
  }
  const requiredStatus = resolveShipmentStatus({
    sourceStatus: status,
    dateArrived: options.dateArrived,
    now: options.now,
  });
  if (requiredStatus !== status) {
    throw new Error(`Con esa fecha real de llegada, el estado debe ser ${requiredStatus}.`);
  }
  return status;
}

export function shipmentStatusPatch(value: unknown): { status?: ShipmentStatus } {
  const status = sourceShipmentStatus(value);
  return status === null ? {} : { status };
}

export function shipmentOrderItemStatusWhere(shipmentIds: number[]) {
  return {
    AND: [
      {
        OR: [
          { shipmentId: { in: shipmentIds } },
          {
            shipmentId: null,
            order: { shipmentId: { in: shipmentIds } },
          },
        ],
      },
      { status: { in: [...SHIPMENT_RELATED_LOGISTICAL_STATUSES] } },
    ],
  };
}

export function shipmentOrderStatusWhere(shipmentIds: number[]) {
  return {
    shipmentId: { in: shipmentIds },
    status: { in: [...SHIPMENT_RELATED_LOGISTICAL_STATUSES] },
  };
}

export function sourceShipmentStatusChanged(existingStatus: string | null, sourceStatus: string | null) {
  return sourceStatus !== null && existingStatus !== sourceStatus;
}
