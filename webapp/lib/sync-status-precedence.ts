export function normalizedOrderStatus(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw || ['NAN', 'NONE', 'NULL'].includes(raw.toUpperCase())) return null;
  const text = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (text.includes('CANCELADO')) return 'CANCELADO';
  if (text.includes('ENTREGADO') || text.includes('FINALIZADO')) return 'ENTREGADO';
  if (text.includes('BSAS') || text.includes('RECIBIDO')) return 'EN BSAS';
  if (text.includes('TRANSITO')) return 'EN TRANSITO';
  if (text.includes('LLEGANDO')) return 'LLEGANDO';
  if (text.includes('SALIENDO')) return 'SALIENDO';
  if (text.includes('MIAMI')) return 'MIAMI';
  if (text.includes('ENCARGADO')) return 'ENCARGADO';
  if (text.includes('COMPRAR')) return 'COMPRAR';
  return raw.toUpperCase();
}

export function effectiveSourceOrderStatus(
  headerStatus: unknown,
  itemStatuses: unknown[],
): string | null {
  const header = normalizedOrderStatus(headerStatus);
  if (header) return header;
  if (itemStatuses.length === 0) return null;
  const normalizedItems = itemStatuses.map(normalizedOrderStatus);
  if (normalizedItems.some((status) => status === null)) return null;
  const unique = [...new Set(normalizedItems)];
  return unique.length === 1 ? unique[0] : null;
}
