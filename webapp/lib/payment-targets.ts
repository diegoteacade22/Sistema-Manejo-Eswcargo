export type PaymentTargetKind = 'ORDER' | 'SHIPMENT';

export type PaymentTarget = {
    kind: PaymentTargetKind;
    id: number;
};

export function paymentTargetPrefix(target: PaymentTarget) {
    return `PAYMENT-${target.kind}:${target.id}`;
}

export function paymentTargetReference(target: PaymentTarget, externalReference?: string | null) {
    const suffix = String(externalReference || 'MANUAL')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 120) || 'MANUAL';
    return `${paymentTargetPrefix(target)}:${suffix}`;
}

export function paymentTargetFromReference(reference?: string | null) {
    const match = String(reference || '').match(/^PAYMENT-(ORDER|SHIPMENT):(\d+):/i);
    if (!match) return null;
    return { kind: match[1].toUpperCase() as PaymentTargetKind, id: Number(match[2]) };
}

export function paymentTargetLabel(reference?: string | null) {
    const target = paymentTargetFromReference(reference);
    if (!target) return null;
    return target.kind === 'ORDER' ? `Pedido #${target.id}` : `Envío #${target.id}`;
}
