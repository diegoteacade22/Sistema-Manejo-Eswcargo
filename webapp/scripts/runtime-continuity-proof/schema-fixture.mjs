import { readFileSync } from 'node:fs';
const migration = (name) => readFileSync(`../supabase/migrations/${name}`, 'utf8');
function section(text, start, end, includeEnd = false) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`Missing migration boundary: ${start}`);
  return text.slice(from, to + (includeEnd ? end.length : 0));
}
const base = migration('20260816163045_company_os_v3.sql');
const runtime = migration('20260826003811_company_os_runtime_24x7.sql');
const sql = [
  'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE company_os_reader; CREATE ROLE company_os_v3;',
  section(base, 'CREATE OR REPLACE FUNCTION public.company_os_v3_reject_mutation()', 'END $$;', true),
  section(migration('20260816175940_systems_manager_ai_v1.sql'), 'CREATE TABLE public."CompanyOsAgentSchedule"', '\n);', true),
  section(runtime, 'CREATE UNIQUE INDEX "CompanyOsLease_active_work_item_key"', 'CREATE INDEX "CompanyOsLease_worker_status_idx"'),
  section(runtime, 'CREATE OR REPLACE FUNCTION public.company_os_runtime_guard_case_transition()', 'DO $$ DECLARE relation_name text; BEGIN'),
  migration('20260826015319_company_os_runtime_retry_claim_transition.sql'),
  migration('20260903020502_company_os_continuous_objectives.sql'),
  migration('20260904030000_company_os_external_sources.sql'),
  migration('20260904120000_company_os_continuous_reconciliation.sql'),
  migration('20260906223205_company_os_result_receipt_indexes.sql'),
  'CREATE TRIGGER runtime_proof_audit_append_only BEFORE UPDATE OR DELETE ON public."CompanyOsAuditEvent" FOR EACH ROW EXECUTE FUNCTION public.company_os_v3_reject_mutation();',
];
process.stdout.write(sql.join('\n'));
