const EPSILON = 0.005;

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function day(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  const iso = text.match(/^\d{4}-\d{2}-\d{2}/);
  return iso ? iso[0] : text;
}

function text(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function contentKey(row) {
  return [day(row.date), String(row.type || '').toUpperCase(), round(row.amount), text(row.description)].join('|');
}

function exact(transaction, row) {
  return transaction.type === row.type && Math.abs(transaction.amount - row.amount) <= EPSILON;
}

function opposite(transaction, row) {
  return transaction.type !== row.type && Math.abs(transaction.amount + row.amount) <= EPSILON;
}

export function reconcileCashflowRows(sourceRows, rawTransactions) {
  const rawByReference = new Map();
  for (const transaction of rawTransactions) {
    const group = rawByReference.get(transaction.reference) || [];
    group.push(transaction);
    rawByReference.set(transaction.reference, group);
  }

  const matchedRawIds = new Set();
  const unresolvedSource = [];
  const result = {
    exactRows: 0,
    relocatedRows: 0,
    oppositeSignRows: 0,
    changedRows: 0,
    missingRows: 0,
    duplicateReferenceRows: 0,
    extraRows: 0,
    samples: { relocated: [], oppositeSign: [], missing: [], changed: [], duplicateReference: [], extra: [] },
  };

  for (const row of sourceRows) {
    const candidates = rawByReference.get(row.reference) || [];
    if (candidates.length > 1) {
      result.duplicateReferenceRows += candidates.length - 1;
      if (result.samples.duplicateReference.length < 5) {
        result.samples.duplicateReference.push({
          reference: row.reference,
          transactionIds: candidates.map((item) => item.id),
        });
      }
    }
    const exactMatch = candidates.find((transaction) => !matchedRawIds.has(transaction.id) && exact(transaction, row));
    if (exactMatch) {
      matchedRawIds.add(exactMatch.id);
      result.exactRows += 1;
    } else {
      unresolvedSource.push({ row, candidates });
    }
  }

  const rawByContent = new Map();
  for (const transaction of rawTransactions) {
    if (matchedRawIds.has(transaction.id)) continue;
    const key = contentKey(transaction);
    const group = rawByContent.get(key) || [];
    group.push(transaction);
    rawByContent.set(key, group);
  }

  const stillUnresolved = [];
  for (const pending of unresolvedSource) {
    const candidates = rawByContent.get(contentKey(pending.row)) || [];
    const relocated = candidates.find((transaction) => !matchedRawIds.has(transaction.id));
    if (!relocated) {
      stillUnresolved.push(pending);
      continue;
    }
    matchedRawIds.add(relocated.id);
    result.relocatedRows += 1;
    if (result.samples.relocated.length < 5) {
      result.samples.relocated.push({
        sourceReference: pending.row.reference,
        storedReference: relocated.reference,
        transactionId: relocated.id,
      });
    }
  }

  for (const { row, candidates } of stillUnresolved) {
    const transaction = candidates.find((item) => !matchedRawIds.has(item.id));
    if (!transaction) {
      result.missingRows += 1;
      if (result.samples.missing.length < 5) result.samples.missing.push(row.reference);
    } else if (opposite(transaction, row)) {
      matchedRawIds.add(transaction.id);
      result.oppositeSignRows += 1;
      if (result.samples.oppositeSign.length < 5) result.samples.oppositeSign.push(row.reference);
    } else {
      matchedRawIds.add(transaction.id);
      result.changedRows += 1;
      if (result.samples.changed.length < 5) {
        result.samples.changed.push({
          reference: row.reference,
          expected: { type: row.type, amount: row.amount },
          actual: { id: transaction.id, type: transaction.type, amount: transaction.amount },
        });
      }
    }
  }

  const extras = rawTransactions.filter((transaction) => !matchedRawIds.has(transaction.id));
  result.extraRows = extras.length;
  for (const transaction of extras.slice(0, 5)) {
    result.samples.extra.push({ id: transaction.id, reference: transaction.reference, amount: transaction.amount });
  }
  return result;
}
