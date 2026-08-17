export type IngestRequest = {
  text: string;
  supplier?: string;
  receivedAt?: string;
  idempotencyKey?: string;
};

export type ExtractedItem = {
  lineNumber: number;
  rawLine: string;
  product: string | null;
  exactModel: string | null;
  capacity: string | null;
  color: string | null;
  condition: string | null;
  region: string | null;
  costUsd: number | null;
  availability: string | null;
  quantity: number | null;
  observations: string | null;
};

export type Extraction = { supplier: string | null; items: ExtractedItem[] };

export class ContractValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractValidationError';
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractValidationError(`${label} debe ser un objeto.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) {
    throw new ContractValidationError(`${label} contiene campos inesperados: ${unexpected.join(', ')}.`);
  }
}

function text(value: unknown, label: string, max = Infinity): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new ContractValidationError(`${label} no es válido.`);
  }
  return value.trim();
}

function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label);
}

function nullableNumber(value: unknown, label: string, integer = false, allowZero = false): number | null {
  if (value === null) return null;
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || (integer && !Number.isInteger(value))
    || (allowZero ? value < 0 : value <= 0)
  ) {
    throw new ContractValidationError(`${label} no es válido.`);
  }
  return value;
}

export const ingestRequestSchema = {
  parse(value: unknown): IngestRequest {
    const input = object(value, 'request');
    exactKeys(input, ['text', 'supplier', 'receivedAt', 'idempotencyKey'], 'request');
    const result: IngestRequest = { text: text(input.text, 'text', 100_000) };
    if (input.supplier !== undefined) result.supplier = text(input.supplier, 'supplier', 200);
    if (input.idempotencyKey !== undefined) {
      const key = text(input.idempotencyKey, 'idempotencyKey', 200);
      if (key.length < 8) throw new ContractValidationError('idempotencyKey no es válido.');
      result.idempotencyKey = key;
    }
    if (input.receivedAt !== undefined) {
      const receivedAt = text(input.receivedAt, 'receivedAt');
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(receivedAt)
        || Number.isNaN(Date.parse(receivedAt))
      ) {
        throw new ContractValidationError('receivedAt debe ser una fecha ISO 8601 con zona horaria.');
      }
      result.receivedAt = receivedAt;
    }
    return result;
  },
};

const ITEM_KEYS = [
  'lineNumber', 'rawLine', 'product', 'exactModel', 'capacity', 'color',
  'condition', 'region', 'costUsd', 'availability', 'quantity', 'observations',
] as const;

function extractedItem(value: unknown, index: number): ExtractedItem {
  const item = object(value, `items[${index}]`);
  exactKeys(item, ITEM_KEYS, `items[${index}]`);
  for (const key of ITEM_KEYS) {
    if (!(key in item)) throw new ContractValidationError(`items[${index}].${key} es requerido.`);
  }
  const lineNumber = nullableNumber(item.lineNumber, `items[${index}].lineNumber`, true);
  if (lineNumber === null) throw new ContractValidationError(`items[${index}].lineNumber es requerido.`);
  return {
    lineNumber,
    rawLine: text(item.rawLine, `items[${index}].rawLine`),
    product: nullableText(item.product, 'product'),
    exactModel: nullableText(item.exactModel, 'exactModel'),
    capacity: nullableText(item.capacity, 'capacity'),
    color: nullableText(item.color, 'color'),
    condition: nullableText(item.condition, 'condition'),
    region: nullableText(item.region, 'region'),
    costUsd: nullableNumber(item.costUsd, 'costUsd'),
    availability: nullableText(item.availability, 'availability'),
    quantity: nullableNumber(item.quantity, 'quantity', true, true),
    observations: nullableText(item.observations, 'observations'),
  };
}

export const extractionSchema = {
  parse(value: unknown): Extraction {
    const extraction = object(value, 'extraction');
    exactKeys(extraction, ['supplier', 'items'], 'extraction');
    if (!('supplier' in extraction) || !Array.isArray(extraction.items) || extraction.items.length > 500) {
      throw new ContractValidationError('La extracción no cumple el contrato.');
    }
    return {
      supplier: nullableText(extraction.supplier, 'supplier'),
      items: extraction.items.map(extractedItem),
    };
  },
};
