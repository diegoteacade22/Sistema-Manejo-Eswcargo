import { GoogleAuth } from 'google-auth-library';

const DEFAULT_SPREADSHEET_ID = '1GhLokb_V5Yok2ubxBg8Tr0jxE3nFkwCD2sMvWDHZ20o';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

type SheetValue = string | number | boolean | null | undefined;

type ValueRange = {
  range?: string;
  values?: SheetValue[][];
};

type BatchGetResponse = {
  valueRanges?: ValueRange[];
};

export type ShipmentSheetCandidate = {
  shipmentId: number;
  shipmentNumber: number;
  orderDates: string[];
};

export type ShipmentSheetSource = {
  cabeNumbers: SheetValue[];
  cabeStatuses: SheetValue[];
  detailDates: SheetValue[];
  detailShipmentNumbers: SheetValue[];
  detailStatuses: SheetValue[];
};

export type ShipmentSheetCellUpdate = {
  range: string;
  previousValue: SheetValue;
  nextValue: string;
  shipmentNumber: number;
  sheet: 'CABE_ENVIOS' | 'DETA_VENTAS';
  row: number;
};

export type ShipmentSheetPlan = {
  spreadsheetId: string;
  canonicalStatus: string;
  updates: ShipmentSheetCellUpdate[];
  cabeRangesByShipment: Record<number, string>;
  detailRangesByShipment: Record<number, string[]>;
};

function statusText(value: SheetValue) {
  return String(value ?? '').trim().toUpperCase();
}

export function canonicalizeShipmentStatus(value: string) {
  const normalized = statusText(value);
  if (['EN BSAS', 'EN 🇦🇷', 'RECIBIDO BSAS', 'ARRIBADO'].includes(normalized)) return 'EN 🇦🇷';
  if (['ENTREGADO', 'FINALIZADO'].includes(normalized)) return 'ENTREGADO';
  return normalized;
}

const STATUS_RANK: Record<string, number> = {
  MIAMI: 0,
  SALIENDO: 1,
  LLEGANDO: 2,
  'EN 🇦🇷': 3,
  ENTREGADO: 4,
};

export function shouldAdvanceAutomatedStatus(currentStatus: string | null | undefined, calculatedStatus: string) {
  const current = canonicalizeShipmentStatus(currentStatus ?? '');
  const calculated = canonicalizeShipmentStatus(calculatedStatus);
  const currentRank = STATUS_RANK[current];
  const calculatedRank = STATUS_RANK[calculated];

  if (currentRank === undefined || calculatedRank === undefined) return current !== calculated;
  return calculatedRank > currentRank;
}

function parseShipmentNumber(value: SheetValue) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const parsed = Number(String(value ?? '').replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function sheetDateKey(value: SheetValue) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const utc = new Date(Math.round((value - 25569) * 86400 * 1000));
    return utc.toISOString().slice(0, 10);
  }

  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const usMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) return `${usMatch[3]}-${usMatch[1].padStart(2, '0')}-${usMatch[2].padStart(2, '0')}`;
  return null;
}

function readColumn(range: ValueRange | undefined): SheetValue[] {
  return (range?.values ?? []).map((row) => row?.[0]);
}

function valuesEqual(left: SheetValue, right: string) {
  return canonicalizeShipmentStatus(String(left ?? '')) === canonicalizeShipmentStatus(right);
}

function assertCompatibleStatus(
  currentValue: SheetValue,
  fromStatus: string,
  toStatus: string,
  range: string,
  allowBlank: boolean
) {
  const current = statusText(currentValue);
  if (!current && allowBlank) return;
  if (valuesEqual(currentValue, fromStatus) || valuesEqual(currentValue, toStatus)) return;
  throw new Error(`Conflicto en ${range}: estado actual "${current || 'VACIO'}".`);
}

