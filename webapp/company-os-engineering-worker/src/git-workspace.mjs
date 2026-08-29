import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { assertChangedPaths, branchName, PolicyError } from './policy.mjs';
import { githubGitEnvironment, nonSecretEnvironment, runProcess, ProcessError } from './process.mjs';

function hash(value) { return createHash('sha256').update(value).digest('hex'); }

const GENERIC_SECRET = /(github_pat_[A-Za-z0-9_]+|gh[opusr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|(?:api[_-]?key|access[_-]?token|client[_-]?secret|authorization)\s*[:=]\s*["']?[A-Za-z0-9_.\/-]{12,})/i;
const MAX_CHANGED_FILE_BYTES = 1024 * 1024;
const MAX_PATCH_BYTES = 4 * 1024 * 1024;

function isolatedGitEnvironment(base) {
  return {
    ...base,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '/usr/bin/false',
    GIT_SSH_COMMAND: '/usr/bin/false',
  };
}

async function authMaterial(directory, values = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await authMaterial(path, values);
    else if (entry.isFile()) {
      const content = await readFile(path, 'utf8').catch(() => '');
      if (content.length <= 1024 * 1024) {
        for (const candidate of [content.trim(), ...content.split(/\r?\n/), ...content.matchAll(/"([^"\\]{16,})"/g)].map((item) => Array.isArray(item) ? item[1] : item.trim())) {
          if (candidate.length >= 16) values.push(candidate);
        }
      }
    }
  }
  return values;
}

function repositorySlugFromRemote(value) {
  const trimmed = value.trim().replace(/\.git$/, '');
  const https = trimmed.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)$/i);
  if (https) return https[1];
  const ssh = trimmed.match(/^git@github\.com:([^/]+\/[^/]+)$/i);
  return ssh?.[1] || null;
}

export class GitWorkspace {
  constructor({ config, claim, policy }) {
    this.config = config;
    this.claim = claim;
    this.policy = policy;
    this.root = join(config.jobsDir, `${claim.mission.missionId.replace(/[^A-Za-z0-9_.-]/g, '_')}-${claim.lease.fencingToken}`);
    this.repo = join(this.root, 'repo');
    this.branch = branchName(claim.mission);
    this.gitConfigHash = null;
    this.signal = null;
  }

  assertLeaseActive() {
    if (this.signal?.aborted) throw new ProcessError('PROCESS_ABORTED_BY_LEASE_CONTROL');
  }

