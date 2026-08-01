import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { GoogleAuth } from 'google-auth-library';

const APPLY = process.argv.includes('--apply');
const credentialsArg = process.argv.find((arg) => arg.startsWith('--credentials-file='));
const credentialsFile = credentialsArg?.slice('--credentials-file='.length);
const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '1GhLokb_V5Yok2ubxBg8Tr0jxE3nFkwCD2sMvWDHZ20o';
const repairOperationId = '8a2337af-5852-472e-88f4-2056348c3dc6';
const massChangeStart = new Date('2026-08-01T03:09:00.000Z');
const massChangeEnd = new Date('2026-08-01T03:10:00.000Z');

const repairedTargets = new Map([
  [1251, 'SALIENDO'], [1250, 'SALIENDO'], [1249, 'SALIENDO'], [1248, 'SALIENDO'], [1247, 'SALIENDO'],
  [1246, 'EN 🇦🇷'], [1245, 'EN 🇦🇷'], [1244, 'EN 🇦🇷'], [1243, 'EN 🇦🇷'], [1242, 'EN 🇦🇷'],
]);

function canonical(value) {
  const status = String(value ?? '').trim().toUpperCase();
  return ['EN BSAS', 'EN 🇦🇷', 'RECIBIDO BSAS', 'ARRIBADO'].includes(status) ? 'EN 🇦🇷' : status;
}

