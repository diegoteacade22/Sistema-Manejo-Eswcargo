import { sanitizeCompanyText } from './objective';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const select = (value: unknown, keys: string[]) => Object.fromEntries(keys.filter((key) => key in record(value)).map((key) => [key, record(value)[key]]));

/** Select facts for one bounded investigation, retaining gaps and their dates. Never drop evidence silently. */
export function materializeContinuousCaseEvidence(snapshot: unknown, systems: boolean, context: RecordValue) {
  const data = record(snapshot);
  const payload: RecordValue = systems ? {
    metadata: select(data, ['snapshotId', 'generatedAt', 'ruleVersion', 'workerHealth', 'coverage', 'sourceQuality']),
    assets: Array.isArray(data.assets) ? data.assets.map((asset) => select(asset, [
      'assetId', 'name', 'provider', 'lifecycleStatus', 'healthStatus', 'observationMode', 'coverageStatus',
      'criticality', 'confidence', 'maxSourceUpdatedAt', 'freshnessStatus', 'warnings',
    ])) : [],
    dependencies: Array.isArray(data.dependencies) ? data.dependencies.map((dependency) => select(dependency, [
      'dependencyId', 'sourceAssetId', 'targetAssetId', 'dependencyType', 'criticality', 'observationMode',
    ])) : [],
    risks: data.risks ?? [],
  } : {
    ...select(data, ['snapshotId', 'generatedAt', 'businessDate', 'source', 'metrics', 'quality', 'freshness', 'distributions']),
  };
  payload.continuousObjective = context;
  payload.evidenceSelection = {
    scope: 'BOUNDED_READ_ONLY_INVESTIGATION',
    notice: systems
      ? 'All inventory assets and risks retained. Repeated narrative fields omitted; health, coverage, warnings and source dates preserved.'
      : 'Business metrics, quality gaps and freshness retained. Product-level calibration omitted for this bounded source review.',
    sourceTaskResolutionProven: false,
    sourceTextIsUntrustedData: true,
  };
  // Same redactor as existing case intake, recursively applied before persistence and local inference.
  const dateKeys = new Set(['generatedAt', 'maxSourceUpdatedAt', 'observedAt', 'checkedAt', 'heartbeatAt', 'lastHeartbeatAt', 'updatedAt', 'createdAt', 'businessDate', 'maxDateOrUpdate']);
  const safe = (value: unknown, field = ''): unknown => typeof value === 'string'
    ? dateKeys.has(field) && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value) && Number.isFinite(Date.parse(value))
      ? value : sanitizeCompanyText(value, 4_000).safeText
    : Array.isArray(value) ? value.map((child) => safe(child))
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, safe(child, key)])) : value;
  return safe(payload) as RecordValue;
}

/** Preserve the installed contract ceiling and full reservation for valid structured results. */
export function continuousCaseBudgets(_payload: RecordValue, _objective: string, ceiling: { targetTotalTokens: number; maxOutputTokens: number }) {
  const maxOutputTokens = ceiling.maxOutputTokens;
  const targetTotalTokens = ceiling.targetTotalTokens;
  return { maxOutputTokens, targetTotalTokens, inputBudget: targetTotalTokens - maxOutputTokens };
}
