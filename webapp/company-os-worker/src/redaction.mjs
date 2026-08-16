const PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[PRIVATE_KEY_REDACTED]'],
  [/\b(?:sk[-_](?:live|test)[-_]?|sk-|rk_live_|pk_live_)[A-Za-z0-9_-]{12,}\b/gi, '[SECRET_REDACTED]'],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[GITHUB_TOKEN_REDACTED]'],
  [/\bAKIA[A-Z0-9]{16}\b/g, '[AWS_ACCESS_KEY_REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[JWT_REDACTED]'],
  [/\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g, '[TELEGRAM_TOKEN_REDACTED]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi, 'Bearer [SECRET_REDACTED]'],
  [/\b(password|contraseña|token|api[_ -]?key|secret|client[_ -]?secret|private[_ -]?key|aws[_ -]?secret[_ -]?access[_ -]?key)\s*[:=]\s*\S+/gi, '$1=[SECRET_REDACTED]'],
];

export function redactExternalText(value, maxLength = 4000) {
  let safe = String(value ?? '');
  for (const [pattern, replacement] of PATTERNS) safe = safe.replace(pattern, replacement);
  return safe.slice(0, maxLength);
}

export function redactExternalValue(value) {
  if (typeof value === 'string') return redactExternalText(value);
  if (Array.isArray(value)) return value.map(redactExternalValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, redactExternalValue(nested)]));
  return value;
}
