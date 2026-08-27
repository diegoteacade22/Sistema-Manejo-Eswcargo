import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  COMPANY_OS_INSTALLED_AGENT_IDS,
  COMPANY_OS_MANDATORY_PROHIBITED_ACTIONS,
  COMPANY_OS_MANDATORY_PROHIBITED_TABLES,
  COMPANY_OS_RUNTIME_CONTRACT_VERSION,
  COMPANY_OS_RUNTIME_CONTRACT_VERSIONS,
  COMPANY_OS_RUNTIME_CONTRACTS,
  COMPANY_OS_TEAM_MANIFEST,
  COMPANY_OS_TIME_ZONE,
  getCompanyOsAgentStatus,
  getCompanyOsRuntimeContract,
  getCompanyOsRuntimeOutputSchema,
  getCompanyOsScheduleObjective,
  getInstalledCompanyOsAgentIds,
  validateCompanyOsRuntimeContract,
  validateCompanyOsRuntimeOutput,
} from '../lib/company-os/runtime-contracts';

const CANONICAL_CONTRACT_MIGRATION_URL = new URL(
  '../../supabase/migrations/20260826005735_company_os_runtime_contract_3_1_1.sql',
  import.meta.url,
);

function extractDollarQuotedJson(sql: string, delimiter: string): unknown {
  const marker = `$${delimiter}$`;
  const start = sql.indexOf(marker);
  assert.notEqual(start, -1, `missing SQL delimiter ${marker}`);
  const end = sql.indexOf(marker, start + marker.length);
  assert.notEqual(end, -1, `unterminated SQL delimiter ${marker}`);
  return JSON.parse(sql.slice(start + marker.length, end).trim());
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

test('keeps the append-only SQL revisions materially identical to the TypeScript contracts', () => {
  const sql = readFileSync(CANONICAL_CONTRACT_MIGRATION_URL, 'utf8');
  const persistedContracts = {
    'general-manager-ai-v3': extractDollarQuotedJson(
      sql,
      'company_os_general_manager_contract',
    ),
    'systems-manager-ai-v1': extractDollarQuotedJson(
      sql,
      'company_os_systems_manager_contract',
    ),
  };

  for (const agentId of COMPANY_OS_INSTALLED_AGENT_IDS) {
    const expected = COMPANY_OS_RUNTIME_CONTRACTS[agentId];
    const persisted = persistedContracts[agentId];
    assert.equal(canonicalJson(persisted), canonicalJson(expected));
    assert.equal(
      (persisted as { version: string }).version,
      COMPANY_OS_RUNTIME_CONTRACT_VERSIONS[agentId],
    );
    assert.ok(
      sql.includes(
        `'agent-contract:${agentId}:${COMPANY_OS_RUNTIME_CONTRACT_VERSIONS[agentId]}'`,
      ),
    );
  }

  assert.match(
    sql,
    /ON CONFLICT \("agentId", "contractVersion"\) DO NOTHING/,
  );
  assert.doesNotMatch(
    sql,
    /\b(?:UPDATE|DELETE)\s+public\."CompanyOsAgentContract"/i,
  );
  assert.doesNotMatch(sql, /jsonb_set\s*\(/i);
  assert.equal((sql.match(/AND contract = [a-z_]+_contract/g) ?? []).length, 2);
});

test('publishes only the two verified, versioned advisory handlers', () => {
  assert.deepEqual(getInstalledCompanyOsAgentIds(), [
    'general-manager-ai-v3',
    'systems-manager-ai-v1',
  ]);
  assert.deepEqual(COMPANY_OS_INSTALLED_AGENT_IDS, [
    'general-manager-ai-v3',
    'systems-manager-ai-v1',
  ]);

  for (const agentId of COMPANY_OS_INSTALLED_AGENT_IDS) {
    const contract = getCompanyOsRuntimeContract(agentId);
    assert.equal(
      contract.version,
      COMPANY_OS_RUNTIME_CONTRACT_VERSIONS[agentId],
    );
    assert.match(contract.version, /^\d+\.\d+\.\d+$/);
    assert.match(COMPANY_OS_RUNTIME_CONTRACT_VERSION, /^\d+\.\d+\.\d+$/);
    assert.equal(contract.advisoryOnly, true);
    assert.equal(contract.timeZone, COMPANY_OS_TIME_ZONE);
    assert.equal(contract.inputSchema.additionalProperties, false);
    assert.equal(contract.outputSchema.additionalProperties, false);
  }
});

test('fails closed for unknown, uninstalled, malformed, and over-permissive contracts', () => {
  assert.throws(
    () => getCompanyOsAgentStatus('typo-agent-ai-v1'),
    /Unknown Company OS agent/,
  );
  assert.throws(
    () => getCompanyOsRuntimeContract('data-manager-ai-v1'),
    /NOT_INSTALLED/,
  );

  const general = structuredClone(
    COMPANY_OS_RUNTIME_CONTRACTS['general-manager-ai-v3'],
  ) as Record<string, unknown>;
  delete general.timeZone;
  assert.throws(
    () => validateCompanyOsRuntimeContract(general),
    /missing required field timeZone/,
  );

  const writeEnabled = structuredClone(
    COMPANY_OS_RUNTIME_CONTRACTS['systems-manager-ai-v1'],
  ) as Record<string, unknown>;
  writeEnabled.advisoryOnly = false;
  assert.throws(
    () => validateCompanyOsRuntimeContract(writeEnabled),
    /advisoryOnly must be true/,
  );
});

test('every installed contract carries the complete business mutation deny-list', () => {
  for (const contract of Object.values(COMPANY_OS_RUNTIME_CONTRACTS)) {
    for (const table of COMPANY_OS_MANDATORY_PROHIBITED_TABLES) {
      assert.ok(contract.prohibitedTables.includes(table));
    }
    for (const action of COMPANY_OS_MANDATORY_PROHIBITED_ACTIONS) {
      assert.ok(contract.prohibitedActions.includes(action));
    }
  }

  const weakened = structuredClone(
    COMPANY_OS_RUNTIME_CONTRACTS['general-manager-ai-v3'],
  ) as Record<string, unknown>;
  weakened.prohibitedActions = COMPANY_OS_MANDATORY_PROHIBITED_ACTIONS.filter(
    (action) => action !== 'PAYMENT',
  );
  assert.throws(
    () => validateCompanyOsRuntimeContract(weakened),
    /prohibitedActions must include PAYMENT/,
  );
});

test('budgets, timeout, and concurrency are finite and internally consistent', () => {
  for (const contract of Object.values(COMPANY_OS_RUNTIME_CONTRACTS)) {
    assert.equal(contract.timeoutMs, 120_000);
    assert.equal(contract.concurrency, 1);
    assert.ok(contract.budgets.dailyTokens > 0);
    assert.ok(contract.budgets.monthlyTokens >= contract.budgets.dailyTokens);
    assert.ok(
      contract.budgets.maxOutputTokens <
        contract.budgets.targetTotalTokensPerAttempt,
    );
    assert.ok(
      contract.budgets.targetTotalTokensPerAttempt <=
        contract.budgets.dailyTokens,
    );
  }

  const unbounded = structuredClone(
    COMPANY_OS_RUNTIME_CONTRACTS['systems-manager-ai-v1'],
  ) as Record<string, unknown>;
  unbounded.concurrency = 2;
  assert.throws(
    () => validateCompanyOsRuntimeContract(unbounded),
    /concurrency must remain 1/,
  );
});

test('team manifest leaves Data Manager and every missing specialist NOT_INSTALLED', () => {
  const expectedNotInstalled = [
    'data-manager-ai-v1',
    'ingestion-sync-ai-v1',
    'procurement-sourcing-ai-v1',
    'pricing-margin-ai-v1',
    'controller-finance-ai-v1',
  ];

  for (const agentId of expectedNotInstalled) {
    assert.equal(getCompanyOsAgentStatus(agentId), 'NOT_INSTALLED');
    assert.equal(
      Object.prototype.hasOwnProperty.call(COMPANY_OS_RUNTIME_CONTRACTS, agentId),
      false,
    );
  }
  assert.equal(
    COMPANY_OS_TEAM_MANIFEST.filter((member) => member.status === 'INSTALLED').length,
    2,
  );
});

test('schedule objective resolves only for an installed schedule contract', () => {
  assert.equal(
    getCompanyOsScheduleObjective('systems-manager-ai-v1'),
    'Actualizá determinísticamente el inventario técnico, la salud, la cobertura y los riesgos observables. No ejecutes cambios ni reveles secretos.',
  );
  assert.throws(
    () => getCompanyOsScheduleObjective('general-manager-ai-v3'),
    /has no installed schedule contract/,
  );
  assert.throws(
    () => getCompanyOsScheduleObjective('data-manager-ai-v1'),
    /NOT_INSTALLED/,
  );
});

test('schedule declarations also fail closed when trigger and objective diverge', () => {
  const missingObjective = structuredClone(
    COMPANY_OS_RUNTIME_CONTRACTS['systems-manager-ai-v1'],
  ) as Record<string, unknown>;
  delete missingObjective.scheduleObjective;
  assert.throws(
    () => validateCompanyOsRuntimeContract(missingObjective),
    /scheduleObjective must exist if and only if SCHEDULE is accepted/,
  );
});

test('output validation matches the two executable handlers and rejects extra fields', () => {
  const generalOutput = {
    summary: 'Resumen basado en evidencia.',
    primaryDataQualityProblem: 'Falta una referencia confirmada.',
    evidenceRefs: ['businessSnapshot'],
    recommendedNextStep: 'Solicitar revisión humana.',
    missions: [
      {
        title: 'Revisar evidencia',
        objective: 'Resolver la referencia faltante sin ejecutar cambios.',
        evidenceRefs: ['businessSnapshot'],
        status: 'PLANNED',
      },
    ],
    delegations: [
      {
        agentId: 'systems-manager-ai-v1',
        objective: 'Revisar la cobertura técnica observable.',
        evidenceRefs: ['businessSnapshot'],
      },
    ],
    needsHumanDecision: false,
    confidence: 0.9,
  };
  assert.equal(
    validateCompanyOsRuntimeOutput('general-manager-ai-v3', generalOutput),
    generalOutput,
  );
  assert.equal(
    getCompanyOsRuntimeOutputSchema('general-manager-ai-v3').required.includes(
      'primaryDataQualityProblem',
    ),
    true,
  );
  assert.throws(
    () =>
      validateCompanyOsRuntimeOutput('general-manager-ai-v3', {
        ...generalOutput,
        executePayment: true,
      }),
    /unknown field executePayment/,
  );

  const systemsOutput = {
    summary: 'Estado técnico basado en snapshot cerrado.',
    primaryConfirmedRisk: 'Worker degradado.',
    primaryCoverageGap: 'No hay telemetría de una dependencia.',
    confirmedRiskNextStep: 'Elevar al Gerente General.',
    coverageGapNextStep: 'Solicitar evidencia adicional.',
    evidenceRefs: ['systemsSnapshot'],
    actionableRisks: [
      {
        riskId: 'risk-1',
        title: 'Worker degradado',
        assetId: 'asset-1',
        classification: 'ACTION_REQUIRED',
        priority: 90,
        evidenceRefs: ['systemsSnapshot'],
      },
    ],
    missions: [],
    needsHumanDecision: true,
    confidence: 0.7,
  };
  assert.equal(
    validateCompanyOsRuntimeOutput('systems-manager-ai-v1', systemsOutput),
    systemsOutput,
  );
  assert.throws(
    () =>
      validateCompanyOsRuntimeOutput('systems-manager-ai-v1', {
        ...systemsOutput,
        actionableRisks: [
          {
            ...systemsOutput.actionableRisks[0],
            classification: 'AUTO_REMEDIATE',
          },
        ],
      }),
    /only ACTION_REQUIRED is allowed/,
  );
  assert.throws(
    () =>
      validateCompanyOsRuntimeOutput('systems-manager-ai-v1', {
        ...systemsOutput,
        delegations: [],
      }),
    /unknown field delegations/,
  );
  assert.throws(
    () =>
      validateCompanyOsRuntimeOutput('general-manager-ai-v3', {
        ...generalOutput,
        delegations: [
          {
            agentId: 'data-manager-ai-v1',
            objective: 'Procesar datos.',
            evidenceRefs: ['businessSnapshot'],
          },
        ],
      }),
    /target must be an installed specialist/,
  );
  assert.throws(
    () =>
      validateCompanyOsRuntimeOutput('general-manager-ai-v3', {
        ...generalOutput,
        confidence: 0.4,
        needsHumanDecision: false,
      }),
    /low confidence requires a human decision/,
  );
  assert.throws(
    () => validateCompanyOsRuntimeOutput('data-manager-ai-v1', generalOutput),
    /NOT_INSTALLED/,
  );
});