function parseNumber(value) {
  const parsed = Number(String(value ?? '').replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

async function loadCredentials() {
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  const raw = encoded
    ? Buffer.from(encoded, 'base64').toString('utf8')
    : process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
      || (credentialsFile ? await readFile(credentialsFile, 'utf8') : '');
  if (!raw) throw new Error('Faltan credenciales de Google Sheets.');
  const credentials = JSON.parse(raw);
  credentials.private_key = String(credentials.private_key || '').replace(/\\n/g, '\n');
  return credentials;
}

const auth = new GoogleAuth({
  credentials: await loadCredentials(),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheetsBase = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;

async function sheetsRequest(path, options = {}) {
  const response = await auth.request({
    url: `${sheetsBase}${path}`,
    method: options.method || 'GET',
    data: options.data,
  });
  return response.data;
}

async function readRanges(ranges) {
  const query = new URLSearchParams({ majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE' });
  ranges.forEach((range) => query.append('ranges', range));
  const response = await sheetsRequest(`/values:batchGet?${query}`);
  const returned = response.valueRanges || [];
  if (returned.length !== ranges.length) throw new Error(`Sheets devolvió ${returned.length} de ${ranges.length} rangos.`);
  return returned.map((range) => range.values?.[0]?.[0] ?? '');
}

async function writeValues(updates, valueKey) {
  if (!updates.length) return;
  await sheetsRequest('/values:batchUpdate', {
    method: 'POST',
    data: {
      valueInputOption: 'RAW',
      data: updates.map((update) => ({ range: update.range, values: [[update[valueKey]]] })),
    },
  });
}

async function clearRanges(updates) {
  if (!updates.length) return;
  await sheetsRequest('/values:batchClear', {
    method: 'POST',
    data: { ranges: updates.map((update) => update.range) },
  });
}

async function verify(updates, valueKey) {
  if (!updates.length) return;
  const values = await readRanges(updates.map((update) => update.range));
  updates.forEach((update, index) => {
    if (canonical(values[index]) !== canonical(update[valueKey])) {
      throw new Error(`Falló la verificación de ${update.range}: "${values[index]}".`);
    }
  });
}

const prisma = new PrismaClient();

try {
  const repairNumbers = [...repairedTargets.keys()];
  const repairedShipments = await prisma.shipment.findMany({
    where: { shipment_number: { in: repairNumbers } },
    select: { id: true, shipment_number: true, status: true, date_shipped: true },
    orderBy: { shipment_number: 'desc' },
  });
  if (repairedShipments.length !== repairNumbers.length) throw new Error('No se encontraron los 10 envíos de la reparación anterior.');
  for (const shipment of repairedShipments) {
    const expected = repairedTargets.get(shipment.shipment_number);
    if (canonical(shipment.status) !== canonical(expected) && canonical(shipment.status) !== 'COMPRAR') {
      throw new Error(`#${shipment.shipment_number} cambió después de la reparación: ${shipment.status}.`);
    }
  }

  const massChangedShipments = await prisma.shipment.findMany({
    where: {
      status: 'EN 🇦🇷',
      updatedAt: { gte: massChangeStart, lt: massChangeEnd },
    },
    select: { id: true, shipment_number: true, status: true, date_shipped: true, updatedAt: true },
    orderBy: { shipment_number: 'desc' },
  });
  if (massChangedShipments.length !== 40) {
    throw new Error(`El lote sin alcance ya no coincide: se esperaban 40 envíos y hay ${massChangedShipments.length}.`);
  }

  const auditRows = await prisma.$queryRaw`
    select shipment_number, details
    from public.shipment_status_change_log
    where operation_id = ${repairOperationId}::uuid and event_type = 'COMPLETED'
    order by shipment_number
  `;
  if (auditRows.length !== 10) throw new Error(`La auditoría anterior tiene ${auditRows.length} cierres; se esperaban 10.`);

  const columns = await (() => {
    const ranges = ['CABE_ENVIOS!A2:A', 'CABE_ENVIOS!X2:X'];
    const query = new URLSearchParams({ majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE' });
    ranges.forEach((range) => query.append('ranges', range));
    return sheetsRequest(`/values:batchGet?${query}`).then((response) => (response.valueRanges || []).map((column) => (column.values || []).map((row) => row?.[0])));
  })();
  if (columns.length !== 2) throw new Error('No se pudieron leer CABE_ENVIOS A/X.');

  const cabeRollback = [];
  for (const number of repairNumbers) {
    const rows = [];
    columns[0].forEach((value, index) => {
      if (parseNumber(value) === number) rows.push(index + 2);
    });
    if (rows.length !== 1) throw new Error(`#${number}: ${rows.length} coincidencias en CABE_ENVIOS.`);
    const range = `CABE_ENVIOS!X${rows[0]}`;
    const current = columns[1][rows[0] - 2] ?? '';
    const expected = repairedTargets.get(number);
    if (canonical(current) !== canonical(expected) && canonical(current) !== '') {
      throw new Error(`${range} cambió después de nuestra operación: "${current}".`);
    }
    if (canonical(current) === canonical(expected)) cabeRollback.push({ range, previous: expected, next: '', number });
  }

  const detaRanges = auditRows
    .filter((row) => repairedTargets.get(row.shipment_number) === 'EN 🇦🇷')
    .flatMap((row) => (row.details?.detaRanges || []).map((range) => ({ range, number: row.shipment_number })));
  const detaValues = await readRanges(detaRanges.map((row) => row.range));
  const detaRollback = [];
  detaRanges.forEach((row, index) => {
    const current = detaValues[index];
    if (canonical(current) !== 'EN 🇦🇷' && canonical(current) !== 'LLEGANDO') {
      throw new Error(`${row.range} cambió después de nuestra operación: "${current}".`);
    }
    if (canonical(current) === 'EN 🇦🇷') detaRollback.push({ ...row, previous: 'EN 🇦🇷', next: 'LLEGANDO' });
  });

  console.log(JSON.stringify({
    rollbackLoggedOperation: repairedShipments.map((row) => row.shipment_number),
    rollbackUnscopedBatch: massChangedShipments.map((row) => row.shipment_number),
    sheetCells: [...cabeRollback.map((row) => row.range), ...detaRollback.map((row) => row.range)],
  }, null, 2));

  if (!APPLY) {
    console.log('PREVIEW_ONLY: no se modificó DB ni Google Sheets.');
    process.exitCode = 2;
  } else {
    const rollbackOperationId = randomUUID();
    let sheetsWritten = false;
    try {
      await clearRanges(cabeRollback);
      await writeValues(detaRollback, 'next');
      sheetsWritten = true;
      await verify(cabeRollback, 'next');
      await verify(detaRollback, 'next');

      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          select 1::int as locked
          from (select pg_advisory_xact_lock(hashtextextended('rollback-shipment-statuses-20260801', 0))) acquired
        `;

        for (const shipment of repairedShipments) {
          const expected = repairedTargets.get(shipment.shipment_number);
          if (canonical(shipment.status) === 'COMPRAR') continue;
          const changed = await tx.shipment.updateMany({
            where: { id: shipment.id, status: expected },
            data: { status: 'COMPRAR' },
          });
          if (changed.count !== 1) throw new Error(`#${shipment.shipment_number} cambió durante el rollback.`);
        }

        const arrivedIds = repairedShipments
          .filter((row) => repairedTargets.get(row.shipment_number) === 'EN 🇦🇷')
          .map((row) => row.id);
        await tx.order.updateMany({ where: { shipmentId: { in: arrivedIds }, status: 'EN 🇦🇷' }, data: { status: 'LLEGANDO' } });
        await tx.orderItem.updateMany({
          where: {
            status: 'EN 🇦🇷',
            OR: [{ shipmentId: { in: arrivedIds } }, { order: { shipmentId: { in: arrivedIds } } }],
          },
          data: { status: 'LLEGANDO' },
        });

        const massChanged = await tx.shipment.updateMany({
          where: {
            id: { in: massChangedShipments.map((row) => row.id) },
            status: 'EN 🇦🇷',
            updatedAt: { gte: massChangeStart, lt: massChangeEnd },
          },
          data: { status: 'COMPRAR' },
        });
        if (massChanged.count !== 40) throw new Error(`El lote cambió durante el rollback: ${massChanged.count}/40.`);

        const allRows = [
          ...repairedShipments.map((row) => ({ ...row, from: repairedTargets.get(row.shipment_number), reason: `rollbackOf:${repairOperationId}` })),
          ...massChangedShipments.map((row) => ({ ...row, from: 'EN 🇦🇷', reason: 'rollbackOf:unscoped-batch-2026-08-01T03:09Z' })),
        ];
        for (const row of allRows) {
          const details = JSON.stringify({ reason: row.reason, scope: 'exact-recorded-change-only' });
          await tx.$executeRaw(Prisma.sql`
            insert into public.shipment_status_change_log (
              operation_id, shipment_id, shipment_number, actor_name, selected_date,
              from_status, to_status, event_type, details
            ) values (
              ${rollbackOperationId}::uuid, ${row.id}, ${row.shipment_number}, 'Codex rollback',
              ${row.date_shipped.toISOString().slice(0, 10)}::date,
              ${row.from}, 'COMPRAR', 'ROLLED_BACK', ${details}::jsonb
            )
          `);
        }
      }, { maxWait: 10_000, timeout: 60_000 });
    } catch (error) {
      if (sheetsWritten) {
        await writeValues(cabeRollback, 'previous');
        await writeValues(detaRollback, 'previous');
        await verify(cabeRollback, 'previous');
        await verify(detaRollback, 'previous');
      }
      throw error;
    }

    const allIds = [...repairedShipments, ...massChangedShipments].map((row) => row.id);
    const verified = await prisma.shipment.findMany({
      where: { id: { in: allIds } },
      select: { shipment_number: true, status: true },
    });
    const invalid = verified.filter((row) => canonical(row.status) !== 'COMPRAR');
    if (invalid.length) throw new Error(`Falló la verificación DB: ${JSON.stringify(invalid)}`);
    await verify(cabeRollback, 'next');
    await verify(detaRollback, 'next');
    const auditCount = await prisma.$queryRaw`
      select count(*)::int as count from public.shipment_status_change_log where operation_id = ${rollbackOperationId}::uuid
    `;
    console.log(`ROLLED_BACK operation=${rollbackOperationId} shipments=${verified.length} auditRows=${auditCount[0]?.count ?? 0}`);
  }
} finally {
  await prisma.$disconnect();
}
