import { githubEnvironment, githubGitEnvironment, runProcess, ProcessError } from './process.mjs';
import { validateClaim } from './policy.mjs';

function parseJson(value, code) {
  try { return JSON.parse(value); } catch { const error = new Error(code); error.code = code; throw error; }
}

function failure(code, options = {}) { return Object.assign(new Error(code), { code, ...options }); }

function remoteFields(readback) {
  return {
    remoteProvider: readback.remoteProvider,
    remoteId: readback.remoteId,
    remoteUrl: readback.remoteUrl,
    remoteReadback: readback.remoteReadback,
  };
}

export class GitHubEffects {
  constructor({ config, api, claim, workspace }) {
    this.config = config;
    this.api = api;
    this.claim = claim;
    this.workspace = workspace;
  }

  effect(verb, receipt) {
    const suffix = verb === 'PUSH_BRANCH' ? 'push-branch' : 'create-draft-pr';
    return {
      verb,
      targetRepository: this.config.repositorySlug,
      targetBaseBranch: this.config.baseBranch,
      targetHeadBranch: receipt.branch,
      targetCommitSha: receipt.commitSha,
      idempotencyKey: `engineering-v2:${suffix}:${this.claim.lease.missionHash}:${receipt.branch}`,
    };
  }

  async dispatch(effect, operation, readback) {
    const reservation = await this.api.effect('reserve', this.claim, effect);
    if (typeof reservation?.effectId !== 'string' || !reservation.effectId) throw failure('EFFECT_RESERVATION_REJECTED');
    const bound = { ...effect, effectId: reservation.effectId };
    if (reservation.dispatch === false) {
      if (reservation.status === 'RESERVED') throw failure('EFFECT_DISPATCH_PAUSED', { retryable: true });
      const existing = await readback(bound);
      if (reservation.status === 'CONFIRMED') {
        if (!existing) throw failure('EFFECT_CONFIRMED_WITHOUT_READBACK');
        return existing;
      }
      if (reservation.status !== 'UNKNOWN_OUTCOME') throw failure('EFFECT_REPLAY_STATUS_INVALID');
      if (existing) {
        const reconciled = await this.api.effect('reconcile', this.claim, { effectId: bound.effectId, outcome: 'CONFIRMED', ...remoteFields(existing) });
        if (reconciled?.status !== 'CONFIRMED' || reconciled?.retryDispatch !== false) throw failure('EFFECT_RECONCILE_REJECTED');
        return existing;
      }
      const reconciled = await this.api.effect('reconcile', this.claim, { effectId: bound.effectId, outcome: 'FAILED', errorCode: 'REMOTE_NOT_FOUND_AFTER_READBACK' });
      if (reconciled?.status !== 'FAILED' || reconciled?.retryDispatch !== false) throw failure('EFFECT_RECONCILE_REJECTED');
      throw failure('EFFECT_RECONCILED_FAILED');
    }
    if (reservation.dispatch !== true || reservation.status !== 'RESERVED') throw failure('EFFECT_RESERVATION_REJECTED');
    const dispatching = await this.api.effect('dispatching', this.claim, { effectId: bound.effectId });
    if (dispatching?.status !== 'DISPATCHING') throw failure('EFFECT_DISPATCH_REJECTED');
    try {
      await operation(bound);
    } catch (error) {
      if (error?.uncertain === true || error instanceof ProcessError) {
        await this.api.effect('unknown', this.claim, { effectId: bound.effectId, errorCode: error.code || 'EFFECT_UNCERTAIN' });
        throw Object.assign(error, { uncertain: true });
      }
      throw error;
    }
    const confirmed = await readback(bound);
    if (!confirmed) {
      await this.api.effect('unknown', this.claim, { effectId: bound.effectId, errorCode: 'EFFECT_READBACK_MISSING' });
      throw failure('EFFECT_READBACK_MISSING', { uncertain: true });
    }
    const confirmation = await this.api.effect('confirm', this.claim, { effectId: bound.effectId, ...remoteFields(confirmed) });
    if (confirmation?.status !== 'CONFIRMED') throw failure('EFFECT_CONFIRM_REJECTED', { uncertain: true });
    return confirmed;
  }

