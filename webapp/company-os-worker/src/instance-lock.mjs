import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export class InstanceLock {
  constructor({ lockPath, workerId, instanceId, pid = process.pid, now = () => new Date() }) {
    this.lockPath = lockPath;
    this.workerId = workerId;
    this.instanceId = instanceId;
    this.pid = pid;
    this.now = now;
    this.acquired = false;
  }

  acquire() {
    mkdirSync(dirname(this.lockPath), { recursive: true, mode: 0o700 });
    try { chmodSync(dirname(this.lockPath), 0o700); } catch {}
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const descriptor = openSync(this.lockPath, 'wx', 0o600);
        try {
          writeFileSync(descriptor, JSON.stringify({
            pid: this.pid,
            workerId: this.workerId,
            instanceId: this.instanceId,
            acquiredAt: this.now().toISOString(),
          }));
        } finally {
          closeSync(descriptor);
        }
        this.acquired = true;
        return;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        let existing = null;
        try { existing = JSON.parse(readFileSync(this.lockPath, 'utf8')); } catch {}
        if (processIsAlive(Number(existing?.pid))) {
          const lockError = new Error(`Company OS runtime instance already active with pid ${existing.pid}`);
          lockError.code = 'RUNTIME_INSTANCE_ALREADY_ACTIVE';
          throw lockError;
        }
        try { unlinkSync(this.lockPath); } catch (unlinkError) {
          if (unlinkError?.code !== 'ENOENT') throw unlinkError;
        }
      }
    }
    const error = new Error('Company OS runtime lock could not be acquired');
    error.code = 'RUNTIME_LOCK_UNAVAILABLE';
    throw error;
  }

  release() {
    if (!this.acquired) return;
    let owned = false;
    try {
      const existing = JSON.parse(readFileSync(this.lockPath, 'utf8'));
      owned = existing?.pid === this.pid && existing?.instanceId === this.instanceId;
    } catch {}
    if (owned) {
      try { unlinkSync(this.lockPath); } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    this.acquired = false;
  }
}
