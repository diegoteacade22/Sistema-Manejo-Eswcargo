import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { redactExternalText, redactExternalValue } from './redaction.mjs';

const SENSITIVE_FIELD = /(authorization|cookie|password|secret|token|api.?key|private.?key|credential)/i;

function sanitizeMetadata(value) {
  if (Array.isArray(value)) return value.map(sanitizeMetadata);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_FIELD.test(key) ? '[SECRET_REDACTED]' : sanitizeMetadata(nested),
    ]));
  }
  return redactExternalValue(value);
}

export class JsonRotatingLogger {
  constructor({ logDir, fileName = 'runtime.jsonl', maxBytes = 5_242_880, maxFiles = 5, mirrorConsole = true, now = () => new Date() }) {
    this.logDir = logDir;
    this.filePath = join(logDir, fileName);
    this.maxBytes = maxBytes;
    this.maxFiles = maxFiles;
    this.mirrorConsole = mirrorConsole;
    this.now = now;
    mkdirSync(logDir, { recursive: true, mode: 0o700 });
    try { chmodSync(logDir, 0o700); } catch {}
  }

  rotate(incomingBytes) {
    let currentBytes = 0;
    try { currentBytes = statSync(this.filePath).size; } catch {}
    if (currentBytes + incomingBytes <= this.maxBytes) return;
    for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
      const source = `${this.filePath}.${index}`;
      if (existsSync(source)) renameSync(source, `${this.filePath}.${index + 1}`);
    }
    if (existsSync(this.filePath)) renameSync(this.filePath, `${this.filePath}.1`);
  }

  write(level, event, metadata = {}) {
    const record = {
      timestamp: this.now().toISOString(),
      level,
      event: redactExternalText(event, 160),
      ...sanitizeMetadata(metadata),
    };
    const line = `${JSON.stringify(record)}\n`;
    try {
      this.rotate(Buffer.byteLength(line));
      appendFileSync(this.filePath, line, { encoding: 'utf8', mode: 0o600 });
      try { chmodSync(this.filePath, 0o600); } catch {}
    } catch (error) {
      const fallback = JSON.stringify({ timestamp: record.timestamp, level: 'ERROR', event: 'LOG_WRITE_FAILED', code: error?.code || 'UNKNOWN' });
      process.stderr.write(`${fallback}\n`);
    }
    if (this.mirrorConsole) process.stdout.write(line);
    return record;
  }

  info(event, metadata) { return this.write('INFO', event, metadata); }
  warn(event, metadata) { return this.write('WARN', event, metadata); }
  error(event, metadata) { return this.write('ERROR', event, metadata); }
}

export function createJsonLogger(config) {
  return new JsonRotatingLogger({
    logDir: config.logDir,
    maxBytes: config.logMaxBytes,
    maxFiles: config.logMaxFiles,
    mirrorConsole: config.consoleLogEnabled,
  });
}
