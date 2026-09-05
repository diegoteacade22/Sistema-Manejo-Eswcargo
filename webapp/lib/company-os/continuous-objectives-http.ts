export const CONTINUOUS_OBJECTIVE_MAX_BODY_BYTES = 32_768;

export class ContinuousObjectiveRequestError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

type CreateRequest = {
  action: 'CREATE'; title: string; objective: string; durationDays: number;
  projectAllowlist: string[]; externalSources: string[]; criteria: string[]; idempotencyKey: string;
};
type ControlRequest = {
  action: 'PAUSE' | 'RESUME' | 'END'; objectiveId: string; expectedVersion: number; expectedControlRevision: number; idempotencyKey: string;
};

function text(value: unknown, name: string, min: number, max: number) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    throw new ContinuousObjectiveRequestError(`${name}: se requieren entre ${min} y ${max} caracteres.`);
  }
  return value.trim();
}

function textList(value: unknown, name: string, maxItems: number, minLength: number, maxLength: number) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) {
    throw new ContinuousObjectiveRequestError(`${name}: elegí entre 1 y ${maxItems} elementos.`);
  }
  const values = value.map((item) => text(item, name, minLength, maxLength));
  if (new Set(values).size !== values.length) throw new ContinuousObjectiveRequestError(`${name}: hay elementos repetidos.`);
  return values;
}

function optionalTextList(value: unknown, name: string, maxItems: number, minLength: number, maxLength: number) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new ContinuousObjectiveRequestError(`${name}: elegí hasta ${maxItems} elementos.`);
  }
  const values = value.map((item) => text(item, name, minLength, maxLength));
  if (new Set(values).size !== values.length) throw new ContinuousObjectiveRequestError(`${name}: hay elementos repetidos.`);
  return values;
}

export function parseContinuousObjectiveRequest(value: unknown): CreateRequest | ControlRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContinuousObjectiveRequestError('El cuerpo debe ser un objeto JSON.');
  const input = value as Record<string, unknown>;
  const idempotencyKey = text(input.idempotencyKey, 'Clave de operación', 16, 160);
  if (!/^[A-Za-z0-9:_-]+$/.test(idempotencyKey)) throw new ContinuousObjectiveRequestError('Clave de operación inválida.');
  const keys = input.action === 'CREATE'
    ? ['action', 'title', 'objective', 'durationDays', 'projectAllowlist', 'externalSources', 'criteria', 'idempotencyKey']
    : ['action', 'objectiveId', 'expectedVersion', 'expectedControlRevision', 'idempotencyKey'];
  if (Object.keys(input).some((key) => !keys.includes(key))) throw new ContinuousObjectiveRequestError('La solicitud contiene campos no permitidos.');
  if (input.action === 'CREATE') {
    if (!Number.isInteger(input.durationDays) || Number(input.durationDays) < 1 || Number(input.durationDays) > 30) {
      throw new ContinuousObjectiveRequestError('La duración debe ser de 1 a 30 días.');
    }
    const projectAllowlist = optionalTextList(input.projectAllowlist, 'Proyectos', 20, 1, 160);
    const externalSources = optionalTextList(input.externalSources, 'Fuentes externas', 4, 1, 40);
    if (projectAllowlist.length === 0 && externalSources.length === 0) {
      throw new ContinuousObjectiveRequestError('Seleccioná al menos un proyecto o una fuente externa.');
    }
    return {
      action: 'CREATE', idempotencyKey,
      title: text(input.title, 'Título', 3, 160),
      objective: text(input.objective, 'Objetivo', 10, 4_000),
      durationDays: Number(input.durationDays),
      projectAllowlist,
      externalSources,
      criteria: textList(input.criteria, 'Criterios', 12, 3, 500),
    };
  }
  if (input.action !== 'PAUSE' && input.action !== 'RESUME' && input.action !== 'END') throw new ContinuousObjectiveRequestError('Acción no permitida.');
  if (!Number.isInteger(input.expectedVersion) || Number(input.expectedVersion) < 1) throw new ContinuousObjectiveRequestError('La versión del objetivo es obligatoria.');
  if (!Number.isInteger(input.expectedControlRevision) || Number(input.expectedControlRevision) < 0) throw new ContinuousObjectiveRequestError('La revisión de control es obligatoria.');
  return {
    action: input.action, idempotencyKey,
    objectiveId: text(input.objectiveId, 'Objetivo', 1, 180),
    expectedVersion: Number(input.expectedVersion),
    expectedControlRevision: Number(input.expectedControlRevision),
  };
}

export async function readContinuousObjectiveJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new ContinuousObjectiveRequestError('Se requiere contenido JSON.', 415);
  }
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > CONTINUOUS_OBJECTIVE_MAX_BODY_BYTES)) {
    throw new ContinuousObjectiveRequestError('Solicitud demasiado grande o longitud inválida.', 413);
  }
  if (!request.body) throw new ContinuousObjectiveRequestError('El cuerpo JSON está vacío.');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > CONTINUOUS_OBJECTIVE_MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ContinuousObjectiveRequestError('Solicitud demasiado grande.', 413);
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } finally { reader.releaseLock(); }
  try { return JSON.parse(body); }
  catch { throw new ContinuousObjectiveRequestError('JSON inválido.'); }
}