  async push(receipt) {
    const effect = this.effect('PUSH_BRANCH', receipt);
    return this.dispatch(effect,
      () => this.workspace.git(['push', '--porcelain', 'origin', `HEAD:refs/heads/${receipt.branch}`], { timeoutMs: 120_000, github: true }),
      async () => {
        try {
          const remote = (await this.workspace.git(['ls-remote', '--heads', 'origin', `refs/heads/${receipt.branch}`], { github: true })).stdout.trim();
          const [sha] = remote.split(/\s+/);
          return sha === receipt.commitSha ? {
            remoteProvider: 'github', remoteId: receipt.branch,
            remoteUrl: `https://github.com/${this.config.repositorySlug}/tree/${receipt.branch}`,
            remoteReadback: { branch: receipt.branch, commitSha: sha },
          } : null;
        } catch { return null; }
      });
  }

  async findDraft(marker, branch) {
    const result = await runProcess(this.config.ghBin, ['pr', 'list', '--repo', this.config.repositorySlug, '--head', branch, '--state', 'open', '--json', 'number,url,isDraft,body,headRefName'], { cwd: this.workspace.repo, timeoutMs: 30_000, env: githubEnvironment(this.config.githubToken) });
    const candidates = parseJson(result.stdout, 'GITHUB_READBACK_INVALID');
    const found = candidates.find((item) => item.isDraft === true && item.headRefName === branch && typeof item.body === 'string' && item.body.includes(marker));
    return found ? {
      remoteProvider: 'github', remoteId: String(found.number), remoteUrl: found.url,
      remoteReadback: { number: found.number, url: found.url, isDraft: true, branch },
    } : null;
  }

  async draftPr(receipt) {
    const effect = this.effect('CREATE_DRAFT_PR', receipt);
    const marker = `<!-- company-os-engineering-v2:${effect.idempotencyKey} -->`;
    return this.dispatch(effect,
      () => runProcess(this.config.ghBin, [
        'pr', 'create', '--draft', '--repo', this.config.repositorySlug,
        '--head', receipt.branch, '--base', this.config.baseBranch,
        '--title', `[Engineering V2] ${this.claim.mission.missionId}`,
        '--body', `${marker}\n\nAutomated bounded A2 draft. Human review required. Merge and deploy are not authorized.`,
      ], { cwd: this.workspace.repo, timeoutMs: 60_000, env: githubEnvironment(this.config.githubToken) }),
      () => this.findDraft(marker, receipt.branch));
  }
}

export class EngineeringReconciler {
  constructor({ config, api, effectsFactory = null, claimValidator = validateClaim }) { this.config = config; this.api = api; this.effectsFactory = effectsFactory; this.claimValidator = claimValidator; }

  async readback(effect) {
    if (effect.verb === 'PUSH_BRANCH') {
      try {
        const remoteUrl = `https://github.com/${effect.targetRepository}.git`;
        const result = await runProcess(this.config.gitBin, ['ls-remote', '--heads', remoteUrl, `refs/heads/${effect.targetHeadBranch}`], {
          cwd: this.config.repositoryPath, timeoutMs: 30_000, env: githubGitEnvironment(this.config.githubToken),
        });
        const [sha] = result.stdout.trim().split(/\s+/);
        return sha === effect.targetCommitSha ? {
          remoteProvider: 'github', remoteId: effect.targetHeadBranch,
          remoteUrl: `https://github.com/${effect.targetRepository}/tree/${effect.targetHeadBranch}`,
          remoteReadback: { branch: effect.targetHeadBranch, commitSha: sha },
        } : null;
      } catch { return null; }
    }
    if (effect.verb === 'CREATE_DRAFT_PR') {
      try {
        const marker = `<!-- company-os-engineering-v2:${effect.idempotencyKey} -->`;
        const result = await runProcess(this.config.ghBin, ['pr', 'list', '--repo', effect.targetRepository, '--head', effect.targetHeadBranch, '--state', 'open', '--json', 'number,url,isDraft,body,headRefName'], {
          cwd: this.config.repositoryPath, timeoutMs: 30_000, env: githubEnvironment(this.config.githubToken),
        });
        const candidates = parseJson(result.stdout, 'GITHUB_READBACK_INVALID');
        const found = candidates.find((item) => item.isDraft === true && item.headRefName === effect.targetHeadBranch && typeof item.body === 'string' && item.body.includes(marker));
        return found ? {
          remoteProvider: 'github', remoteId: String(found.number), remoteUrl: found.url,
          remoteReadback: { number: found.number, url: found.url, isDraft: true, branch: effect.targetHeadBranch },
        } : null;
      } catch { return null; }
    }
    throw failure('RECONCILE_VERB_DENIED');
  }

