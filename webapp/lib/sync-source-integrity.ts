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
