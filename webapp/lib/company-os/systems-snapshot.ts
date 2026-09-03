import { createHash } from 'node:crypto';
import { deriveSystemsRuntimeObservation, type SystemsRuntimeReadback } from './systems-runtime-observation';
import { readSystemsRuntimeWorkers } from './systems-runtime-reader';

const RULE_VERSION = 'systems-manager-ai-v1.0.0';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const SYSTEMS_OBSERVATION_MODES = ['LIVE_OBSERVED', 'DECLARED_FROM_CONFIG', 'INFERRED', 'UNOBSERVED'] as const;
export type SystemsObservationMode = (typeof SYSTEMS_OBSERVATION_MODES)[number];
// Keep these values aligned with CompanyOsSystemDependency_dependencyType_check.
export const SYSTEMS_DEPENDENCY_TYPES = [
  'DATABASE', 'SIGNED_WEBHOOK', 'MODEL_API', 'NOTIFICATION_API', 'NOTIFICATION_CHANNEL',
  'DEPLOYMENT_SOURCE', 'RUNTIME', 'DATA', 'AUTH', 'NETWORK', 'DEPLOYMENT', 'OBSERVABILITY',
  'MANUAL', 'OTHER',
] as const;
export type SystemsDependencyType = (typeof SYSTEMS_DEPENDENCY_TYPES)[number];

export type SystemsAsset = {
  assetId: string; name: string; category: string; provider: string; companyOrBusinessUnit: string; environment: string; owner: string;
  repository: string | null; projectOrService: string | null;
  runtime: string | null; region: string | null; safeReference: string | null;
  lifecycleStatus: 'ACTIVE'|'ARCHIVED'|'DEPRECATED'|'PLANNED'|'FUTURE'|'UNKNOWN';
  healthStatus: 'HEALTHY'|'DEGRADED'|'OFFLINE_CONFIRMED'|'UNKNOWN'|'UNOBSERVED'|'NOT_APPLICABLE';
  observationMode: SystemsObservationMode; observationLabel: string;
  criticality: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'; coverageStatus: string; confidence: number;
  observedAt: string; maxSourceUpdatedAt: string | null; freshnessStatus: 'CURRENT'|'STALE'|'UNKNOWN';
  warnings: string[]; evidenceRefs: string[]; tags: string[]; ruleVersion: string;
};
export type SystemsDependency = {
  dependencyId: string; sourceAssetId: string; targetAssetId: string; dependencyType: SystemsDependencyType;
  criticality: string; direction: 'OUTBOUND'; environment: string; evidenceRefs: string[]; confidence: number;
  estimatedFailureImpact: string; knownFallback: string | null; inferenceStatus: 'CONFIRMED'|'INFERRED'; observedAt: string;
  observationMode: SystemsObservationMode;
};
export type SystemsRisk = {
  riskId: string; assetId: string; classification: 'ACTION_REQUIRED'|'OPPORTUNITY'|'REVIEW'|'INFORMATIONAL'|'IGNORE';
  title: string; description: string; impact: string; confidence: number; cause: string;
  affectedDependencies: string[]; recommendedAction: string; estimatedEffort: string; changeRisk: string;
  suggestedRollback: string; proposedOwner: string; priority: number; suggestedTargetDate: string|null;
  missingEvidence: string[]; reasonCodes: string[]; evidenceRefs: string[]; evidenceFingerprint: string; ruleVersion: string;
};

export function deterministicRiskScore(input: {
  impact: number; probability: number; urgency: number; assetCriticality: number; blastRadius: number;
  fallbackCoverage: number; age: number; confidence: number; evidenceQuality: number; solutionReversibility: number;
}) {
  const bounded = (value: number) => Math.max(0, Math.min(1, value));
  return Math.round(
    bounded(input.impact) * 20 + bounded(input.probability) * 15 + bounded(input.urgency) * 10
    + bounded(input.assetCriticality) * 15 + bounded(input.blastRadius) * 10
    + (1 - bounded(input.fallbackCoverage)) * 10 + bounded(input.age) * 5
    + bounded(input.confidence) * 5 + bounded(input.evidenceQuality) * 5 + bounded(input.solutionReversibility) * 5,
  );
}

