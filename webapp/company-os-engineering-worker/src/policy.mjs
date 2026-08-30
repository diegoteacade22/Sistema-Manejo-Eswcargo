import { createHash } from 'node:crypto';
import { posix } from 'node:path';

const AUTONOMY = new Set(['A1', 'A2']);
const A1_VERBS = new Set(['READ_REPOSITORY', 'WRITE_WORKTREE', 'RUN_TESTS', 'RUN_BUILD', 'COMMIT_LOCAL']);
const A2_VERBS = new Set([...A1_VERBS, 'PUSH_BRANCH', 'CREATE_DRAFT_PR']);
const PROHIBITED_SEGMENTS = new Set(['.git', '.github', 'migrations', 'migration', 'secrets']);
const CONTRACT_VERSIONS = new Set(['2.0.0', '2.1.0']);
const MAX_LEASE_CLOCK_SKEW_MS = 5_000;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, nested]) => nested !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function missionHash(mission) {
  const { expectedStateVersion: _mutableStateVersion, contractVersion = '2.0.0', desiredState, ...immutableMission } = mission;
  return createHash('sha256').update(canonicalJson({
    contractVersion,
    ...immutableMission,
    ...(contractVersion === '2.1.0' ? { desiredState: desiredState ?? null } : {}),
  })).digest('hex');
}

export class PolicyError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PolicyError';
    this.code = code;
    this.retryable = false;
  }
}

