export type OrderItemCount = {
  orderId: number;
  itemCount: number;
};

export type QuarantinedOrder<T> = {
  order: T;
  orderId: number;
  sourceItemCount: number;
  existingItemCount: number;
};

/**
 * A shorter item list is ambiguous: it can be a legitimate deletion or a
 * partial Google Sheets snapshot. Keep that order untouched unless a separate,
 * explicitly destructive reconciliation was authorized.
 */
export function partitionOrdersByItemIntegrity<T extends { order_number: number; items?: unknown[] }>(
  sourceOrders: T[],
  existingByOrderNumber: Map<number, OrderItemCount>,
  allowItemReduction = false,
) {
  const accepted: T[] = [];
  const quarantined: Array<QuarantinedOrder<T>> = [];

  for (const order of sourceOrders) {
    const existing = existingByOrderNumber.get(order.order_number);
    const sourceItemCount = order.items?.length ?? 0;
    if (existing && !allowItemReduction && sourceItemCount < existing.itemCount) {
      quarantined.push({
        order,
        orderId: existing.orderId,
        sourceItemCount,
        existingItemCount: existing.itemCount,
      });
      continue;
    }
    accepted.push(order);
  }

  return { accepted, quarantined };
}