export function buildShipmentSheetPlan(
  source: ShipmentSheetSource,
  candidates: ShipmentSheetCandidate[],
  fromStatus: string,
  toStatus: string,
  spreadsheetId = DEFAULT_SPREADSHEET_ID
): ShipmentSheetPlan {
  const canonicalStatus = canonicalizeShipmentStatus(toStatus);
  const candidateByNumber = new Map(candidates.map((candidate) => [candidate.shipmentNumber, candidate]));
  const cabeRows = new Map<number, number[]>();

  source.cabeNumbers.forEach((value, index) => {
    const number = parseShipmentNumber(value);
    if (number === null || !candidateByNumber.has(number)) return;
    const rows = cabeRows.get(number) ?? [];
    rows.push(index + 2);
    cabeRows.set(number, rows);
  });

  const updates: ShipmentSheetCellUpdate[] = [];
  const cabeRangesByShipment: Record<number, string> = {};
  const detailRangesByShipment: Record<number, string[]> = {};

  for (const candidate of candidates) {
    const rows = cabeRows.get(candidate.shipmentNumber) ?? [];
    if (rows.length !== 1) {
      throw new Error(
        `El envio #${candidate.shipmentNumber} tiene ${rows.length} coincidencias en CABE_ENVIOS; se esperaba exactamente una.`
      );
    }
    const row = rows[0];
    const range = `CABE_ENVIOS!X${row}`;
    const previousValue = source.cabeStatuses[row - 2];
    assertCompatibleStatus(previousValue, fromStatus, canonicalStatus, range, true);
    cabeRangesByShipment[candidate.shipmentNumber] = range;
    if (!valuesEqual(previousValue, canonicalStatus)) {
      updates.push({
        range,
        previousValue,
        nextValue: canonicalStatus,
        shipmentNumber: candidate.shipmentNumber,
        sheet: 'CABE_ENVIOS',
        row,
      });
    }
  }

  const detailRowCount = Math.max(
    source.detailDates.length,
    source.detailShipmentNumbers.length,
    source.detailStatuses.length
  );

  for (let index = 0; index < detailRowCount; index += 1) {
    const shipmentNumber = parseShipmentNumber(source.detailShipmentNumbers[index]);
    if (shipmentNumber === null) continue;
    const candidate = candidateByNumber.get(shipmentNumber);
    if (!candidate) continue;

    const rowDate = sheetDateKey(source.detailDates[index]);
    if (!rowDate || !candidate.orderDates.includes(rowDate)) continue;

    const row = index + 2;
    const range = `DETA_VENTAS!M${row}`;
    const previousValue = source.detailStatuses[index];
    assertCompatibleStatus(previousValue, fromStatus, canonicalStatus, range, false);
    detailRangesByShipment[shipmentNumber] ??= [];
    detailRangesByShipment[shipmentNumber].push(range);
    if (!valuesEqual(previousValue, canonicalStatus)) {
      updates.push({
        range,
        previousValue,
        nextValue: canonicalStatus,
        shipmentNumber,
        sheet: 'DETA_VENTAS',
        row,
      });
    }
  }

  for (const candidate of candidates) {
    const detailRanges = detailRangesByShipment[candidate.shipmentNumber] ?? [];
    if (!detailRanges.length) {
      throw new Error(
        `El envio #${candidate.shipmentNumber} no tiene coincidencias en DETA_VENTAS para sus fechas asociadas.`
      );
    }
  }

  return { spreadsheetId, canonicalStatus, updates, cabeRangesByShipment, detailRangesByShipment };
}

function credentialsFromEnvironment() {
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  const raw = encoded
    ? Buffer.from(encoded, 'base64').toString('utf8')
    : process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();

  if (!raw) {
    throw new Error('Falta GOOGLE_SERVICE_ACCOUNT_JSON o GOOGLE_SERVICE_ACCOUNT_JSON_BASE64.');
  }

  const credentials = JSON.parse(raw) as { client_email?: string; private_key?: string };
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('La cuenta de servicio de Google Sheets esta incompleta.');
  }
  credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
  return credentials;
}

