export function isCancelledInvoiceItem(item) {
  return String(item?.status || '').trim().toUpperCase() === 'CANCELADO';
}

export function activeInvoiceItems(items) {
  return (items || []).filter((item) => !isCancelledInvoiceItem(item) && Number(item?.quantity || 0) > 0);
}

export function activeInvoiceTotal(items) {
  return activeInvoiceItems(items).reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0),
    0,
  );
}