export function normalizeRelativePath(value) {
  if (typeof value !== 'string' || value.includes('\0')) throw new PolicyError('PATH_INVALID');
  const candidate = posix.normalize(value.replaceAll('\\', '/')).replace(/^\.\//, '').replace(/\/$/, '');
  if (!candidate || candidate === '..' || candidate.startsWith('../') || candidate.startsWith('/')) throw new PolicyError('PATH_INVALID');
  return candidate;
}

export function isProhibitedPath(value) {
  const path = normalizeRelativePath(value);
  const parts = path.toLowerCase().split('/');
  const leaf = parts.at(-1);
  return parts.some((part) => PROHIBITED_SEGMENTS.has(part))
    || leaf === '.env'
    || leaf.startsWith('.env.')
    || /(^|[-_.])(secret|credential|private[-_.]?key)([-_.]|$)/i.test(leaf);
}

export function pathWithin(value, roots) {
  const path = normalizeRelativePath(value);
  return roots.some((rootValue) => {
    const root = normalizeRelativePath(rootValue);
    return path === root || path.startsWith(`${root}/`);
  });
}

function assertString(value, code) {
  if (typeof value !== 'string' || !value.trim()) throw new PolicyError(code);
}

export function validateClaim(claim, config, now = new Date()) {
  if (!claim || typeof claim !== 'object' || !claim.mission || !claim.lease) throw new PolicyError('CLAIM_INVALID');
  const { mission, lease } = claim;
  const reconciliationOnly = claim.reconciliationOnly === true;
  if (claim.reconciliationOnly !== undefined && typeof claim.reconciliationOnly !== 'boolean') {
    throw new PolicyError('RECONCILIATION_MODE_INVALID');
  }
  for (const [value, code] of [
    [mission.missionId, 'MISSION_ID_INVALID'], [mission.objective, 'MISSION_OBJECTIVE_INVALID'],
    [mission.repository, 'MISSION_REPOSITORY_INVALID'], [mission.baseCommit, 'MISSION_BASE_INVALID'],
    [mission.policyHash, 'MISSION_POLICY_INVALID'], [lease.leaseId, 'LEASE_ID_INVALID'],
    [lease.missionHash, 'LEASE_HASH_INVALID'], [lease.actor, 'LEASE_ACTOR_INVALID'],
  ]) assertString(value, code);
  const contractVersion = mission.contractVersion ?? '2.0.0';
  if (!CONTRACT_VERSIONS.has(contractVersion)) throw new PolicyError('MISSION_CONTRACT_VERSION_INVALID');
  if (contractVersion === '2.0.0' && mission.desiredState !== null && mission.desiredState !== undefined) {
    throw new PolicyError('LEGACY_DESIRED_STATE_DENIED');
  }
  if (mission.repository !== config.repositorySlug || lease.resource !== config.repositorySlug) throw new PolicyError('REPOSITORY_NOT_ALLOWLISTED');
  if (!['EXECUTE', 'RECONCILE'].includes(claim.mode)) throw new PolicyError('CLAIM_MODE_INVALID');
  if (reconciliationOnly && claim.mode !== 'RECONCILE') throw new PolicyError('RECONCILIATION_MODE_INVALID');
  if (!/^[a-f0-9]{40}$/i.test(mission.baseCommit)) throw new PolicyError('MISSION_BASE_INVALID');
  if (!AUTONOMY.has(mission.autonomyLevel) || mission.autonomyLevel !== lease.autonomyLevel) throw new PolicyError('AUTONOMY_DENIED');
  if (mission.autonomyLevel === 'A2' && config.maxAutonomy !== 'A2') throw new PolicyError('AUTONOMY_DENIED');
  if (lease.missionId !== mission.missionId || lease.missionHash !== missionHash(mission) || lease.policyHash !== mission.policyHash) throw new PolicyError('LEASE_BINDING_MISMATCH');
  if (lease.actor !== config.workerId) throw new PolicyError('ACTOR_MISMATCH');
  if (!Number.isSafeInteger(lease.fencingToken) || lease.fencingToken < 1) throw new PolicyError('FENCING_TOKEN_INVALID');
  if (!Number.isSafeInteger(lease.expectedStateVersion) || lease.expectedStateVersion !== mission.expectedStateVersion) throw new PolicyError('STATE_VERSION_MISMATCH');
  if (!Number.isFinite(Date.parse(lease.issuedAt)) || Date.parse(lease.issuedAt) > now.getTime() + MAX_LEASE_CLOCK_SKEW_MS) throw new PolicyError('LEASE_NOT_ACTIVE');
  if (!Number.isFinite(Date.parse(lease.expiresAt)) || Date.parse(lease.expiresAt) <= now.getTime()) throw new PolicyError('LEASE_EXPIRED');
  if (!Number.isFinite(Date.parse(mission.deadline))
    || (!reconciliationOnly && Date.parse(mission.deadline) <= now.getTime())) {
    throw new PolicyError('MISSION_DEADLINE_EXPIRED');
  }
  if (!Number.isFinite(mission.budgetUsd) || mission.budgetUsd < 0 || !Number.isFinite(lease.budgetUsd) || lease.budgetUsd > mission.budgetUsd) throw new PolicyError('BUDGET_ESCALATION');
  if (!Array.isArray(mission.acceptanceCriteria) || mission.acceptanceCriteria.length === 0 || mission.acceptanceCriteria.some((item) => typeof item !== 'string' || !item.trim())) throw new PolicyError('ACCEPTANCE_CRITERIA_INVALID');
  if (!Array.isArray(mission.allowedPaths) || mission.allowedPaths.length === 0 || !Array.isArray(lease.allowedPaths)) throw new PolicyError('ALLOWED_PATHS_INVALID');
  const missionPaths = mission.allowedPaths.map(normalizeRelativePath);
  const leasePaths = lease.allowedPaths.map(normalizeRelativePath);
  if ([...missionPaths, ...leasePaths].some(isProhibitedPath)) throw new PolicyError('PROHIBITED_PATH_AUTHORITY');
  let desiredState = null;
  if (mission.desiredState !== null && mission.desiredState !== undefined) {
    const desired = mission.desiredState;
    if (!desired || typeof desired !== 'object' || Array.isArray(desired)
      || Object.keys(desired).length !== 3
      || Object.keys(desired).some((key) => !['type', 'path', 'needles'].includes(key))
      || desired.type !== 'FILE_CONTAINS_ALL' || typeof desired.path !== 'string'
      || !Array.isArray(desired.needles) || desired.needles.length < 2 || desired.needles.length > 20
      || desired.needles.some((needle) => typeof needle !== 'string' || !needle || needle.length > 500)
      || new Set(desired.needles).size !== desired.needles.length) {
      throw new PolicyError('DESIRED_STATE_INVALID');
    }
    const desiredPath = normalizeRelativePath(desired.path);
    if (isProhibitedPath(desiredPath) || !pathWithin(desiredPath, missionPaths) || !pathWithin(desiredPath, leasePaths)) {
      throw new PolicyError('DESIRED_STATE_OUTSIDE_CAPABILITY');
    }
    desiredState = { type: 'FILE_CONTAINS_ALL', path: desiredPath, needles: [...desired.needles] };
  }
  const verbs = mission.autonomyLevel === 'A1' ? A1_VERBS : A2_VERBS;
  if (!Array.isArray(lease.allowedVerbs) || lease.allowedVerbs.some((verb) => !verbs.has(verb))) throw new PolicyError('VERB_AUTHORITY_INVALID');
  if (reconciliationOnly) {
    if (lease.allowedVerbs.length !== 1 || lease.allowedVerbs[0] !== 'READ_REPOSITORY') {
      throw new PolicyError('RECONCILIATION_AUTHORITY_ESCALATION');
    }
  } else {
    if (![...A1_VERBS].every((verb) => lease.allowedVerbs.includes(verb))) throw new PolicyError('A1_AUTHORITY_MISSING');
    if (mission.autonomyLevel === 'A2' && !['PUSH_BRANCH', 'CREATE_DRAFT_PR'].every((verb) => lease.allowedVerbs.includes(verb))) throw new PolicyError('A2_EFFECT_AUTHORITY_MISSING');
  }
  if (!Array.isArray(claim.effects)) throw new PolicyError('CLAIM_EFFECTS_INVALID');
  if (claim.mode === 'EXECUTE' && claim.effects.length !== 0) throw new PolicyError('EXECUTE_EFFECTS_MUST_BE_EMPTY');
  if (claim.mode === 'RECONCILE') {
    if (mission.autonomyLevel !== 'A2') throw new PolicyError('RECONCILE_EFFECTS_INVALID');
    if (reconciliationOnly && claim.effects.length === 0) throw new PolicyError('RECONCILIATION_EFFECTS_MISSING');
    for (const effect of claim.effects) {
      if (!effect || typeof effect.effectId !== 'string' || !effect.effectId
        || !['PUSH_BRANCH', 'CREATE_DRAFT_PR'].includes(effect.verb)
        || !['RESERVED', 'DISPATCHING', 'CONFIRMED', 'FAILED', 'UNKNOWN_OUTCOME'].includes(effect.status)
        || effect.targetRepository !== mission.repository
        || effect.targetBaseBranch !== config.baseBranch
        || !/^codex\/engineering-v2-[a-z0-9-]{8,80}$/.test(effect.targetHeadBranch)
        || !/^[a-f0-9]{40}$/i.test(effect.targetCommitSha)
        || typeof effect.idempotencyKey !== 'string' || !effect.idempotencyKey) throw new PolicyError('EFFECT_BINDING_MISMATCH');
    }
  }
  return { missionPaths, leasePaths, desiredState };
}

export function assertChangedPaths(paths, missionPaths, leasePaths) {
  if (!Array.isArray(paths) || paths.length === 0) throw new PolicyError('NO_CHANGES');
  for (const rawPath of paths) {
    const path = normalizeRelativePath(rawPath);
    if (isProhibitedPath(path)) throw new PolicyError('PROHIBITED_PATH_CHANGED');
    if (!pathWithin(path, missionPaths) || !pathWithin(path, leasePaths)) throw new PolicyError('PATH_OUTSIDE_CAPABILITY');
  }
}

export function branchName(mission) {
  const slug = mission.missionId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'mission';
  return `codex/engineering-v2-${slug}-${mission.baseCommit.slice(0, 8)}`;
}