function createSheetsAuth() {
  return new GoogleAuth({
    credentials: credentialsFromEnvironment(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function sheetsRequest<T>(
  spreadsheetId: string,
  path: string,
  options: { method?: 'GET' | 'POST'; data?: unknown } = {}
) {
  const auth = createSheetsAuth();
  const response = await auth.request<T>({
    url: `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}${path}`,
    method: options.method ?? 'GET',
    data: options.data,
  });
  return response.data;
}

export async function prepareShipmentSheetPlan(
  candidates: ShipmentSheetCandidate[],
  fromStatus: string,
  toStatus: string
) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() || DEFAULT_SPREADSHEET_ID;
  const ranges = [
    'CABE_ENVIOS!A2:A',
    'CABE_ENVIOS!X2:X',
    'DETA_VENTAS!A2:A',
    'DETA_VENTAS!J2:J',
    'DETA_VENTAS!M2:M',
  ];
  const query = new URLSearchParams({
    majorDimension: 'ROWS',
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  for (const range of ranges) query.append('ranges', range);

  const response = await sheetsRequest<BatchGetResponse>(spreadsheetId, `/values:batchGet?${query.toString()}`);
  const valueRanges = response.valueRanges ?? [];
  if (valueRanges.length !== ranges.length) {
    throw new Error('Google Sheets no devolvio todas las columnas requeridas.');
  }

  return buildShipmentSheetPlan(
    {
      cabeNumbers: readColumn(valueRanges[0]),
      cabeStatuses: readColumn(valueRanges[1]),
      detailDates: readColumn(valueRanges[2]),
      detailShipmentNumbers: readColumn(valueRanges[3]),
      detailStatuses: readColumn(valueRanges[4]),
    },
    candidates,
    fromStatus,
    toStatus,
    spreadsheetId
  );
}

export async function applyShipmentSheetPlan(plan: ShipmentSheetPlan) {
  if (!plan.updates.length) return;
  await sheetsRequest(plan.spreadsheetId, '/values:batchUpdate', {
    method: 'POST',
    data: {
      valueInputOption: 'RAW',
      includeValuesInResponse: false,
      data: plan.updates.map((update) => ({ range: update.range, values: [[update.nextValue]] })),
    },
  });

  const query = new URLSearchParams({ majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE' });
  for (const update of plan.updates) query.append('ranges', update.range);
  const verification = await sheetsRequest<BatchGetResponse>(
    plan.spreadsheetId,
    `/values:batchGet?${query.toString()}`
  );
  const returned = verification.valueRanges ?? [];
  if (returned.length !== plan.updates.length) {
    throw new Error('No se pudieron verificar todas las celdas modificadas.');
  }
  returned.forEach((range, index) => {
    const value = range.values?.[0]?.[0];
    if (!valuesEqual(value, plan.updates[index].nextValue)) {
      throw new Error(`La verificacion fallo en ${plan.updates[index].range}.`);
    }
  });
}

export async function rollbackShipmentSheetPlan(plan: ShipmentSheetPlan) {
  if (!plan.updates.length) return { restored: 0, skipped: [] as string[] };

  const query = new URLSearchParams({ majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE' });
  for (const update of plan.updates) query.append('ranges', update.range);
  const currentResponse = await sheetsRequest<BatchGetResponse>(
    plan.spreadsheetId,
    `/values:batchGet?${query.toString()}`
  );
  const currentRanges = currentResponse.valueRanges ?? [];
  if (currentRanges.length !== plan.updates.length) {
    throw new Error('No se pudieron leer todas las celdas antes del rollback.');
  }

  const safeToRestore: ShipmentSheetCellUpdate[] = [];
  const skipped: string[] = [];
  plan.updates.forEach((update, index) => {
    const currentValue = currentRanges[index].values?.[0]?.[0];
    if (valuesEqual(currentValue, update.nextValue)) {
      safeToRestore.push(update);
      return;
    }
    if (!valuesEqual(currentValue, String(update.previousValue ?? ''))) skipped.push(update.range);
  });

  const valuesToRestore = safeToRestore.filter(
    (update) => update.previousValue !== null
      && update.previousValue !== undefined
      && String(update.previousValue) !== ''
  );
  const rangesToClear = safeToRestore.filter(
    (update) => update.previousValue === null
      || update.previousValue === undefined
      || String(update.previousValue) === ''
  );

  if (valuesToRestore.length) {
    await sheetsRequest(plan.spreadsheetId, '/values:batchUpdate', {
      method: 'POST',
      data: {
        valueInputOption: 'RAW',
        data: valuesToRestore.map((update) => ({ range: update.range, values: [[update.previousValue]] })),
      },
    });
  }
  if (rangesToClear.length) {
    await sheetsRequest(plan.spreadsheetId, '/values:batchClear', {
      method: 'POST',
      data: { ranges: rangesToClear.map((update) => update.range) },
    });
  }

  return { restored: safeToRestore.length, skipped };
}