  async reconcile(claim) {
    this.claimValidator(claim, this.config);
    if (claim?.mode !== 'RECONCILE' || !Array.isArray(claim.effects)) throw failure('RECONCILE_CLAIM_INVALID');
    if (claim.effects.length === 0) {
      const failed = await this.api.fail(claim, { code: 'RECONCILE_EFFECTS_MISSING', retryable: true });
      return { status: failed?.status || 'FAILED_RETRYABLE', outcomes: [] };
    }
    const outcomes = [];
    for (const effect of claim.effects.filter((item) => item.status === 'UNKNOWN_OUTCOME')) {
      const readback = await this.readback(effect);
      const payload = readback
        ? { effectId: effect.effectId, outcome: 'CONFIRMED', ...remoteFields(readback) }
        : { effectId: effect.effectId, outcome: 'FAILED', errorCode: 'REMOTE_NOT_FOUND_AFTER_READBACK' };
      const result = await this.api.effect('reconcile', claim, payload);
      if (result?.retryDispatch !== false || result?.status !== payload.outcome) throw failure('EFFECT_RECONCILE_REJECTED');
      outcomes.push({ effectId: effect.effectId, verb: effect.verb, status: result.status, ...(readback ? { readback } : {}) });
      if (result.status === 'FAILED') return { status: 'FAILED', outcomes };
    }
    const effectiveEffects = claim.effects.map((effect) => {
      const outcome = outcomes.find((item) => item.effectId === effect.effectId);
      return outcome ? { ...effect, status: outcome.status } : effect;
    });
    const unresolved = effectiveEffects.filter((effect) => effect.status !== 'CONFIRMED');
    if (unresolved.length > 0) {
      const failed = await this.api.fail(claim, { code: 'RECONCILE_EFFECT_STATE_UNRESOLVED', retryable: true });
      return { status: failed?.status || 'FAILED_RETRYABLE', outcomes };
    }
    let draft = effectiveEffects.find((effect) => effect.verb === 'CREATE_DRAFT_PR' && effect.status === 'CONFIRMED');
    const push = effectiveEffects.find((effect) => effect.verb === 'PUSH_BRANCH' && effect.status === 'CONFIRMED');
    if (!draft && push) {
      const adapter = this.effectsFactory
        ? this.effectsFactory({ config: this.config, api: this.api, claim })
        : new GitHubEffects({ config: this.config, api: this.api, claim, workspace: { repo: this.config.repositoryPath } });
      const readback = await adapter.draftPr({ branch: push.targetHeadBranch, commitSha: push.targetCommitSha });
      draft = { verb: 'CREATE_DRAFT_PR', status: 'CONFIRMED', readback };
      outcomes.push(draft);
    }
    if (!draft) {
      const failed = await this.api.fail(claim, { code: 'RECONCILE_DRAFT_PR_MISSING', retryable: true });
      return { status: failed?.status || 'FAILED_RETRYABLE', outcomes };
    }
    let completed;
    try {
      completed = await this.api.complete(claim, { mode: 'RECONCILE', effects: outcomes });
    } catch (error) {
      if (error?.code === 'DRAFT_PR_READBACK_REQUIRED') {
        const failed = await this.api.fail(claim, { code: 'RECONCILE_CONTINUE_REQUIRED', retryable: true });
        return { status: failed?.status || 'FAILED_RETRYABLE', outcomes };
      }
      throw error;
    }
    if (completed?.status !== 'COMPLETED') throw failure('COMPLETE_REJECTED');
    return { status: 'COMPLETED', outcomes };
  }
}
