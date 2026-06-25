type LedgerText = {
  description?: string | null;
  reference?: string | null;
  paymentMethod?: string | null;
};

const ORDER_CHARGE_PATTERN = /(order\s*#?|pedido\s*#?|inv\s*#?|invoice\s*#?)/i;
const SHIPMENT_CHARGE_PATTERN = /(env[ií]o\s*#?|flete|carga\s*#?)/i;
const ADJUSTMENT_PATTERN = /(ajuste|baseline|opening|neutraliz|duplicate|final-adj|saldo a cero|saldada|zero)/i;
const QUARANTINED_REFERENCE_PATTERN = /^CC-Import-/i;

export function ledgerSearchText(tx: LedgerText) {
  return `${tx.description || ''} ${tx.reference || ''} ${tx.paymentMethod || ''}`.trim();
}

export function isAdjustmentTransaction(tx: LedgerText) {
  return ADJUSTMENT_PATTERN.test(ledgerSearchText(tx));
}

export function isQuarantinedLedgerTransaction(tx: LedgerText) {
  return QUARANTINED_REFERENCE_PATTERN.test(String(tx.reference || '').trim());
}

export function isOrderCharge(tx: LedgerText & { type?: string | null; amount?: number | null }) {
  return tx.type === 'CARGO' && (tx.amount || 0) < 0 && ORDER_CHARGE_PATTERN.test(ledgerSearchText(tx));
}

export function isShipmentCharge(tx: LedgerText & { type?: string | null; amount?: number | null }) {
  return tx.type === 'CARGO' && (tx.amount || 0) < 0 && SHIPMENT_CHARGE_PATTERN.test(ledgerSearchText(tx));
}

export function isOperationalCharge(tx: LedgerText & { type?: string | null; amount?: number | null }) {
  return tx.type === 'CARGO' && (tx.amount || 0) < 0 && !isAdjustmentTransaction(tx);
}
