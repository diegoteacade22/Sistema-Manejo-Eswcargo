import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactExternalValue } from './redaction.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export const completionHash = (output) => createHash('sha256').update(JSON.stringify(canonical(output))).digest('hex');
const entryKey = (claim) => createHash('sha256').update(JSON.stringify([claim.workerId, claim.workItemId, claim.attemptId])).digest('hex');
const outboxError = () => Object.assign(new Error('Completion outbox requires persistence recovery'), { code: 'COMPLETION_OUTBOX_UNAVAILABLE', retryable: true });
const secretKey = /^(?:hmacSecret|apiKey|api_key|password|secret|token|authorization|privateKey|credentials)$/i;
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, secretKey.test(key) ? '[SECRET_REDACTED]' : sanitize(nested)]));
  return redactExternalValue(value);
}

// Only the result and replay identity are stored. Prompts, evidence and signing keys never enter this object.
export function completionEntry(claim, output, usage, api) {
  const identity = Object.fromEntries(['leaseToken', 'requestId', 'caseId', 'workItemId', 'attemptId', 'agentId', 'slotNo'].map((key) => [key, claim[key]]));
  identity.workerId = claim.workerId || api.workerId;
  identity.leaseInstanceId = claim.leaseInstanceId || api.instanceId;
  const safeOutput = sanitize(output);
  return { version: 1, claim: identity, output: safeOutput, usage: sanitize(usage || {}), resultHash: completionHash(safeOutput) };
}

export class CompletionOutbox {
  constructor({ stateDir }) {
    this.stateDir = stateDir;
    this.directory = join(stateDir, 'completion-outbox');
    this.memory = new Map();
    this.loaded = false;
    this.failed = false;
  }
  get pendingCount() { return this.memory.size; }
  get blocked() { return this.failed || this.memory.size > 0; }
  syncDirectory() {
    const fd = openSync(this.directory, constants.O_RDONLY);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }
  ensureDirectory() {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    chmodSync(this.directory, 0o700);
    const parent = openSync(this.stateDir, constants.O_RDONLY);
    try { fsyncSync(parent); } finally { closeSync(parent); }
  }
  validate(entry, key) {
    if (entry?.version !== 1 || !entry.claim || ['workerId', 'leaseInstanceId', 'workItemId', 'attemptId', 'requestId', 'leaseToken']
      .some((name) => typeof entry.claim[name] !== 'string' || !entry.claim[name])
      || entryKey(entry.claim) !== key || completionHash(entry.output) !== entry.resultHash) throw outboxError();
  }
  load() {
    try {
      this.ensureDirectory();
      const files = readdirSync(this.directory).flatMap((name) => {
        const match = /^([a-f0-9]{64})(?:\.[a-f0-9-]+\.tmp|\.json)$/.exec(name);
        return match ? [{ name, key: match[1], temporary: name.endsWith('.tmp') }] : [];
      });
      const durable = new Set();
      // Establish intact committed copies before interpreting interrupted rewrites.
      files.sort((a, b) => Number(a.temporary) - Number(b.temporary));
      for (const { name, key, temporary } of files) {
        const file = join(this.directory, name);
        const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        let raw;
        try { raw = readFileSync(fd, 'utf8'); } finally { closeSync(fd); }
        let entry;
        try { entry = JSON.parse(raw); } catch (error) {
          // Only a fully validated on-disk copy permits discarding a partial rewrite.
          // A lone temporary, I/O error or conflicting valid record fails closed.
          if (!temporary || !durable.has(key) || !(error instanceof SyntaxError)) throw error;
          unlinkSync(file);
          this.syncDirectory();
          continue;
        }
        this.validate(entry, key);
        const prior = this.memory.get(key);
        if (prior && completionHash(prior) !== completionHash(entry)) throw outboxError();
        this.memory.set(key, entry);
        if (temporary) {
          this.persist(entry);
          unlinkSync(file);
          this.syncDirectory();
        } else durable.add(key);
      }
      this.loaded = true;
      this.failed = false;
      return [...this.memory.values()];
    } catch { this.failed = true; throw outboxError(); }
  }
  persist(entry) {
    const key = entryKey(entry.claim);
    // Retain in memory before touching disk, including ENOSPC/permission failures.
    const prior = this.memory.get(key);
    if (prior && completionHash(prior) !== completionHash(entry)) { this.failed = true; throw outboxError(); }
    this.memory.set(key, entry);
    let temporary;
    try {
      this.validate(entry, key);
      this.ensureDirectory();
      temporary = join(this.directory, `${key}.${randomUUID()}.tmp`);
      const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(fd, JSON.stringify(entry)); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, join(this.directory, `${key}.json`));
      this.syncDirectory();
      this.failed = false;
    } catch {
      // A partial temporary file is safe to remove only while its full result remains in memory.
      try { if (temporary && existsSync(temporary)) unlinkSync(temporary); } catch {}
      this.failed = true;
      throw outboxError();
    }
    return entry;
  }
  acknowledge(entry) {
    try {
      const file = join(this.directory, `${entryKey(entry.claim)}.json`);
      if (existsSync(file)) unlinkSync(file);
      this.syncDirectory();
      this.memory.delete(entryKey(entry.claim));
      this.failed = false;
    } catch { this.failed = true; throw outboxError(); }
  }
}
