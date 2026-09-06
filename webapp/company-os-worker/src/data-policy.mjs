/** A local case remains local through every specialist/manager return. */
export function requiresLocalInference(claim) {
  if (claim?.agentId === 'data-manager-ai-v1') return true;
  const policy = claim?.dataPolicy;
  // Missing policy is accepted for older API claims; the Data identity stays fenced.
  if (policy === undefined) return false;
  // Unknown or inconsistent policies fail closed to loopback inference.
  return policy?.version !== 1
    || policy.inference !== 'STANDARD'
    || policy.reason !== 'DEFAULT';
}
