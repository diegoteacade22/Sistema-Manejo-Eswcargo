import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

export class InstanceLock {
  constructor(path, instanceId) { this.path = path; this.instanceId = instanceId; this.owned = false; }
  acquire() {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const fd = openSync(this.path, 'wx', 0o600);
        try { writeFileSync(fd, JSON.stringify({ pid: process.pid, instanceId: this.instanceId })); } finally { closeSync(fd); }
        this.owned = true;
        return;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        let current = null;
        try { current = JSON.parse(readFileSync(this.path, 'utf8')); } catch {}
        if (alive(Number(current?.pid))) throw Object.assign(new Error('ENGINEERING_INSTANCE_ACTIVE'), { code: 'ENGINEERING_INSTANCE_ACTIVE' });
        try { unlinkSync(this.path); } catch (unlinkError) { if (unlinkError?.code !== 'ENOENT') throw unlinkError; }
      }
    }
    throw Object.assign(new Error('ENGINEERING_LOCK_UNAVAILABLE'), { code: 'ENGINEERING_LOCK_UNAVAILABLE' });
  }
  release() {
    if (!this.owned) return;
    try {
      const current = JSON.parse(readFileSync(this.path, 'utf8'));
      if (current.instanceId === this.instanceId && current.pid === process.pid) unlinkSync(this.path);
    } catch {}
    this.owned = false;
  }
}
