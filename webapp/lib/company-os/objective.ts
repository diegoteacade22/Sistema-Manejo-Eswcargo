import { createHash } from 'node:crypto';

const REDACTIONS: Array<[RegExp, string]> = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL_REDACTED]'],
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[SECRET_REDACTED]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi, 'Bearer [SECRET_REDACTED]'],
  [/\b(password|contraseña|token|api[_ -]?key|secret)\s*[:=]\s*\S+/gi, '$1=[SECRET_REDACTED]'],
  [/\+?\d[\d\s().-]{7,}\d/g, '[NUMBER_REDACTED]'],
];

export function sanitizeCompanyObjective(raw: string) {
  const sanitized = sanitizeCompanyText(raw, 600);
  return { safeObjective: sanitized.safeText, objectiveHash: createHash('sha256').update(sanitized.safeText).digest('hex'), redactions: sanitized.redactions };
}

export function sanitizeCompanyText(raw: string, maxLength = 4000) {
  let safeObjective = raw.trim().slice(0, Math.max(maxLength * 2, maxLength));
  let redactions = 0;
  for (const [pattern, replacement] of REDACTIONS) {
    safeObjective = safeObjective.replace(pattern, () => {
      redactions += 1;
      return replacement;
    });
  }
  safeObjective = safeObjective.slice(0, maxLength);
  return { safeText: safeObjective, redactions };
}
