import { spawn } from 'node:child_process';

const OUTPUT_LIMIT = 64 * 1024;

export function nonSecretEnvironment(source = process.env) {
  const allowed = ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'LOGNAME', 'SHELL', 'CODEX_HOME'];
  return Object.fromEntries(allowed.flatMap((key) => source[key] ? [[key, source[key]]] : []));
}

export function githubEnvironment(token, source = process.env) {
  if (typeof token !== 'string' || !token) throw new Error('ENGINEERING_GITHUB_TOKEN_REQUIRED');
  return { ...nonSecretEnvironment(source), GH_TOKEN: token };
}

export function githubGitEnvironment(token, source = process.env) {
  if (typeof token !== 'string' || !token) throw new Error('ENGINEERING_GITHUB_TOKEN_REQUIRED');
  const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  return {
    ...nonSecretEnvironment(source),
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}

export class ProcessError extends Error {
  constructor(code, { exitCode = null, signal = null, timedOut = false, uncertain = false } = {}) {
    super(code);
    this.name = 'ProcessError';
    this.code = code;
    this.exitCode = exitCode;
    this.signal = signal;
    this.timedOut = timedOut;
    this.uncertain = uncertain;
    this.retryable = timedOut;
  }
}

function appendBounded(current, chunk) {
  const next = current + chunk.toString('utf8');
  return next.length > OUTPUT_LIMIT ? next.slice(-OUTPUT_LIMIT) : next;
}

export function runProcess(command, args, { cwd, env = process.env, timeoutMs = 120_000, stdin = null, signal: abortSignal = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    const terminateTree = () => {
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM'); } catch {}
      const killer = setTimeout(() => {
        try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); } catch {}
      }, 5_000);
      killer.unref?.();
    };
    child.stdout.on('data', (chunk) => { stdout = appendBounded(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = appendBounded(stderr, chunk); });
    child.on('error', () => reject(new ProcessError('PROCESS_SPAWN_FAILED')));
    if (stdin !== null) child.stdin.end(stdin); else child.stdin.end();
    const onAbort = () => { aborted = true; terminateTree(); };
    if (abortSignal?.aborted) onAbort(); else abortSignal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      terminateTree();
    }, timeoutMs);
    timer.unref?.();
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', onAbort);
      if (aborted) return reject(new ProcessError('PROCESS_ABORTED_BY_LEASE_CONTROL', { exitCode, signal }));
      if (timedOut) return reject(new ProcessError('PROCESS_TIMEOUT', { exitCode, signal, timedOut: true, uncertain: true }));
      if (exitCode !== 0) return reject(new ProcessError('PROCESS_FAILED', { exitCode, signal }));
      resolve({ stdout, stderr, exitCode: 0 });
    });
  });
}
