import { randomUUID } from 'node:crypto';
import { extractionSchema, type Extraction } from './contracts';

const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['supplier', 'items'],
  properties: {
    supplier: { type: ['string', 'null'] },
    items: {
      type: 'array',
      maxItems: 500,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'lineNumber', 'rawLine', 'product', 'exactModel', 'capacity', 'color',
          'condition', 'region', 'costUsd', 'availability', 'quantity', 'observations',
        ],
        properties: {
          lineNumber: { type: 'integer', minimum: 1 },
          rawLine: { type: 'string' },
          product: { type: ['string', 'null'] },
          exactModel: { type: ['string', 'null'] },
          capacity: { type: ['string', 'null'] },
          color: { type: ['string', 'null'] },
          condition: { type: ['string', 'null'] },
          region: { type: ['string', 'null'] },
          costUsd: { type: ['number', 'null'], exclusiveMinimum: 0 },
          availability: { type: ['string', 'null'] },
          quantity: { type: ['integer', 'null'], minimum: 0 },
          observations: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const;

function outputText(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.output_text === 'string') return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const message of output as Array<{ content?: Array<{ type?: string; text?: string }> }>) {
    const text = message.content?.find((part) => part.type === 'output_text')?.text;
    if (text) return text;
  }
}

function refusal(payload: Record<string, unknown>): string | undefined {
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const message of output as Array<{ content?: Array<{ type?: string; refusal?: string }> }>) {
    const part = message.content?.find((content) => content.type === 'refusal');
    if (part?.refusal) return part.refusal;
  }
}

function retryDelay(response: Response, attempt: number) {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1_000, 10_000);
  return Math.min(500 * (2 ** attempt), 4_000);
}

async function requestOpenAI(apiKey: string, body: Record<string, unknown>) {
  const clientRequestId = randomUUID();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Client-Request-Id': clientRequestId,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (response.ok || !retryable || attempt === 2) return response;
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
    }
  }
  throw new Error('OpenAI no respondió después de los reintentos permitidos.');
}

export async function extractSupplierList(rawText: string): Promise<{ extraction: Extraction; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY no está configurada en el servidor.');
  const model = process.env.OPENAI_INGESTION_MODEL?.trim() || 'gpt-4.1-mini-2025-04-14';
  const response = await requestOpenAI(apiKey, {
      model,
      store: false,
      instructions: [
        'Extrae literalmente listas comerciales de proveedores.',
        'No completes ni infieras datos ausentes.',
        'Devuelve un item por línea o producto.',
        'Todos los campos faltantes deben ser null.',
        'costUsd es solamente el costo USD explícito.',
        'rawLine debe copiar exactamente la línea fuente y lineNumber debe ser su número real, empezando en 1.',
      ].join(' '),
      input: rawText,
      text: {
        format: {
          type: 'json_schema',
          name: 'supplier_price_list',
          strict: true,
          schema: JSON_SCHEMA,
        },
      },
  });
  if (!response.ok) {
    const requestId = response.headers.get('x-request-id');
    throw new Error(`OpenAI respondió ${response.status}${requestId ? ` (request ${requestId})` : ''}.`);
  }
  const payload = await response.json() as Record<string, unknown>;
  if (payload.status !== 'completed') {
    const reason = (payload.incomplete_details as { reason?: string } | null)?.reason;
    throw new Error(`OpenAI no completó la respuesta${reason ? ` (${reason})` : ''}.`);
  }
  if (refusal(payload)) throw new Error('OpenAI rechazó procesar la entrada.');
  const text = outputText(payload);
  if (!text) throw new Error('OpenAI no devolvió una salida estructurada.');
  try {
    return { extraction: extractionSchema.parse(JSON.parse(text)), model };
  } catch (error) {
    throw new Error('OpenAI devolvió una salida que no cumple el contrato.', { cause: error });
  }
}
