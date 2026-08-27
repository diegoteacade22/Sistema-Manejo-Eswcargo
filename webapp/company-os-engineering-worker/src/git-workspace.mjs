import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { assertChangedPaths, branchName, PolicyError } from './policy.mjs';
import { githubGitEnvironment, nonSecretEnvironment, runProcess } from './process.mjs';

function hash(value) { return createHash('sha256').update(value).digest('hex'); }

const GENERIC_SECRET = /(github_pat_[A-Za-z0-9_]+|gh[opusr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|(?:api[_-]?key|access[_-]?token|client[_-]?secret|authorization)\s*[:=]\s*["']?[A-Za-z0-9_.\/-]{12,})/i;

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
  }

  async git(args, options = {}) {
    const env = options.github ? githubGitEnvironment(this.config.githubToken) : (options.env || nonSecretEnvironment());
    return runProcess(this.config.gitBin, args, { cwd: options.cwd || this.repo, timeoutMs: options.timeoutMs || 120_000, env });
  }

  async prepare() {
    const resolvedJobs = resolve(this.config.jobsDir);
    const resolvedRoot = resolve(this.root);
    if (!resolvedRoot.startsWith(`${resolvedJobs}${sep}`)) throw new PolicyError('JOB_PATH_INVALID');
    await rm(resolvedRoot, { recursive: true, force: true });
    await mkdir(resolvedRoot, { recursive: true, mode: 0o700 });
    const sourceRemote = await runProcess(this.config.gitBin, ['-C', this.config.repositoryPath, 'remote', 'get-url', 'origin'], { cwd: this.config.repositoryPath, timeoutMs: 30_000, env: nonSecretEnvironment() });
    if (repositorySlugFromRemote(sourceRemote.stdout) !== this.config.repositorySlug) throw new PolicyError('SOURCE_REMOTE_MISMATCH');
    if (this.config.fetchBaseCommit !== false) {
      await runProcess(this.config.gitBin, ['-C', this.config.repositoryPath, 'fetch', '--no-tags', 'origin', this.claim.mission.baseCommit], { cwd: this.config.repositoryPath, timeoutMs: 120_000, env: nonSecretEnvironment() });
    }
    await runProcess(this.config.gitBin, ['clone', '--no-hardlinks', '--no-checkout', '--', this.config.repositoryPath, this.repo], { cwd: this.root, timeoutMs: 120_000, env: nonSecretEnvironment() });
    await this.git(['cat-file', '-e', `${this.claim.mission.baseCommit}^{commit}`]);
    const resolved = (await this.git(['rev-parse', this.claim.mission.baseCommit])).stdout.trim();
    if (resolved !== this.claim.mission.baseCommit.toLowerCase()) throw new PolicyError('BASE_COMMIT_MISMATCH');
    await this.git(['checkout', '--detach', this.claim.mission.baseCommit]);
    await this.git(['switch', '-c', this.branch]);
    if (this.claim.mission.autonomyLevel === 'A1') await this.git(['remote', 'remove', 'origin']);
    else await this.git(['remote', 'set-url', 'origin', `https://github.com/${this.config.repositorySlug}.git`]);
    return this;
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
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    const gitlinks = (await this.git(['ls-files', '--stage'])).stdout.split('\n').filter((line) => line.startsWith('160000 '));
    if (gitlinks.length > 0) throw new PolicyError('SUBMODULE_PRESENT');
  }

  async verifyAndCommit() {
    const paths = await this.changedPaths();
    assertChangedPaths(paths, this.policy.missionPaths, this.policy.leasePaths);
    await this.assertNoSymlinkOrSubmodule(paths);
    await this.git(['diff', '--check', this.claim.mission.baseCommit]);
    await this.git(['add', '--', ...paths]);
    await this.git(['diff', '--cached', '--check']);
    const staged = (await this.git(['diff', '--cached', '--name-only', '-z'])).stdout.split('\0').filter(Boolean).sort();
    assertChangedPaths(staged, this.policy.missionPaths, this.policy.leasePaths);
    await this.git(['-c', 'user.name=Company OS Engineering V2', '-c', 'user.email=company-os-engineering-v2@localhost', 'commit', '-m', `chore(engineering-v2): ${this.claim.mission.missionId}`]);
    const commitSha = (await this.git(['rev-parse', 'HEAD'])).stdout.trim();
    const committedPaths = (await this.git(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', this.claim.mission.baseCommit, commitSha])).stdout.split('\0').filter(Boolean).sort();
    assertChangedPaths(committedPaths, this.policy.missionPaths, this.policy.leasePaths);
    await this.assertNoSymlinkOrSubmodule(committedPaths);
    const patch = (await this.git(['diff', '--binary', this.claim.mission.baseCommit, commitSha])).stdout;
    return { commitSha, changedPaths: committedPaths, diffHash: hash(patch), branch: this.branch };
  }

  async assertNoSecretMaterial(stdout, authDir) {
    const trackedDiff = (await this.git(['diff', '--binary'])).stdout;
    const paths = await this.changedPaths();
    let untracked = '';
    for (const path of paths) {
      try { untracked += await readFile(join(this.repo, path), 'utf8'); } catch {}
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
