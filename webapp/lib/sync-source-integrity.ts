export type OrderItemCount = {
  orderId: number;
  itemCount: number;
};

export type QuarantinedOrder<T> = {
  order: T;
  orderId: number | null;
  sourceItemCount: number;
  existingItemCount: number;
  reason: 'INCOMPLETE_QUANTITY' | 'ITEM_REDUCTION';
};

export function filterPersistableSourceItems<T extends { quantity?: unknown; quantity_is_explicit?: boolean }>(items: T[]) {
  return items.filter((item) => !(Number(item.quantity) === 0 && item.quantity_is_explicit === true));
}

export function isHistoricalReconciliationEligible(
  orderNumber: number,
  syncedOrderNumbers: Set<number>,
  quarantinedOrderNumbers: Set<number>,
) {
  return !syncedOrderNumbers.has(orderNumber) && !quarantinedOrderNumbers.has(orderNumber);
}

/**
 * A shorter item list is ambiguous: it can be a legitimate deletion or a
 * partial Google Sheets snapshot. Keep that order untouched unless a separate,
 * explicitly destructive reconciliation was authorized.
 */
export function partitionOrdersByItemIntegrity<TItem extends object, T extends {
  order_number: number;
  items?: TItem[];
}>(
  sourceOrders: T[],
  existingByOrderNumber: Map<number, OrderItemCount>,
  allowItemReduction = false,
) {
  const accepted: T[] = [];
  const quarantined: Array<QuarantinedOrder<T>> = [];

  for (const order of sourceOrders) {
    const existing = existingByOrderNumber.get(order.order_number);
    const sourceItemCount = order.items?.length ?? 0;
    if (isStrictCancelledOrder(order)) {
      accepted.push(order);
      continue;
    }
    if (order.items?.some((item) => (item as { quantity_is_explicit?: boolean }).quantity_is_explicit === false)) {
      quarantined.push({
        order,
        orderId: existing?.orderId ?? null,
        sourceItemCount,
        existingItemCount: existing?.itemCount ?? 0,
        reason: 'INCOMPLETE_QUANTITY',
      });
      continue;
    }
    if (existing && !allowItemReduction && sourceItemCount < existing.itemCount) {
      quarantined.push({
        order,
        orderId: existing.orderId,
        sourceItemCount,
        existingItemCount: existing.itemCount,
        reason: 'ITEM_REDUCTION',
      });
      continue;
    }
    accepted.push(order);
  }

  return { accepted, quarantined };
}


export const DEFAULT_INCOMPLETE_ORDER_QUARANTINE_LIMIT = 5;
export const MAX_INCOMPLETE_ORDER_QUARANTINE_LIMIT = 5;

/**
 * Parse the quarantine cap from an operator-controlled environment variable.
 * Invalid, fractional, unsafe, or out-of-range values fail closed instead of
 * disabling the source-integrity guard through NaN or Infinity.
 */
export function parseIncompleteOrderQuarantineLimit(rawValue = process.env.SYNC_INCOMPLETE_ORDER_QUARANTINE_LIMIT) {
  if (rawValue === undefined || rawValue === '') return DEFAULT_INCOMPLETE_ORDER_QUARANTINE_LIMIT;
  if (!/^[1-9]\d*$/.test(rawValue)) {
    throw new Error('SYNC_INCOMPLETE_ORDER_QUARANTINE_LIMIT debe ser un entero positivo.');
  }
  const parsed = Number(rawValue);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_INCOMPLETE_ORDER_QUARANTINE_LIMIT) {
    throw new Error(`SYNC_INCOMPLETE_ORDER_QUARANTINE_LIMIT debe estar entre 1 y ${MAX_INCOMPLETE_ORDER_QUARANTINE_LIMIT}.`);
  }
  return parsed;
}

/**
 * Accept only an explicit cancelled order whose every source line is cancelled
 * and whose header total is zero. Empty or mixed lines remain quarantined.
 */
export function isStrictCancelledOrder<T extends { status?: unknown; total_amount?: unknown; items?: unknown[] }>(order: T) {
  const items = order.items ?? [];
  const rawTotal = order.total_amount;
  const hasZeroTotal = (typeof rawTotal === 'number' && Number.isFinite(rawTotal) && rawTotal === 0)
    || (typeof rawTotal === 'string' && rawTotal.trim() !== '' && Number.isFinite(Number(rawTotal)) && Number(rawTotal) === 0);
  return items.length > 0
    && String(order.status ?? '').trim().toUpperCase() === 'CANCELADO'
    && hasZeroTotal
    && items.every((item) => String((item as { status?: unknown }).status ?? '').trim().toUpperCase() === 'CANCELADO');
}