export async function buildSystemsSnapshot(options: {
  now?: Date;
  loadRuntimeWorkers?: () => Promise<SystemsRuntimeReadback>;
} = {}) {
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const worker = deriveSystemsRuntimeObservation(await (options.loadRuntimeWorkers ?? readSystemsRuntimeWorkers)(), now);
  const runtimeHost = worker.host ?? 'DiegoServer (declarado; sin heartbeat vigente)';
  const asset = (input: Omit<SystemsAsset,'companyOrBusinessUnit'|'environment'|'owner'|'repository'|'projectOrService'|'observedAt'|'maxSourceUpdatedAt'|'freshnessStatus'|'evidenceRefs'|'tags'|'ruleVersion'>): SystemsAsset => ({
    companyOrBusinessUnit: 'Company OS / ESWCARGO', environment: 'production', owner: 'Diego / Company OS',
    repository: input.assetId === 'github-repository' ? 'diegoteacade22/Sistema-Manejo-Eswcargo' : null,
    projectOrService: input.name, observedAt: generatedAt,
    maxSourceUpdatedAt: input.observationMode === 'LIVE_OBSERVED' ? generatedAt : null,
    freshnessStatus: input.observationMode === 'LIVE_OBSERVED' ? 'CURRENT' : 'UNKNOWN',
    evidenceRefs: ['assets'], tags: [input.category.toLowerCase(), input.provider.toLowerCase()], ruleVersion: RULE_VERSION, ...input,
  });
  const assets: SystemsAsset[] = [
    asset({ assetId:'company-os-webapp', name:'Company OS Webapp', category:'APPLICATION', provider:'Vercel', runtime:'Next.js / Node.js', region:null, safeReference:process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null, lifecycleStatus:'ACTIVE', healthStatus:'UNKNOWN', observationMode:'DECLARED_FROM_CONFIG', observationLabel:'Declarado desde metadata del deployment; sin health check independiente', criticality:'CRITICAL', coverageStatus:'DECLARED', confidence:.75, warnings:['La configuración no demuestra disponibilidad de Vercel'] }),
    asset({ assetId:'company-os-database', name:'Company OS Database', category:'DATABASE', provider:'Supabase', runtime:'PostgreSQL', region:'us-east-1', safeReference:null, lifecycleStatus:'ACTIVE', healthStatus:'HEALTHY', observationMode:'LIVE_OBSERVED', observationLabel:'Observado por la transacción PostgreSQL actual que materializa este snapshot', criticality:'CRITICAL', coverageStatus:'CONFIRMED', confidence:1, warnings:[] }),
    { ...asset({ assetId:'company-os-worker', name:'Company OS Runtime 24/7', category:'SERVER_WORKER', provider:runtimeHost, runtime:'Node.js daemon / launchd', region:null, safeReference:worker.safeReference, lifecycleStatus:'ACTIVE', healthStatus:worker.healthStatus, observationMode:worker.observationMode, observationLabel:worker.observationLabel, criticality:'CRITICAL', coverageStatus:worker.coverageStatus, confidence:worker.healthStatus === 'HEALTHY' ? 1 : .5, warnings:worker.warning ? [worker.warning] : [] }), maxSourceUpdatedAt:worker.heartbeatAt, freshnessStatus:worker.freshnessStatus },
    asset({ assetId:'company-os-recovery', name:'Company OS Lease Recovery', category:'AUTOMATION', provider:runtimeHost, runtime:'Runtime 24/7 reconcile loop', region:null, safeReference:worker.safeReference, lifecycleStatus:'ACTIVE', healthStatus:'UNOBSERVED', observationMode:'DECLARED_FROM_CONFIG', observationLabel:'Recuperación integrada en el daemon 24/7; el heartbeat no prueba por sí solo una recuperación', criticality:'HIGH', coverageStatus:'DECLARED', confidence:.9, warnings:['Validar una recuperación requiere eventos y leases persistidos'] }),
    asset({ assetId:'openclaw-hostinger-legacy', name:'OpenClaw Hostinger (referencia histórica)', category:'SERVER_WORKER', provider:'Hostinger', runtime:'OpenClaw', region:null, safeReference:null, lifecycleStatus:'UNKNOWN', healthStatus:'UNOBSERVED', observationMode:'DECLARED_FROM_CONFIG', observationLabel:'Infraestructura OpenClaw histórica distinta del runtime Company OS; estado actual no verificado aquí', criticality:'MEDIUM', coverageStatus:'DECLARED', confidence:.8, warnings:['No se afirma que Hostinger u OpenClaw estén apagados'] }),
    asset({ assetId:'telegram-channel', name:'Telegram Operations Channel', category:'NOTIFICATION_CHANNEL', provider:'Telegram', runtime:null, region:null, safeReference:null, lifecycleStatus:'ACTIVE', healthStatus:'UNOBSERVED', observationMode:'INFERRED', observationLabel:'Inferido por entregas de casos; sin health del proveedor', criticality:'MEDIUM', coverageStatus:'COVERAGE_UNKNOWN', confidence:.5, warnings:['Salud por entrega, no por snapshot'] }),
    asset({ assetId:'github-repository', name:'Sistema Manejo ESWCARGO Repository', category:'REPOSITORY', provider:'GitHub', runtime:'Git', region:null, safeReference:'https://github.com/diegoteacade22/Sistema-Manejo-Eswcargo', lifecycleStatus:'ACTIVE', healthStatus:'NOT_APPLICABLE', observationMode:'DECLARED_FROM_CONFIG', observationLabel:'Declarado desde metadata Git del deployment', criticality:'HIGH', coverageStatus:process.env.VERCEL_GIT_COMMIT_SHA ? 'DECLARED':'COVERAGE_UNKNOWN', confidence:.8, warnings:process.env.VERCEL_GIT_COMMIT_SHA ? []:['Commit de deployment no observable'] }),
    asset({ assetId:'openai-responses', name:'OpenAI Responses API', category:'AI_PROVIDER', provider:'OpenAI', runtime:'Responses API', region:null, safeReference:null, lifecycleStatus:'ACTIVE', healthStatus:'UNOBSERVED', observationMode:'INFERRED', observationLabel:'Inferido por consumo del caso; sin health independiente', criticality:'HIGH', coverageStatus:'COVERAGE_UNKNOWN', confidence:.5, warnings:['Se observa durante la solicitud'] }),
    asset({ assetId:'ollama-qwen-local', name:'Ollama Qwen Local', category:'AI_PROVIDER', provider:'Ollama', runtime:'qwen3:4b-q4_K_M (Data y retornos locales); qwen3:14b-q4_K_M (fallback)', region:'DiegoServer', safeReference:null, lifecycleStatus:'ACTIVE', healthStatus:'UNOBSERVED', observationMode:'DECLARED_FROM_CONFIG', observationLabel:'Modelos declarados por el worker: 4b para linaje Data, 14b para fallback; disponibilidad de inferencia no medida por este snapshot', criticality:'HIGH', coverageStatus:'DECLARED', confidence:.9, warnings:['Vercel no puede observar el endpoint loopback de DiegoServer'] }),
    asset({ assetId:'company-os-hmac-ref', name:'Company OS Runtime HMAC', category:'CREDENTIAL_REFERENCE', provider:'Vercel / DiegoServer Keychain', runtime:null, region:null, safeReference:null, lifecycleStatus:'ACTIVE', healthStatus:'NOT_APPLICABLE', observationMode:'DECLARED_FROM_CONFIG', observationLabel:'Referencia lógica de autenticación del runtime 24/7; no se lee ningún secreto', criticality:'CRITICAL', coverageStatus:'DECLARED', confidence:1, warnings:['Sólo referencia lógica; valor nunca materializado'] }),
    asset({ assetId:'aws-archive', name:'AWS Legacy Infrastructure', category:'SERVER_WORKER', provider:'AWS', runtime:null, region:null, safeReference:null, lifecycleStatus:'ARCHIVED', healthStatus:'NOT_APPLICABLE', observationMode:'DECLARED_FROM_CONFIG', observationLabel:'Declarado archivado por contrato', criticality:'LOW', coverageStatus:'DECLARED', confidence:1, warnings:['Archivado; no reactivar'] }),
    asset({ assetId:'diegoserver-node', name:'DiegoServer Mac mini Node', category:'SERVER_WORKER', provider:'Apple', runtime:'launchd / Ollama', region:'Miami', safeReference:null, lifecycleStatus:'ACTIVE', healthStatus:'UNOBSERVED', observationMode:'DECLARED_FROM_CONFIG', observationLabel:'Nodo local activo por contrato; salud verificable sólo desde DiegoServer', criticality:'HIGH', coverageStatus:'DECLARED', confidence:.9, warnings:['Vercel no observa launchd ni loopback local directamente'] }),
    asset({ assetId:'backup-coverage', name:'Company OS Backup Coverage', category:'BACKUP', provider:'UNKNOWN', runtime:null, region:null, safeReference:null, lifecycleStatus:'UNKNOWN', healthStatus:'UNOBSERVED', observationMode:'UNOBSERVED', observationLabel:'Sin fuente de backup conectada', criticality:'HIGH', coverageStatus:'UNOBSERVED', confidence:1, warnings:['No verificado no significa inexistente'] }),
  ];
  const dep = (dependencyId:string, sourceAssetId:string, targetAssetId:string, dependencyType:SystemsDependencyType, criticality:string):SystemsDependency => ({
    dependencyId, sourceAssetId, targetAssetId, dependencyType, criticality, direction:'OUTBOUND', environment:'production',
    evidenceRefs:['dependencies'], confidence:.95, estimatedFailureImpact:criticality === 'CRITICAL' ? 'Interrumpe el procesamiento de Company OS' : 'Degrada una capacidad técnica',
    knownFallback:null, inferenceStatus:'CONFIRMED', observationMode:'DECLARED_FROM_CONFIG', observedAt:generatedAt,
  });
  const dependencies = [
    dep('dep-web-db','company-os-webapp','company-os-database','DATABASE','CRITICAL'),
    dep('dep-web-worker','company-os-worker','company-os-webapp','AUTH','CRITICAL'),
    dep('dep-worker-host','company-os-worker','diegoserver-node','RUNTIME','CRITICAL'),
    dep('dep-recovery-host','company-os-recovery','diegoserver-node','RUNTIME','HIGH'),
    dep('dep-worker-ai','company-os-worker','openai-responses','MODEL_API','HIGH'),
    dep('dep-worker-qwen','diegoserver-node','ollama-qwen-local','MODEL_API','HIGH'),
    dep('dep-worker-telegram','company-os-worker','telegram-channel','NOTIFICATION_API','MEDIUM'),
    dep('dep-web-github','company-os-webapp','github-repository','DEPLOYMENT_SOURCE','HIGH'),
  ];
  const riskBase = { assetId:'company-os-worker', evidence:['assets','dependencies'], reasonCodes:['SINGLE_RUNTIME_INSTANCE','RECOVERY_SAME_HOST'] };
  const risks: SystemsRisk[] = [{
    riskId:'risk-company-os-worker-single-host', assetId:riskBase.assetId, classification:worker.observationMode === 'LIVE_OBSERVED' && worker.observedHostCount === 1 ? 'ACTION_REQUIRED' : 'REVIEW',
    title:'Procesamiento y recuperación comparten el runtime 24/7', description:`El worker Company OS y su reconciliación están declarados en ${runtimeHost}. El registro actual observa ${worker.observedHostCount} hosts con heartbeat reciente; no se ha verificado recuperación fuera del host.`,
    impact:'Las solicitudes persisten pero pueden detenerse durante una caída total del host.', confidence:worker.observationMode === 'LIVE_OBSERVED' ? .95 : .5,
    cause:worker.observationMode === 'LIVE_OBSERVED' ? 'Host del worker observado por heartbeat; recuperador integrado según el contrato del runtime.' : 'La ubicación actual no tiene heartbeat vigente; la referencia DiegoServer es declarada.', affectedDependencies:['dep-web-worker','dep-worker-host','dep-recovery-host'],
    recommendedAction:'Documentar y validar un procedimiento humano de recuperación fuera del host.', estimatedEffort:'LOW', changeRisk:'LOW',
    suggestedRollback:'Retirar el procedimiento externo sin modificar el worker.', proposedOwner:'Gerente General / Diego',
    priority:worker.observationMode === 'LIVE_OBSERVED' && worker.observedHostCount === 1 ? deterministicRiskScore({ impact:.8, probability:.6, urgency:.7, assetCriticality:1, blastRadius:.8, fallbackCoverage:.2, age:.5, confidence:.95, evidenceQuality:.95, solutionReversibility:.9 }) : 0,
    suggestedTargetDate:null, missingEvidence:['Tiempo de recuperación probado'], reasonCodes:riskBase.reasonCodes,
    evidenceRefs:riskBase.evidence, evidenceFingerprint:digest(riskBase), ruleVersion:RULE_VERSION,
  },{
    riskId:'gap-backup-observability', assetId:'backup-coverage', classification:'REVIEW',
    title:'Cobertura de backups no observable', description:'No hay evidencia cerrada sobre existencia, frescura o restaurabilidad.',
    impact:'No puede cuantificarse la recuperación de datos.', confidence:1, cause:'Fuente no conectada; no implica backup inexistente.',
    affectedDependencies:[], recommendedAction:'Conectar metadatos read-only o evidencia de restauración.', estimatedEffort:'MEDIUM', changeRisk:'LOW',
    suggestedRollback:'Retirar el conector read-only.', proposedOwner:'Diego', priority:0, suggestedTargetDate:null,
    missingEvidence:['Proveedor','último backup','última restauración'], reasonCodes:['COVERAGE_UNKNOWN','BACKUP_NOT_VERIFIED'],
    evidenceRefs:['coverage'], evidenceFingerprint:digest({assetId:'backup-coverage',status:'UNOBSERVED'}), ruleVersion:RULE_VERSION,
  }];
  const coverageKey: Record<SystemsObservationMode, 'observed'|'declared'|'inferred'|'unobserved'> = {
    LIVE_OBSERVED:'observed', DECLARED_FROM_CONFIG:'declared', INFERRED:'inferred', UNOBSERVED:'unobserved',
  };
  const coverage = { observed:[] as string[], declared:[] as string[], inferred:[] as string[], unobserved:[] as string[] };
  for (const item of assets) coverage[coverageKey[item.observationMode]].push(`${item.name}: ${item.observationLabel}`);
  const snapshotId = `sys-${digest({assets,dependencies,risks}).slice(0,24)}`;
  return {
    snapshotId, generatedAt, ruleVersion:RULE_VERSION, assets, dependencies, risks, coverage,
    sourceQuality:{ source:'company-os-runtime-and-contract', recordCount:assets.length, observedAt:generatedAt, freshnessStatus:'CURRENT', coverageStatus:'PARTIAL', confidence:.95, warnings:['Provider APIs parcialmente UNOBSERVED'], evidenceRefs:['assets','dependencies','risks','coverage'], ruleVersion:RULE_VERSION },
    runtime:{ vercelEnvironment:process.env.VERCEL_ENV ?? 'unknown', deploymentCommit:(process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0,40) || null },
    database:{ reachable:true, roleExpected:'company_os_v3', secretValuesIncluded:false },
    workerHealth:{...worker,checkedAt:generatedAt},
    credentialMetadata:{ hmac:{logicalName:'COMPANY_OS_RUNTIME_HMAC_SECRET',status:'DECLARED',valueIncluded:false} },
    lifecycle:{aws:'ARCHIVED',diegoServer:'ACTIVE',macMini:'ACTIVE'},
  };
}
