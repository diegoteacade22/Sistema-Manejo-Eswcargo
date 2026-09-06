import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runtimeOutputSchemaForClaim } from '../src/openai-client.mjs';

const CONTRACT_MIGRATION_URL = new URL(
  '../../../supabase/migrations/20260906040410_company_os_general_manager_runtime_3_1_4.sql',
  import.meta.url,
);

function persistedGeneralManagerContract() {
  const sql = readFileSync(CONTRACT_MIGRATION_URL, 'utf8');
  const delimiter = '$company_os_general_manager_contract$';
  const start = sql.indexOf(delimiter);
  const end = sql.indexOf(delimiter, start + delimiter.length);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return JSON.parse(sql.slice(start + delimiter.length, end).trim());
}

test('the persisted General Manager contract is accepted by the runtime before a claim starts', () => {
  const contract = persistedGeneralManagerContract();
  const schema = runtimeOutputSchemaForClaim({
    agentId: contract.agentId,
    advisoryOnly: true,
    contract,
    evidencePayload: { businessSnapshot: {} },
  });
  const delegation = schema.properties.delegations.items;
  assert.deepEqual(Object.keys(delegation.properties).sort(), [...delegation.required].sort());
  assert.deepEqual(delegation.required, ['agentId', 'objective', 'evidenceRefs']);
});

test('an invalid server contract is distinguished from invalid model output', () => {
  const contract = persistedGeneralManagerContract();
  contract.outputSchema.properties.delegations.items.properties.capability = {
    type: 'string',
  };
  assert.throws(
    () => runtimeOutputSchemaForClaim({
      agentId: contract.agentId,
      advisoryOnly: true,
      contract,
      evidencePayload: { businessSnapshot: {} },
    }),
    (error) => error.code === 'RUNTIME_OUTPUT_SCHEMA_INVALID'
      && /inconsistent required fields/.test(error.message),
  );
});
