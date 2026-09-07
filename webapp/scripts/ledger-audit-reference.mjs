function ledgerSearchText(tx) {
  return `${tx.description || ''} ${tx.reference || ''} ${tx.paymentMethod || ''}`.trim();
}

export function shipmentNumberFromTransaction(tx) {
  const reference = String(tx.reference || '').trim();
  const canonical = reference.match(/^SHIP-(\d+)(?::|$)/i);
  if (canonical) return Number(canonical[1]);

  const legacy = ledgerSearchText(tx).match(/(?:ENV[IÍ]O|SHIPMENT|PACKING\s*LIST|\bPL)\s*#?\s*(\d+)/i);
  return legacy ? Number(legacy[1]) : null;
}

export function documentKey(tx) {
  const shipmentNumber = shipmentNumberFromTransaction(tx);
  if (shipmentNumber) return `SHIPMENT:${shipmentNumber}`;

  const invoice = ledgerSearchText(tx).match(/(?:INV(?:OICE)?|PEDIDO|ORDER)\s*#?\s*(\d+)/i);
  return invoice ? `DOCUMENT:${invoice[1]}` : null;
}
