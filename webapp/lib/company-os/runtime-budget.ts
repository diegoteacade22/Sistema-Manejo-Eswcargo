const TIME_ZONE = 'America/New_York';

function localDate(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid runtime budget clock');
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

function localMidnight(year: number, month: number, day: number) {
  const desired = Date.UTC(year, month - 1, day);
  const normalized = new Date(desired);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  let candidate = desired;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const represented = Object.fromEntries(formatter.formatToParts(new Date(candidate))
      .filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
    candidate += normalized.getTime() - Date.UTC(represented.year, represented.month - 1, represented.day, represented.hour, represented.minute, represented.second);
  }
  return new Date(candidate);
}

export function startOfZonedPeriod(now: Date, period: 'day' | 'month') {
  const parts = localDate(now);
  return localMidnight(parts.year, parts.month, period === 'month' ? 1 : parts.day);
}

export function nextRuntimeBudgetReset(now: Date, period: 'day' | 'month') {
  const parts = localDate(now);
  return period === 'month'
    ? localMidnight(parts.year, parts.month + 1, 1)
    : localMidnight(parts.year, parts.month, parts.day + 1);
}

export type RuntimeBudgetPlan =
  | { allowed: true }
  | { allowed: false; reason: 'DAILY' | 'MONTHLY' | 'DAILY_AND_MONTHLY'; retryAt: Date }
  | { allowed: false; reason: 'REQUEST_EXCEEDS_LIMIT'; retryAt: null };

export type RuntimeBudgetInput = {
  now: Date; dailyUsed: number; monthlyUsed: number; reserved: number;
  requested: number; dailyLimit: number; monthlyLimit: number;
};

export function planRuntimeBudget(input: RuntimeBudgetInput): RuntimeBudgetPlan {
  for (const [key, value] of Object.entries(input)) {
    if (key !== 'now' && (!Number.isSafeInteger(value) || Number(value) < 0)) throw new Error(`Invalid runtime budget ${key}`);
  }
  if (input.requested < 1 || input.dailyLimit < 1 || input.monthlyLimit < 1) throw new Error('Invalid runtime budget limits');
  localDate(input.now);
  if (input.requested > input.dailyLimit || input.requested > input.monthlyLimit) {
    return { allowed: false, reason: 'REQUEST_EXCEEDS_LIMIT', retryAt: null };
  }
  const daily = input.dailyUsed + input.reserved + input.requested > input.dailyLimit;
  const monthly = input.monthlyUsed + input.reserved + input.requested > input.monthlyLimit;
  if (!daily && !monthly) return { allowed: true };
  return {
    allowed: false,
    reason: daily && monthly ? 'DAILY_AND_MONTHLY' : monthly ? 'MONTHLY' : 'DAILY',
    retryAt: nextRuntimeBudgetReset(input.now, monthly ? 'month' : 'day'),
  };
}

export type AdaptiveRuntimeBudgetPlan = RuntimeBudgetPlan & {
  requestedTokens: number;
  targetTotalTokens: number;
  maxOutputTokens: number;
  adapted: boolean;
};

/** Reduce output only. The existing input allowance and account limits are unchanged. */
export function planAdaptiveRuntimeBudget(input: RuntimeBudgetInput & {
  targetTotalTokens: number;
  maxOutputTokens: number;
}): AdaptiveRuntimeBudgetPlan {
  const originalPlan = planRuntimeBudget(input);
  if (!Number.isSafeInteger(input.targetTotalTokens) || input.targetTotalTokens < 1
    || !Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1
    || input.maxOutputTokens >= input.targetTotalTokens
    || input.requested > input.targetTotalTokens
    || !Number.isSafeInteger(input.dailyUsed + input.reserved)
    || !Number.isSafeInteger(input.monthlyUsed + input.reserved)) {
    throw new Error('Invalid adaptive runtime budget');
  }
  const unchanged = {
    requestedTokens: input.requested,
    targetTotalTokens: input.targetTotalTokens,
    maxOutputTokens: input.maxOutputTokens,
    adapted: false,
  };
  const inputAllowance = input.targetTotalTokens - input.maxOutputTokens;
  const minimumOutput = Math.min(1_000, input.maxOutputTokens);
  if (input.requested < inputAllowance + minimumOutput) {
    throw new Error('Runtime reservation cannot preserve the input allowance and minimum output');
  }
  // An impossible original reservation is a configuration error, not permission
  // to weaken its signed contract until it happens to fit an account limit.
  if (!originalPlan.allowed && originalPlan.reason === 'REQUEST_EXCEEDS_LIMIT') {
    return { ...originalPlan, ...unchanged };
  }
  const targetTotalTokens = Math.min(
    input.requested,
    input.targetTotalTokens,
    input.dailyLimit - input.dailyUsed - input.reserved,
    input.monthlyLimit - input.monthlyUsed - input.reserved,
  );
  if (targetTotalTokens < inputAllowance + minimumOutput) {
    return { ...originalPlan, ...unchanged };
  }
  const maxOutputTokens = targetTotalTokens - inputAllowance;
  const admitted = planRuntimeBudget({ ...input, requested: targetTotalTokens });
  if (!admitted.allowed) throw new Error('Adaptive runtime budget failed its admission gate');
  return {
    ...admitted,
    requestedTokens: targetTotalTokens,
    targetTotalTokens,
    maxOutputTokens,
    adapted: targetTotalTokens !== input.targetTotalTokens || targetTotalTokens !== input.requested,
  };
}
