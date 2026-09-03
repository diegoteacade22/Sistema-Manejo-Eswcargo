import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { resolveCompanyOsRuntimeDataPolicy } from '../lib/company-os/runtime-data-policy';

const DATA = 'data-manager-ai-v1';
const GENERAL = 'general-manager-ai-v3';
type Work = { id: string; caseId: string; agentId: string; status?: string };
type Message = { id: string; caseId: string; fromAgentId: string | null; toAgentId: string | null };

function database({ caseAgent = GENERAL, caseType = 'ADVISORY', work = [], messages = [], failCaseRead = false }: {
  caseAgent?: string; caseType?: string; work?: Work[]; messages?: Message[]; failCaseRead?: boolean;
} = {}) {
  return {
    companyOsCase: {
      async findUniqueOrThrow() {
        if (failCaseRead) throw new Error('DATABASE_UNAVAILABLE');
        return { agentId: caseAgent, caseType };
      },
    },
    companyOsWorkItem: {
      async findFirst({ where }: { where: { caseId: string; agentId: string } }) {
        assert.deepEqual(Object.keys(where).sort(), ['agentId', 'caseId']);
        return work.find((item) => item.caseId === where.caseId && item.agentId === where.agentId) ?? null;
      },
    },
    companyOsMessage: {
      async findFirst({ where }: { where: { caseId: string; OR: Array<{ fromAgentId?: string; toAgentId?: string }> } }) {
        return messages.find((item) => item.caseId === where.caseId && where.OR.some((condition) =>
          (condition.fromAgentId !== undefined && item.fromAgentId === condition.fromAgentId)
          || (condition.toAgentId !== undefined && item.toAgentId === condition.toAgentId),
        )) ?? null;
      },
    },
  } as unknown as Prisma.TransactionClient;
}

test('Data-origin cases keep General returns local even without recent Data context', async () => {
  const policy = await resolveCompanyOsRuntimeDataPolicy(database({ caseAgent: DATA }), 'case-1', GENERAL);
  assert.deepEqual(policy, { version: 1, inference: 'LOCAL_ONLY', reason: 'DATA_MANAGER_LINEAGE' });
});

test('continuous objectives fence the initial General claim and all follow-ups without Data participation', async () => {
  for (const agentId of [GENERAL, DATA, 'systems-manager-ai-v1']) {
    assert.deepEqual(await resolveCompanyOsRuntimeDataPolicy(database({ caseType: 'CONTINUOUS_OBJECTIVE' }), 'case-1', agentId), {
      version: 1, inference: 'LOCAL_ONLY', reason: 'CONTINUOUS_OBJECTIVE',
    });
  }
});

test('Data work keeps the case local after completion or cancellation', async () => {
  for (const status of ['QUEUED', 'COMPLETED', 'CANCELLED']) {
    const tx = database({ work: [{ id: 'data-work', caseId: 'case-1', agentId: DATA, status }] });
    assert.equal((await resolveCompanyOsRuntimeDataPolicy(tx, 'case-1', GENERAL)).inference, 'LOCAL_ONLY');
  }
});

test('Data participation older than the 30-message model window still fences egress', async () => {
  const messages: Message[] = [
    { id: 'old-data', caseId: 'case-1', fromAgentId: DATA, toAgentId: GENERAL },
    ...Array.from({ length: 35 }, (_, index) => ({ id: `new-${index}`, caseId: 'case-1', fromAgentId: GENERAL, toAgentId: null })),
  ];
  assert.equal(messages.slice(-30).some((message) => message.fromAgentId === DATA), false);
  assert.equal((await resolveCompanyOsRuntimeDataPolicy(database({ messages }), 'case-1', GENERAL)).inference, 'LOCAL_ONLY');
});

test('a delegation to Data fences the case before the Data result arrives', async () => {
  const messages = [{ id: 'delegation', caseId: 'case-1', fromAgentId: GENERAL, toAgentId: DATA }];
  assert.equal((await resolveCompanyOsRuntimeDataPolicy(database({ messages }), 'case-1', GENERAL)).inference, 'LOCAL_ONLY');
});

test('unrelated Data cases do not change a General case policy', async () => {
  const tx = database({
    work: [{ id: 'other-work', caseId: 'other-case', agentId: DATA }],
    messages: [{ id: 'other-message', caseId: 'other-case', fromAgentId: DATA, toAgentId: GENERAL }],
  });
  assert.deepEqual(await resolveCompanyOsRuntimeDataPolicy(tx, 'case-1', GENERAL), {
    version: 1, inference: 'STANDARD', reason: 'DEFAULT',
  });
  assert.equal((await resolveCompanyOsRuntimeDataPolicy(tx, 'case-1', DATA)).inference, 'LOCAL_ONLY');
});

test('unobserved durable policy fails the claim instead of defaulting to external inference', async () => {
  const tx = database({ failCaseRead: true });
  await assert.rejects(resolveCompanyOsRuntimeDataPolicy(tx, 'case-1', GENERAL), /DATABASE_UNAVAILABLE/);
});
