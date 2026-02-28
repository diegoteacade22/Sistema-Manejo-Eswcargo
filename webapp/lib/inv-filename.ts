export function toInvNumber4(rawValue: unknown, fallbackValue: unknown): string {
    const rawDigits = String(rawValue ?? '').replace(/\D/g, '');
    const fallbackDigits = String(fallbackValue ?? '').replace(/\D/g, '');
    const selected = rawDigits || fallbackDigits || '0';
    const lastFour = selected.slice(-4);
    return lastFour.padStart(4, '0');
}

export function toInvFileName(rawValue: unknown, fallbackValue: unknown): string {
    return `INV ${toInvNumber4(rawValue, fallbackValue)}.pdf`;
}