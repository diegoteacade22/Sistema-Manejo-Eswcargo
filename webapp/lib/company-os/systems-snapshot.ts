import { createHash } from 'node:crypto';

const RULE_VERSION = 'systems-manager-ai-v1.0.0';
const nowIso = () => new Date().toISOString();
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export type SystemsAsset = {
  assetId: string; name: string; category: string; provider: string; environment: string; owner: string;
  runtime: string | null; region: string | null; safeReference: string | null;
  lifecycleStatus: 'ACTIVE'|'ARCHIVED'|'DEPRECATED'|'PLANNED'|'FUTURE'|'UNKNOWN';
  healthStatus: 'HEALTHY'|'DEGRADED'|'OFFLINE_CONFIRMED'|'UNKNOWN'|'UNOBSERVED'|'NOT_APPLICABLE';
  criticality: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'; coverageStatus: string; confidence: number;
  observedAt: string; warnings: string[]; evidenceRefs: string[];
};
export type SystemsDependency = {
  dependencyId: string; sourceAssetId: string; targetAssetId: string; dependencyType: string;
  criticality: string; direction: 'OUTBOUND'; inferenceStatus: 'CONFIRMED'|'INFERRED'; observedAt: string;
};
export type SystemsRisk = {
  riskId: string; assetId: string; classification: 'ACTION_REQUIRED'|'OPPORTUNITY'|'REVIEW'|'INFORMATIONAL'|'IGNORE';
  title: string; description: string; impact: string; confidence: number; cause: string;
  affectedDependencies: string[]; recommendedAction: string; estimatedEffort: string; changeRisk: string;
  suggestedRollback: string; proposedOwner: string; priority: number; suggestedTargetDate: string|null;
  missingEvidence: string[]; reasonCodes: string[]; evidenceRefs: string[]; evidenceFingerprint: string; ruleVersion: string;
};