  async git(args, options = {}) {
    const env = isolatedGitEnvironment(
      options.github ? githubGitEnvironment(this.config.githubToken) : (options.env || nonSecretEnvironment()),
    );
    return runProcess(this.config.gitBin, ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: options.cwd || this.repo,
      timeoutMs: options.timeoutMs || 120_000,
      env,
      stdoutLimitBytes: options.stdoutLimitBytes,
      failOnStdoutLimit: options.failOnStdoutLimit,
      signal: options.signal || this.signal,
    });
  }

  async prepare({ signal = null } = {}) {
    this.signal = signal;
    this.assertLeaseActive();
    const resolvedJobs = resolve(this.config.jobsDir);
    const resolvedRoot = resolve(this.root);
    if (!resolvedRoot.startsWith(`${resolvedJobs}${sep}`)) throw new PolicyError('JOB_PATH_INVALID');
    await rm(resolvedRoot, { recursive: true, force: true });
    await mkdir(resolvedRoot, { recursive: true, mode: 0o700 });
    const sourceRemote = await runProcess(this.config.gitBin, ['-c', 'core.hooksPath=/dev/null', '-C', this.config.repositoryPath, 'remote', 'get-url', 'origin'], {
      cwd: this.config.repositoryPath,
      timeoutMs: 30_000,
      env: isolatedGitEnvironment(nonSecretEnvironment()),
      signal: this.signal,
    });
    if (repositorySlugFromRemote(sourceRemote.stdout) !== this.config.repositorySlug) throw new PolicyError('SOURCE_REMOTE_MISMATCH');
    if (this.config.fetchBaseCommit !== false) {
      const fetchEnvironment = this.config.githubToken
        ? githubGitEnvironment(this.config.githubToken)
        : nonSecretEnvironment();
      await runProcess(this.config.gitBin, [
        '-c', 'core.hooksPath=/dev/null', '-C', this.config.repositoryPath,
        'fetch', '--no-tags', '--force', `https://github.com/${this.config.repositorySlug}.git`,
        this.claim.mission.baseCommit,
      ], {
        cwd: this.config.repositoryPath,
        timeoutMs: 120_000,
        env: isolatedGitEnvironment(fetchEnvironment),
        signal: this.signal,
      });
    }
    await runProcess(this.config.gitBin, ['-c', 'core.hooksPath=/dev/null', 'clone', '--no-hardlinks', '--no-checkout', '--', this.config.repositoryPath, this.repo], {
      cwd: this.root,
      timeoutMs: 120_000,
      env: isolatedGitEnvironment(nonSecretEnvironment()),
      signal: this.signal,
    });
    await this.git(['cat-file', '-e', `${this.claim.mission.baseCommit}^{commit}`]);
    const resolved = (await this.git(['rev-parse', this.claim.mission.baseCommit])).stdout.trim();
    if (resolved !== this.claim.mission.baseCommit.toLowerCase()) throw new PolicyError('BASE_COMMIT_MISMATCH');
    await this.git(['checkout', '--detach', this.claim.mission.baseCommit]);
    await this.git(['switch', '-c', this.branch]);
    if (this.claim.mission.autonomyLevel === 'A1') await this.git(['remote', 'remove', 'origin']);
    else await this.git(['remote', 'set-url', 'origin', `https://github.com/${this.config.repositorySlug}.git`]);
    await this.git(['config', '--local', 'core.hooksPath', '/dev/null']);
    this.gitConfigHash = hash(await readFile(join(this.repo, '.git', 'config')));
    await this.assertRepositoryMetadata();
    return this;
  }

  async assertRepositoryMetadata() {
    const gitDirectory = join(this.repo, '.git');
    const metadata = await lstat(gitDirectory).catch(() => null);
    if (!metadata?.isDirectory() || metadata.isSymbolicLink()) throw new PolicyError('GIT_METADATA_INVALID');
    const configBytes = await readFile(join(gitDirectory, 'config')).catch(() => null);
    if (!configBytes || !this.gitConfigHash || hash(configBytes) !== this.gitConfigHash) {
      throw new PolicyError('GIT_CONFIG_CHANGED');
    }
    const hooksDirectory = join(gitDirectory, 'hooks');
    const hooks = await readdir(hooksDirectory, { withFileTypes: true }).catch(() => []);
    if (hooks.some((entry) => !entry.name.endsWith('.sample'))) throw new PolicyError('GIT_HOOK_PRESENT');
    const remotes = (await this.git(['remote'])).stdout.split('\n').filter(Boolean);
    if (this.claim.mission.autonomyLevel === 'A1') {
      if (remotes.length !== 0) throw new PolicyError('GIT_REMOTE_CHANGED');
    } else {
      if (remotes.length !== 1 || remotes[0] !== 'origin') throw new PolicyError('GIT_REMOTE_CHANGED');
      const urls = (await this.git(['remote', 'get-url', '--all', 'origin'])).stdout.split('\n').filter(Boolean);
      if (urls.length !== 1 || urls[0] !== `https://github.com/${this.config.repositorySlug}.git`) {
        throw new PolicyError('GIT_REMOTE_CHANGED');
      }
    }
  }

  async changedPaths() {
    const result = await this.git(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    const entries = result.stdout.split('\0').filter(Boolean);
    if (entries.some((entry) => /[RC]/.test(entry.slice(0, 2)))) throw new PolicyError('RENAME_OR_COPY_NOT_ALLOWED');
    return [...new Set(entries.map((entry) => entry.slice(3)))].sort();
  }

  async assertNoSymlinkOrSubmodule(paths) {
    for (const relativePath of paths) {
      const absolute = resolve(this.repo, relativePath);
      if (!absolute.startsWith(`${resolve(this.repo)}${sep}`)) throw new PolicyError('CHANGED_PATH_ESCAPE');
      try {
        const metadata = await lstat(absolute);
        if (metadata.isSymbolicLink()) throw new PolicyError('SYMLINK_CHANGED');
        if (metadata.isFile() && metadata.size > MAX_CHANGED_FILE_BYTES) throw new PolicyError('CHANGED_FILE_TOO_LARGE');
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    const gitlinks = (await this.git(['ls-files', '--stage', '--', ...paths], {
      stdoutLimitBytes: 64 * 1024,
      failOnStdoutLimit: true,
    })).stdout.split('\n').filter((line) => line.startsWith('160000 '));
    if (gitlinks.length > 0) throw new PolicyError('SUBMODULE_PRESENT');
  }

  async verifyAndCommit() {
    this.assertLeaseActive();
    await this.assertRepositoryMetadata();
    const paths = await this.changedPaths();
    assertChangedPaths(paths, this.policy.missionPaths, this.policy.leasePaths);
    await this.assertNoSymlinkOrSubmodule(paths);
    this.assertLeaseActive();
    await this.git(['diff', '--check', this.claim.mission.baseCommit]);
    await this.git(['add', '--', ...paths]);
    await this.git(['diff', '--cached', '--check']);
    const staged = (await this.git(['diff', '--cached', '--name-only', '-z'])).stdout.split('\0').filter(Boolean).sort();
    assertChangedPaths(staged, this.policy.missionPaths, this.policy.leasePaths);
    let desiredStateReadback = null;
    if (this.policy.desiredState) {
      this.assertLeaseActive();
      const absolute = resolve(this.repo, this.policy.desiredState.path);
      if (!absolute.startsWith(`${resolve(this.repo)}${sep}`)) throw new PolicyError('DESIRED_STATE_PATH_ESCAPE');
      let metadata;
      try { metadata = await lstat(absolute); } catch { throw new PolicyError('DESIRED_STATE_NOT_SATISFIED'); }
      if (!metadata.isFile() || metadata.size > 1024 * 1024) throw new PolicyError('DESIRED_STATE_NOT_SATISFIED');
      const content = await readFile(absolute, 'utf8');
      const matchedNeedleHashes = this.policy.desiredState.needles
        .filter((needle) => content.includes(needle))
        .map((needle) => hash(JSON.stringify({ needle })))
        .sort();
      if (matchedNeedleHashes.length !== this.policy.desiredState.needles.length) {
        throw new PolicyError('DESIRED_STATE_NOT_SATISFIED');
      }
      desiredStateReadback = {
        type: 'FILE_CONTAINS_ALL',
        path: this.policy.desiredState.path,
        matched: true,
        contentHash: hash(content),
        matchedNeedleHashes,
      };
    }
    await this.git(['-c', 'user.name=Company OS Engineering V2', '-c', 'user.email=company-os-engineering-v2@localhost', 'commit', '-m', `chore(engineering-v2): ${this.claim.mission.missionId}`]);
    this.assertLeaseActive();
    const commitSha = (await this.git(['rev-parse', 'HEAD'])).stdout.trim();
    const committedPaths = (await this.git(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', this.claim.mission.baseCommit, commitSha])).stdout.split('\0').filter(Boolean).sort();
    assertChangedPaths(committedPaths, this.policy.missionPaths, this.policy.leasePaths);
    await this.assertNoSymlinkOrSubmodule(committedPaths);
    const patch = (await this.git(['diff', '--binary', this.claim.mission.baseCommit, commitSha], {
      stdoutLimitBytes: MAX_PATCH_BYTES,
      failOnStdoutLimit: true,
    })).stdout;
    return { commitSha, changedPaths: committedPaths, diffHash: hash(patch), branch: this.branch, desiredStateReadback };
  }

  async assertNoSecretMaterial(stdout, authDir) {
    await this.assertRepositoryMetadata();
    const trackedDiff = (await this.git(['diff', '--binary'], {
      stdoutLimitBytes: MAX_PATCH_BYTES,
      failOnStdoutLimit: true,
    })).stdout;
    const paths = await this.changedPaths();
    let untracked = '';
    for (const path of paths) {
      try {
        const metadata = await lstat(join(this.repo, path));
        if (metadata.isFile() && metadata.size > MAX_CHANGED_FILE_BYTES) throw new PolicyError('CHANGED_FILE_TOO_LARGE');
        untracked += await readFile(join(this.repo, path), 'utf8');
        if (Buffer.byteLength(untracked, 'utf8') > MAX_PATCH_BYTES) throw new PolicyError('CHANGED_CONTENT_TOO_LARGE');
      } catch (failure) {
        if (failure instanceof PolicyError) throw failure;
      }
    }
    const candidate = `${stdout || ''}\n${trackedDiff}\n${untracked}`;
    if (GENERIC_SECRET.test(candidate)) throw new PolicyError('SECRET_PATTERN_DETECTED');
    const exact = await authMaterial(authDir);
    if (exact.some((value) => candidate.includes(value))) throw new PolicyError('CODEX_AUTH_MATERIAL_DETECTED');
  }

  async cleanup() {
    const resolvedJobs = resolve(this.config.jobsDir);
    const resolvedRoot = resolve(this.root);
    if (resolvedRoot.startsWith(`${resolvedJobs}${sep}`)) await rm(resolvedRoot, { recursive: true, force: true });
  }
}
