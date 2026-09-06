export function isAuditableShipmentItem(item) {
  if (!item?.shipment_number) return false;
  return !(Number(item.quantity) === 0 && item.quantity_is_explicit === true);
}