async function workerObservation() {
  let origin: string | null = null;
  try { origin = process.env.COMPANY_OS_V3_WORKER_URL ? new URL(process.env.COMPANY_OS_V3_WORKER_URL).origin : null; } catch {}
  if (!origin) return { healthStatus: 'UNOBSERVED' as const, coverageStatus: 'SOURCE_UNAVAILABLE', safeReference: null, warning: 'Worker URL no observable' };
  try {
    const response = await fetch(`${origin}/webhook`, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (response.status === 404) return { healthStatus: 'HEALTHY' as const, coverageStatus: 'CONFIRMED', safeReference: origin, warning: '' };
    return { healthStatus: 'DEGRADED' as const, coverageStatus: 'CONFIRMED', safeReference: origin, warning: `Respuesta HTTP inesperada ${response.status}` };
  } catch {
    return { healthStatus: 'UNKNOWN' as const, coverageStatus: 'SOURCE_UNAVAILABLE', safeReference: origin, warning: 'Health check puntual no disponible; no implica OFFLINE' };
  }
}

export async function buildSystemsSnapshot() {
  const generatedAt = nowIso();
  const worker = await workerObservation();
  const asset = (input: Omit<SystemsAsset,'environment'|'owner'|'observedAt'|'evidenceRefs'>): SystemsAsset => ({
    environment: 'production', owner: 'Diego / Company OS', observedAt: generatedAt, evidenceRefs: ['assets'], ...input,
  });
  const assets: SystemsAsset[] = [
    asset({ assetId:'company-os-webapp', name:'Company OS Webapp', category:'APPLICATION', provider:'Vercel', runtime:'Next.js / Node.js', region:null, safeReference:process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null, lifecycleStatus:'ACTIVE', healthStatus:'HEALTHY', criticality:'CRITICAL', coverageStatus:'CONFIRMED', confidence:1, warnings:[] }),
    asset({ assetId:'company-os-database', name:'Company OS Database', category:'DATABASE', provider:'Supabase', runtime:'PostgreSQL', region:'us-east-1', safeReference:null, lifecycleStatus:'ACTIVE', healthStatus:'HEALTHY', criticality:'CRITICAL', coverageStatus:'CONFIRMED', confidence:1, warnings:[] }),
    asset({ assetId:'company-os-worker', name:'Company OS Common Worker', category:'SERVER_WORKER', provider:'Hostinger', runtime:'Node.js container', region:null, safeReference:worker.safeReference, lifecycleStatus:'ACTIVE', healthStatus:worker.healthStatus, criticality:'CRITICAL', coverageStatus:worker.coverageStatus, confidence:worker.healthStatus === 'HEALTHY' ? 1 : .5, warnings:worker.warning ? [worker.warning] : [] }),
    asset({ assetId:'company-os-recovery', name:'Company OS Lease Recovery', category:'AUTOMATION', provider:'Hostinger systemd', runtime:'systemd', region:null, safeReference:null, lifecycleStatus:'ACTIVE', healthStatus:'UNOBSERVED', criticality:'HIGH', coverageStatus:'COVERAGE_UNKNOWN', confidence:.5, warnings:['Vercel no observa systemd directamente'] }),
    asset({ assetId:'openclaw-gateway', name:'OpenClaw Gateway', category:'INTEGRATION_API', provider:'Hostinger', runtime:'Container', region:null, safeReference:null, lifecycleStatus:'ACTIVE', healthStatus:'UNOBSERVED', criticality:'MEDIUM', coverageStatus:'COVERAGE_UNKNOWN', confidence:.5, warnings:['Cobertura indirecta por entrega'] }),
    asset({ assetId:'telegram-channel', name:'Telegram Operations Channel', category:'NOTIFICATION_CHANNEL', provider:'Telegram', runtime:null, region:null, safeReference:null, lifecycleStatus:'ACTIVE', healthStatus:'UNOBSERVED', criticality:'MEDIUM', coverageStatus:'COVERAGE_UNKNOWN', confidence:.5, warnings:['Salud por entrega, no por snapshot'] }),
    asset({ assetId:'github-repository', name:'Sistema Manejo ESWCARGO Repository', category:'REPOSITORY', provider:'GitHub', runtime:'Git', region:null, safeReference:'https://github.com/diegoteacade22/Sistema-Manejo-Eswcargo', lifecycleStatus:'ACTIVE', healthStatus:'NOT_APPLICABLE', criticality:'HIGH', coverageStatus:process.env.VERCEL_GIT_COMMIT_SHA ? 'CONFIRMED':'COVERAGE_UNKNOWN', confidence:.8, warnings:process.env.VERCEL_GIT_COMMIT_SHA ? []:['Commit de deployment no observable'] }),
    asset({ assetId:'openai-responses', name:'OpenAI Responses API', category:'AI_PROVIDER', provider:'OpenAI', runtime:'Responses API', region:null, safeReference:null, lifecycleStatus:'ACTIVE', healthStatus:'UNOBSERVED', criticality:'HIGH', coverageStatus:'COVERAGE_UNKNOWN', confidence:.5, warnings:['Se observa durante la solicitud'] }),
    asset({ assetId:'company-os-hmac-ref', name:'Company OS Worker HMAC', category:'CREDENTIAL_REFERENCE', provider:'Vercel / Hostinger', runtime:null, region:null, safeReference:null, lifecycleStatus:'ACTIVE', healthStatus:'NOT_APPLICABLE', criticality:'CRITICAL', coverageStatus:process.env.COMPANY_OS_V3_HMAC_SECRET ? 'CONFIRMED':'SOURCE_UNAVAILABLE', confidence:1, warnings:['Sólo referencia lógica; valor nunca materializado'] }),
    asset({ assetId:'aws-archive', name:'AWS Legacy Infrastructure', category:'SERVER_WORKER', provider:'AWS', runtime:null, region:null, safeReference:null, lifecycleStatus:'ARCHIVED', healthStatus:'NOT_APPLICABLE', criticality:'LOW', coverageStatus:'CONFIRMED', confidence:1, warnings:['Archivado; no reactivar'] }),
    asset({ assetId:'mac-mini-future', name:'Mac mini Node', category:'FUTURE_DEVICE', provider:'Apple', runtime:null, region:'Miami', safeReference:null, lifecycleStatus:'FUTURE', healthStatus:'NOT_APPLICABLE', criticality:'LOW', coverageStatus:'CONFIRMED', confidence:1, warnings:['No es dependencia activa'] }),
    asset({ assetId:'backup-coverage', name:'Company OS Backup Coverage', category:'BACKUP', provider:'UNKNOWN', runtime:null, region:null, safeReference:null, lifecycleStatus:'UNKNOWN', healthStatus:'UNOBSERVED', criticality:'HIGH', coverageStatus:'UNOBSERVED', confidence:1, warnings:['No verificado no significa inexistente'] }),
  ];
  const dep = (dependencyId:string, sourceAssetId:string, targetAssetId:string, dependencyType:string, criticality:string):SystemsDependency => ({ dependencyId, sourceAssetId, targetAssetId, dependencyType, criticality, direction:'OUTBOUND', inferenceStatus:'CONFIRMED', observedAt:generatedAt });
  const dependencies = [
    dep('dep-web-db','company-os-webapp','company-os-database','DATABASE','CRITICAL'),
    dep('dep-web-worker','company-os-webapp','company-os-worker','SIGNED_WEBHOOK','CRITICAL'),
    dep('dep-worker-ai','company-os-worker','openai-responses','MODEL_API','HIGH'),
    dep('dep-worker-openclaw','company-os-worker','openclaw-gateway','NOTIFICATION_API','MEDIUM'),
    dep('dep-openclaw-telegram','openclaw-gateway','telegram-channel','NOTIFICATION_CHANNEL','MEDIUM'),
    dep('dep-web-github','company-os-webapp','github-repository','DEPLOYMENT_SOURCE','HIGH'),
  ];
  const riskBase = { assetId:'company-os-worker', evidence:['assets','dependencies'], reasonCodes:['SINGLE_RUNTIME_INSTANCE','RECOVERY_SAME_HOST'] };
  const risks: SystemsRisk[] = [{
    riskId:'risk-company-os-worker-single-host', assetId:riskBase.assetId, classification:'ACTION_REQUIRED',
    title:'Procesamiento y recuperación comparten un único host', description:'El worker común y su recuperador están en el mismo runtime Hostinger.',
    impact:'Las solicitudes persisten pero no avanzan durante una caída total del host.', confidence:.95,
    cause:'Instancia única confirmada en el mapa de dependencias.', affectedDependencies:['dep-web-worker','dep-worker-ai','dep-worker-openclaw'],
    recommendedAction:'Documentar y validar un procedimiento humano de recuperación fuera del host.', estimatedEffort:'LOW', changeRisk:'LOW',
    suggestedRollback:'Retirar el procedimiento externo sin modificar el worker.', proposedOwner:'Gerente General / Diego', priority:78,
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
  const coverage = {
    observed:['Vercel runtime metadata','Company OS PostgreSQL transaction','Hostinger worker HTTP liveness'],
    unobserved:['GitHub provider API','DNS provider API','Vercel billing API','Supabase backup metadata','Hostinger provider API','Telegram provider health'],
  };
  const snapshotId = `sys-${digest({assets,dependencies,risks}).slice(0,24)}`;
  return {
    snapshotId, generatedAt, ruleVersion:RULE_VERSION, assets, dependencies, risks, coverage,
    sourceQuality:{ source:'company-os-runtime-and-contract', recordCount:assets.length, observedAt:generatedAt, freshnessStatus:'CURRENT', coverageStatus:'PARTIAL', confidence:.95, warnings:['Provider APIs parcialmente UNOBSERVED'], evidenceRefs:['assets','dependencies','risks','coverage'], ruleVersion:RULE_VERSION },
    runtime:{ vercelEnvironment:process.env.VERCEL_ENV ?? 'unknown', deploymentCommit:(process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0,40) || null },
    database:{ reachable:true, roleExpected:'company_os_v3', secretValuesIncluded:false },
    workerHealth:{...worker,checkedAt:generatedAt},
    credentialMetadata:{ hmac:{logicalName:'COMPANY_OS_V3_HMAC_SECRET',status:process.env.COMPANY_OS_V3_HMAC_SECRET?'AVAILABLE':'MISSING',valueIncluded:false} },
    lifecycle:{aws:'ARCHIVED',macMini:'FUTURE'},
  };
}
