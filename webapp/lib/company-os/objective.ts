import { createHash } from 'node:crypto';

const REDACTIONS: Array<[RegExp, string]> = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL_REDACTED]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[PRIVATE_KEY_REDACTED]'],
  [/\b(?:sk[-_](?:live|test)[-_]?|sk-|rk_live_|pk_live_)[A-Za-z0-9_-]{12,}\b/gi, '[SECRET_REDACTED]'],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[GITHUB_TOKEN_REDACTED]'],
  [/\bAKIA[A-Z0-9]{16}\b/g, '[AWS_ACCESS_KEY_REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[JWT_REDACTED]'],
  [/\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g, '[TELEGRAM_TOKEN_REDACTED]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi, 'Bearer [SECRET_REDACTED]'],
  [/\b(password|contraseña|token|api[_ -]?key|secret|client[_ -]?secret|private[_ -]?key|aws[_ -]?secret[_ -]?access[_ -]?key)\s*[:=]\s*\S+/gi, '$1=[SECRET_REDACTED]'],
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
