import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { CompanyOsHumanDashboard, SECTION_HASHES, sectionFromHash } from '../components/company-os-human-dashboard';
import { verifyCodexIntakeRequest } from '../lib/company-os/codex-task-auth';
import { effectiveCodexTaskState, isApprovedCodexTaskDispatchCandidate, isAutonomousCodexTaskDispatchCandidate, safeCodexTaskReply } from '../lib/company-os/codex-task-store';

const page = readFileSync('app/company-os/operations/page.tsx', 'utf8');
const component = readFileSync('components/company-os-human-dashboard.tsx', 'utf8');
const collector = readFileSync('../company-os/codex-task-collector/collector.mjs', 'utf8');
const collectorManager = readFileSync('../company-os/codex-task-collector/manage.sh', 'utf8');
const migration = readFileSync('../supabase/migrations/20260827142708_company_os_codex_task_inventory.sql', 'utf8');
const managementMigration = readFileSync('../supabase/migrations/20260827162112_company_os_codex_task_management.sql', 'utf8');
const replyMigration = readFileSync('../supabase/migrations/20260830023000_company_os_codex_task_replies.sql', 'utf8');
const store = readFileSync('lib/company-os/codex-task-store.ts', 'utf8');
const route = readFileSync('app/api/company-os/dashboard/human/route.ts', 'utf8');
const dispatchRoute = readFileSync('app/api/company-os/codex/v1/dispatch/route.ts', 'utf8');

test('el tablero humano es la vista principal y la consola técnica queda colapsada', () => {
  assert.match(page, /<CompanyOsHumanDashboard \/>/);
  assert.match(page, /<details/);
  assert.match(page, /Diagnóstico técnico del sistema/);
  assert.ok(page.indexOf('<CompanyOsHumanDashboard />') < page.indexOf('<CompanyOsEngineeringControlCenter />'));
});

test('la vista inicial usa lenguaje humano y no muestra leases ni fencing', () => {
  const markup = renderToStaticMarkup(React.createElement(CompanyOsHumanDashboard));
  assert.match(markup, /Leyendo tareas de Codex/);
  assert.doesNotMatch(markup, /fencing|capability lease|effect ledger/i);
  for (const label of ['Trabajando ahora', 'Sin revisar', 'Necesito que decidas', 'Cola automática', 'Con problemas', 'Ideas y ofertas', 'Terminadas']) {
    assert.match(component, new RegExp(label));
  }
  assert.match(component, /Monitoreos activos/);
});

test('cada cuadro navega a una sola categoría interactiva y admite enlaces directos', () => {
  assert.deepEqual(SECTION_HASHES, {
    now: 'trabajando-ahora',
    unreviewed: 'sin-revisar',
    pending: 'para-el-agente',
    needsDiego: 'necesito-de-vos',
    blocked: 'con-problemas',
    readyReview: 'listas-para-revisar',
    monitoring: 'monitoreos-activos',
    commercial: 'ideas-y-ofertas',
    done: 'realizadas',
    archived: 'archivadas',
  });
  for (const [section, hash] of Object.entries(SECTION_HASHES)) {
    assert.equal(sectionFromHash(`#${hash}`), section);
  }
  assert.equal(sectionFromHash('#categoria-inexistente'), null);
  assert.match(component, /aria-expanded=\{activeSection === item\.section\}/);
  assert.match(component, /aria-controls="dashboard-detail-panel"/);
  assert.match(component, /role="region"/);
  assert.match(component, /tabIndex=\{-1\}/);
  assert.match(component, /panel\.focus\(\{ preventScroll: true \}\)/);
  assert.match(component, /navigationRequest/);
  assert.match(component, /window\.addEventListener\("popstate"/);
  assert.match(component, /event\.preventDefault\(\); openSection\(item\.section\)/);
  assert.match(component, /Mostrando solamente/);
  assert.match(component, /Hacé clic en cualquiera de los cuadros para abrir solamente esa lista/);
  assert.match(component, /switch \(activeSection\)/);
});

test('cada resultado abre una ficha interna y Codex queda como salida secundaria', () => {
  assert.match(component, /Ver y gestionar acá/);
  assert.match(component, /onClick=\{\(\) => onOpen\(task\)\}/);
  assert.match(component, /TaskManagerDialog/);
  assert.match(component, /Mover en este tablero a/);
  assert.match(component, /Mover chat a otro proyecto del tablero/);
  assert.match(component, /MOVE_PROJECT/);
  assert.match(component, /Cerrar como realizada/);
  assert.match(component, /Archivar/);
  assert.match(component, /Reabrir/);
  assert.match(component, /href=\{task\.codexUrl\}/);
  assert.match(component, /Abrir tarea original/);
  assert.match(component, /Abrir en Codex/);
  assert.match(component, /mover o reabrir una tarea antigua en “Para el agente” autoriza una nueva ejecución/i);
  assert.match(store, /codex:\/\/threads\/\$\{threadId\}/);
});

test('las ofertas exponen costo, precio sugerido, margen y fuente real', () => {
  assert.match(component, /suggestedPriceUsd/);
  assert.match(component, /costUsd/);
  assert.match(component, /marginPct/);
  assert.match(component, /Fuente:/);
  assert.match(component, /no se publican solas/);
  assert.match(component, /Abrir artículos para completarlo/);
  assert.match(store, /missingCost/);
  assert.doesNotMatch(store, /select\(\['MONITORING'\], 10\)/);
  assert.doesNotMatch(store, /take: 500/);
  assert.match(store, /Revisar precios sin margen positivo/);
});

test('collector excluye subagentes, envía sólo síntesis saneada y exige marcador verificable antes del cierre automático', () => {
  assert.match(collector, /header\.parent_thread_id \|\| header\.agent_path \|\| header\.forked_from_id/);
  assert.doesNotMatch(collector, /lastFinalText,\s*priority/);
  assert.match(collector, /summarizeHumanRequest/);
  assert.match(collector, /La tarea pide una decisión con datos sensibles/);
  assert.match(collector, /\[DATO OCULTO\]/);
  assert.match(collector, /humanStatus: 'READY_REVIEW'/);
  assert.match(collector, /AUTONOMY_RESULT: COMPLETED/);
  assert.match(collector, /finalLine === 'AUTONOMY_RESULT: COMPLETED'/);
  assert.doesNotMatch(collector, /\/autonomy_result:\\s\*completed\//);
  assert.match(collector, /humanStatus: 'PENDING'.*reanudará automáticamente/);
  assert.doesNotMatch(collector, /humanStatus: 'DONE'/);
  assert.match(store, /codex:\/\/threads\/\$\{threadId\}/);
  assert.match(store, /function safeThreadId/);
  assert.match(store, /\\u0000-\\u0008/);
  assert.match(collector, /if \(tasks\.length === 0\)/);
});

test('la síntesis del pedido concreto es determinística y oculta datos sensibles', () => {
  const output = execFileSync(process.execPath, ['../company-os/codex-task-collector/collector.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, COMPANY_OS_CODEX_SELF_TEST: '1', COMPANY_OS_CODEX_INTAKE_SECRET: '' },
    encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(output), { ok: true, selfTest: true });
});

test('la ficha explica la función de Diego y ofrece una acción visible para destrabar', () => {
  assert.match(component, /Tu función para destrabar/);
  assert.match(component, /Resumen de la tarea/);
  assert.match(component, /Tu decisión o respuesta/);
  assert.match(component, /No pude identificar el pedido exacto con seguridad/);
  assert.match(component, /Guardar respuesta y continuar/);
  assert.match(component, /Guardar modificación y continuar/);
  assert.match(component, /Codex está trabajando con tu respuesta/);
  assert.match(component, /La tarea salió del bloqueo/);
  assert.match(component, /Abrir en Codex para responder/);
  assert.match(component, /Pedido confirmado por el último escaneo/);
  assert.match(component, /No pegues contraseñas, tokens, códigos, correos, teléfonos, enlaces ni rutas/);
  assert.match(route, /SUBMIT_REPLY/);
  assert.match(store, /submitCodexTaskReply/);
});

test('la respuesta humana se valida antes de persistir o despachar', () => {
  assert.deepEqual(safeCodexTaskReply('Elegí la opción B y dejalo listo para revisar.'), {
    responseText: 'Elegí la opción B y dejalo listo para revisar.',
    responseHash: 'e1ce59fd299ef6326541d49a8948692b5b0c2f48b0b703969b3eb208abddd353',
  });
  for (const unsafe of ['token=abc123456', 'PIN 4829', 'password is abc123', 'passcode is 4821', 'secreto es abc123', 'diego@example.com', '+1 305 555 1212', 'https://example.com', '/Users/diego/secreto']) {
    assert.throws(() => safeCodexTaskReply(unsafe), /No guardes contraseñas/);
  }
  assert.match(collector, /validateHumanResponse/);
  assert.match(collector, /createHash\('sha256'\)\.update\(response\)/);
  assert.match(collector, /Aplicala únicamente al objetivo original/);
});

test('sin revisar queda separado de la cola autónoma del agente', () => {
  assert.match(store, /unapprovedTasks = activeTasks\.filter/);
  assert.match(store, /approvedPendingTasks = activeTasks\.filter/);
  assert.match(store, /unreviewed: unapprovedTasks/);
  assert.match(store, /pending: approvedPendingTasks/);
  assert.doesNotMatch(store, /pending: select\(\['PENDING', 'UNREVIEWED'\]\)/);
  assert.match(component, /Las tareas recientes interrumpidas entran solas/);
  assert.match(component, /Reanudación automática aprobada/);
  assert.match(component, /AUTÓNOMO ACTIVO/);
});

test('el despacho acepta autorización humana o política autónoma durable y nunca saltea bloqueos', () => {
  const base = {
    archived: false,
    attentionReason: null,
    fingerprint: 'a'.repeat(64),
    humanStatus: 'UNREVIEWED',
    autonomyLevel: 'A0',
    sourceStatus: 'IDLE',
    boardState: {
      workflowStatus: 'PENDING', lifecycle: 'OPEN', sourceFingerprint: 'a'.repeat(64), version: 3, updatedBy: 'human-actor-ref',
    },
    actions: [{ action: 'MOVE', actorRef: 'human-actor-ref', idempotencyKey: 'dashboard:auto-resume:12345678-1234-1234-1234-123456789abc', newHumanStatus: 'PENDING', newVersion: 3 }],
  };
  assert.equal(isApprovedCodexTaskDispatchCandidate(base), true);
  assert.equal(isApprovedCodexTaskDispatchCandidate({ ...base, attentionReason: 'Falta OTP' }), false);
  assert.equal(isApprovedCodexTaskDispatchCandidate({ ...base, fingerprint: 'b'.repeat(64) }), false);
  const policyApproved = {
    ...base,
    humanStatus: 'PENDING',
    autonomyLevel: 'A1',
    boardState: { ...base.boardState, updatedBy: 'codex-intake-ai-v1' },
    actions: [{ ...base.actions[0], actorRef: 'codex-intake-ai-v1', idempotencyKey: `codex-auto:eligibility:${'b'.repeat(64)}` }],
  };
  assert.equal(isApprovedCodexTaskDispatchCandidate(policyApproved), true);
  assert.equal(isAutonomousCodexTaskDispatchCandidate({ ...policyApproved, boardState: null, actions: [] }), true);
  assert.equal(isAutonomousCodexTaskDispatchCandidate({ ...policyApproved, attentionReason: 'Falta OTP', boardState: null, actions: [] }), false);
  assert.equal(isAutonomousCodexTaskDispatchCandidate({ ...policyApproved, boardState: { ...policyApproved.boardState, lifecycle: 'ARCHIVED' }, actions: [] }), false);
  assert.equal(isApprovedCodexTaskDispatchCandidate({ ...base, actions: [{ ...base.actions[0], newVersion: 2 }] }), false);
  assert.equal(isApprovedCodexTaskDispatchCandidate({ ...base, actions: [{ ...base.actions[0], idempotencyKey: 'dashboard:legacy-action-1234567890' }] }), false);
  const responseText = 'Elegí la opción B.';
  const replyApproved = {
    ...base,
    attentionReason: '¿Preferís la opción A o B?',
    boardState: null,
    actions: [],
    replyRevisions: [{
      sourceFingerprint: base.fingerprint,
      responseText,
      responseHash: safeCodexTaskReply(responseText).responseHash,
      delivery: { state: 'CONFIRMED' },
    }],
  };
  assert.equal(isApprovedCodexTaskDispatchCandidate(replyApproved), true);
  assert.equal(isApprovedCodexTaskDispatchCandidate({ ...replyApproved, fingerprint: 'b'.repeat(64) }), false);
  assert.equal(isApprovedCodexTaskDispatchCandidate({ ...replyApproved, boardState: { ...base.boardState, lifecycle: 'ARCHIVED' } }), false);
  assert.match(store, /Confirmá explícitamente la reanudación automática/);
  assert.match(component, /dashboard:auto-resume/);
});

test('la reanudación usa HMAC, journal durable, sandbox y no hereda el secreto', () => {
  assert.match(dispatchRoute, /verifyCodexIntakeRequest/);
  assert.match(dispatchRoute, /acceptCompanyOsRuntimeNonce/);
  assert.match(dispatchRoute, /DISPATCH_SOURCE_HOST = 'DiegoServer\.local'/);
  assert.match(dispatchRoute, /input\.instanceId !== DISPATCH_INSTANCE_ID/);
  assert.match(dispatchRoute, /claimApprovedCodexTask/);
  assert.match(dispatchRoute, /reportCodexTaskDispatch/);
  assert.match(collector, /'exec', '--ignore-user-config', '--approve-for-me', '--sandbox', 'workspace-write'/);
  assert.match(collector, /delete process\.env\.COMPANY_OS_CODEX_INTAKE_SECRET/);
  assert.match(collector, /function childEnvironment/);
  assert.match(collector, /stdio: \['pipe', 'ignore', 'pipe'\]/);
  assert.match(collector, /'resume', '--all', threadId, '-'/);
  assert.match(collector, /child\.stdin\.end\(prompt\)/);
  assert.match(collector, /AUTO_RESUME_TIMEOUT_MS/);
  assert.match(collector, /AbortSignal\.timeout\(HTTP_TIMEOUT_MS\)/);
  assert.match(collector, /dispatch-state\.json/);
  assert.match(collector, /phase: 'EXECUTED'/);
  assert.match(collector, /claimedLastCompletedAt: state\.dispatch\.lastCompletedAt/);
  assert.match(collector, /TRUSTED_API_ORIGIN/);
  assert.match(collector, /validateClaimDispatch/);
  assert.match(collector, /dispatch\.sourceProjectName !== local\.projectName/);
  assert.match(store, /sourceProjectName: candidate\.projectName/);
  assert.match(collector, /canonicalProjects\(\)/);
  assert.match(collector, /await stopProcessGroup\(child\.pid\)/);
  assert.match(collector, /function processMatchesDispatch/);
  assert.match(collector, /executionMarker/);
  assert.match(collector, /RECOVERY_IDENTITY_UNVERIFIED/);
  assert.match(collector, /phase === 'QUARANTINED'/);
  assert.match(collector, /QUARANTINE_MARKER_PATH/);
  assert.match(collector, /fsyncSync\(descriptor\)/);
  assert.match(collector, /gate_path/);
  assert.match(collector, /stderrSha256/);
  assert.doesNotMatch(collector, /sanitizedStderr/);
  assert.match(collector, /COLLECTOR_SCAN_OK/);
  assert.match(collector, /DISPATCH_POLL_OK/);
  assert.match(collector, /waitForStartGate/);
  assert.match(collector, /COLLECTOR_START_GATE_TIMEOUT/);
  assert.match(collector, /COMPANY_OS_CODEX_DISPATCH_RESPONSE_INVALID/);
  assert.match(collector, /CLAIMED_REASONS/);
  assert.match(collector, /UNCLAIMED_REASONS/);
  assert.match(collector, /process\.kill\(-child\.pid/);
  assert.match(collector, /'--cd', cwd, '--skip-git-repo-check'/);
  assert.match(collector, /observeDispatchPrompt/);
  assert.match(collector, /promptObserved: promptProof\.promptObserved/);
  assert.match(collector, /promptObservedAt: promptProof\.promptObservedAt/);
  assert.match(collector, /humanResponseHash: claim\.dispatch\.humanResponseHash \|\| null,\s+promptHash: null,/);
  assert.match(store, /claimKeyPrefix/);
  assert.match(store, /outcome === 'SUCCEEDED' && promptObserved && completedAfterClaim && completedAfterPrompt/);
  assert.match(store, /task\.lastCompletedAt > promptObservedAt/);
  assert.match(store, /state: 'UNKNOWN_OUTCOME'/);
  assert.match(store, /previous && previous\.fingerprint !== task\.fingerprint[\s\S]*state: 'CONFIRMED'[\s\S]*state: 'SUPERSEDED'/);
  assert.match(store, /verifiedStatus === 'READY_REVIEW' && task\.autonomyLevel === 'A1' && !replyDelivery/);
  assert.match(store, /terminalBlocker[\s\S]*NEEDS_USER[\s\S]*BLOCKED_EXTERNAL/);
  assert.match(store, /executionSeriesStart[\s\S]*createdAt: \{ gte: executionSeriesStart\.createdAt \}/);
  assert.match(store, /SAFE_RETRY_SCHEDULED/);
  assert.match(store, /'DONE'[\s\S]*'complete-verified'[\s\S]*'CLOSED'/);
  assert.match(collectorManager, /StartInterval<\/key><integer>300/);
  assert.match(collectorManager, /COMPANY_OS_CODEX_AUTO_RESUME<\/key><string>1/);
  assert.match(collectorManager, /Falta Codex CLI para reanudación automática/);
  assert.match(collectorManager, /<key>PATH<\/key><string>\$PATH_VALUE/);
  assert.match(collectorManager, /<key>WorkingDirectory<\/key><string>\$CURRENT/);
  assert.match(collectorManager, /once\)[\s\S]*acquire_lock/);
  assert.match(collectorManager, /KeepAlive<\/key><dict><key>SuccessfulExit/);
  assert.match(collectorManager, /COMPANY_OS_CODEX_SOURCE_HOST/);
  assert.match(collectorManager, /lock_start/);
  assert.match(collectorManager, /\/usr\/bin\/lockf -s -t "\$wait_seconds" 9/);
  assert.match(collectorManager, /RUN_LOCK="\$STATE_DIR\/run\.lock\.v2"/);
  assert.match(collectorManager, /INSTALL_LOCK="\$STATE_DIR\/install\.lock\.v2"/);
  assert.match(collectorManager, /uninstall\)[\s\S]*acquire_install_lock/);
  assert.match(collectorManager, /complete_uninstall_transaction\(\)[\s\S]*acquire_lock 35/);
  assert.match(collectorManager, /uninstall\)[\s\S]*write_uninstall_transaction[\s\S]*complete_uninstall_transaction/);
  assert.match(collectorManager, /uninstall-transaction\.json/);
  assert.match(collectorManager, /handle_uninstall_signal/);
  assert.match(collectorManager, /UNINSTALL_TRANSACTION_BLOCKS_RUNTIME/);
  assert.match(collectorManager, /installed_manager_supports_uninstall_gate/);
  assert.match(collectorManager, /UNINSTALL_REQUIRES_DISPATCH_RECONCILIATION/);
  assert.match(collectorManager, /install-transaction\.json/);
  assert.match(collectorManager, /write_install_transaction/);
  assert.match(collectorManager, /restore_install_transaction/);
  assert.match(collectorManager, /fs\.fsyncSync/);
  assert.match(collectorManager, /INSTALL_RECOVERY_READBACK_FAILED/);
  assert.match(collectorManager, /transaction_marker_safe/);
  assert.match(collectorManager, /sync_install_destinations 1 1 1/);
  assert.match(collectorManager, /INSTALL_RECOVERY_BACKUP_HASH_MISMATCH/);
  assert.match(collectorManager, /runtime_transaction_allows_run/);
  assert.match(collectorManager, /run\)[\s\S]*acquire_lock[\s\S]*runtime_transaction_allows_run/);
  assert.match(collectorManager, /phase: "PREPARED"[\s\S]*allowedRunInstallId: null/);
  assert.match(collectorManager, /set_transaction_verification_phase/);
  assert.match(collectorManager, /INSTALL_TRANSACTION_OWNER_INACTIVE/);
  assert.match(collectorManager, /INSTALL_TRANSACTION_PHASE_EXPIRED/);
  assert.match(collectorManager, /"PREPARED" \|\| "\$phase" == "VERIFYING" \|\| "\$phase" == "RECOVERING"/);
  assert.match(collectorManager, /sync_candidate_files/);
  assert.match(collectorManager, /LEGACY_LOCK_REQUIRES_INSTALL/);
  assert.match(collectorManager, /legacy_installed_collector_pids/);
  assert.match(collectorManager, /LEGACY_COLLECTOR_ORPHANED/);
  assert.match(collectorManager, /rotate_legacy_sentinel_owner/);
  assert.match(collectorManager, /LEGACY_BRIDGE_OWNER_UPDATE_FAILED/);
  assert.match(collectorManager, /legacy_sentinel_metadata_safe/);
  assert.match(collectorManager, /signal_collector_start/);
  assert.match(collectorManager, /bootout_and_wait/);
  assert.match(collectorManager, /forward_signal/);
  assert.match(collectorManager, /wait_for_install_readback/);
  assert.match(collectorManager, /DISPATCH_POLL_OK/);
  assert.match(collectorManager, /JSON\.parse\(line\)/);
  assert.match(collectorManager, /readback_start_line/);
  assert.match(collectorManager, /COMPANY_OS_CODEX_INSTALL_ID/);
  assert.match(collectorManager, /INSTALL_REQUIRES_QUIESCENCE/);
  assert.match(store, /claimBaselineToken/);
  assert.match(store, /claimBaselineFromKey/);
  assert.equal((store.match(/SELECT 1 AS locked FROM pg_advisory_xact_lock/g) ?? []).length, 2);
  assert.doesNotMatch(store, /SELECT pg_advisory_xact_lock/);
  assert.match(store, /claim-\$\{binding\}:\$\{baselineToken\}/);
  assert.match(store, /claimedFingerprint !== claimAction\.fingerprint/);
  assert.match(store, /durableBaseline\.value\?\.toISOString\(\) \?\? null/);
  assert.match(store, /sourceChangedAfterBoardUpdate/);
  assert.match(store, /transitionPreviousHumanStatus/);
  assert.match(store, /transitionPreviousLifecycle/);
  assert.match(store, /CLAIM_ALREADY_CONSUMED/);
  assert.match(store, /orderBy: \{ createdAt: 'asc' \}/);
  assert.match(store, /sourceArchived \? 'DISCARDED' : 'UNREVIEWED'/);
  assert.match(store, /'source-archived', 'ARCHIVED'/);

  const recovery = collectorManager.slice(
    collectorManager.indexOf('restore_install_transaction()'),
    collectorManager.indexOf('handle_install_signal()'),
  );
  assert.ok(recovery.indexOf('bootout_and_wait') < recovery.indexOf('acquire_lock 35'));
  assert.ok(recovery.indexOf('acquire_lock 35') < recovery.indexOf('set_transaction_recovery_phase'));
  assert.ok(recovery.indexOf('mv "$collector_restore"') < recovery.indexOf('mv "$plist_restore"'));
  assert.ok(recovery.indexOf('mv "$plist_restore"') < recovery.indexOf('mv "$manager_restore"'));
  assert.ok(recovery.indexOf('sync_install_destinations "$had_collector" 0 "$had_plist"') < recovery.indexOf('mv "$manager_restore"'));
  const recoverySync = recovery.indexOf('sync_install_destinations "$had_collector"');
  assert.ok(recoverySync >= 0);
  assert.ok(recovery.indexOf('release_lock', recoverySync) > recoverySync);

  const installAction = collectorManager.slice(
    collectorManager.indexOf('  install)'),
    collectorManager.indexOf('  run)'),
  );
  assert.ok(installAction.indexOf('mv "$manager_candidate"') < installAction.indexOf('mv "$collector_candidate"'));
  assert.ok(installAction.indexOf('sync_file_and_directory "$CURRENT/manage.sh"') < installAction.indexOf('mv "$collector_candidate"'));
  assert.ok(installAction.indexOf('mv "$collector_candidate"') < installAction.indexOf('mv "$plist_candidate"'));
  assert.ok(installAction.indexOf('sync_install_destinations 1 1 1') < installAction.indexOf('set_transaction_verification_phase'));
});

test('la gestión humana usa un overlay durable que el collector no puede sobrescribir', () => {
  const moved = effectiveCodexTaskState(
    { humanStatus: 'READY_REVIEW', archived: false, fingerprint: 'a'.repeat(64), projectName: 'Proyecto A' },
    { workflowStatus: 'NEEDS_DIEGO', lifecycle: 'OPEN', sourceFingerprint: 'a'.repeat(64), projectNameOverride: null, version: 4 },
  );
  assert.deepEqual(moved, { humanStatus: 'NEEDS_DIEGO', lifecycle: 'OPEN', projectName: 'Proyecto A', archived: false, boardVersion: 4, changedSinceManaged: false });
  const stillArchivedAfterCollectorChange = effectiveCodexTaskState(
    { humanStatus: 'IN_PROGRESS', archived: false, fingerprint: 'b'.repeat(64), projectName: 'Proyecto A' },
    { workflowStatus: 'PENDING', lifecycle: 'ARCHIVED', sourceFingerprint: 'a'.repeat(64), projectNameOverride: 'Proyecto B', version: 5 },
  );
  assert.deepEqual(stillArchivedAfterCollectorChange, { humanStatus: 'PENDING', lifecycle: 'ARCHIVED', projectName: 'Proyecto B', archived: true, boardVersion: 5, changedSinceManaged: false });
  const reopenedByNewCodexActivity = effectiveCodexTaskState(
    { humanStatus: 'READY_REVIEW', archived: false, fingerprint: 'b'.repeat(64), projectName: 'Proyecto A' },
    { workflowStatus: 'DONE', lifecycle: 'CLOSED', sourceFingerprint: 'a'.repeat(64), projectNameOverride: null, version: 6 },
  );
  assert.deepEqual(reopenedByNewCodexActivity, { humanStatus: 'READY_REVIEW', lifecycle: 'OPEN', projectName: 'Proyecto A', archived: false, boardVersion: 6, changedSinceManaged: true });
  const automaticProgressWinsAfterNewActivity = effectiveCodexTaskState(
    { humanStatus: 'IN_PROGRESS', archived: false, fingerprint: 'b'.repeat(64), projectName: 'Proyecto A' },
    { workflowStatus: 'PENDING', lifecycle: 'OPEN', sourceFingerprint: 'a'.repeat(64), projectNameOverride: 'Proyecto B', version: 7 },
  );
  assert.deepEqual(automaticProgressWinsAfterNewActivity, { humanStatus: 'IN_PROGRESS', lifecycle: 'OPEN', projectName: 'Proyecto B', archived: false, boardVersion: 7, changedSinceManaged: true });
  const durableAutoResumeProgressSurvivesInventoryRefresh = effectiveCodexTaskState(
    { humanStatus: 'READY_REVIEW', archived: false, fingerprint: 'b'.repeat(64), projectName: 'Proyecto A' },
    { workflowStatus: 'IN_PROGRESS', lifecycle: 'OPEN', sourceFingerprint: 'a'.repeat(64), projectNameOverride: null, version: 8, updatedBy: 'codex-intake-ai-v1' },
  );
  assert.deepEqual(durableAutoResumeProgressSurvivesInventoryRefresh, { humanStatus: 'IN_PROGRESS', lifecycle: 'OPEN', projectName: 'Proyecto A', archived: false, boardVersion: 8, changedSinceManaged: false });
  assert.doesNotMatch(collector, /CompanyOsCodexTaskBoardState|boardState/);
  assert.match(managementMigration, /CREATE TABLE public\."CompanyOsCodexTaskBoardState"/);
  assert.match(managementMigration, /company_os_codex_task_action_append_only/);
});

test('validación humana cierra READY_REVIEW y conserva auditoría idempotente', () => {
  assert.match(route, /MARK_DONE/);
  assert.match(route, /manageCodexTask/);
  assert.match(route, /hasTrustedHumanRequestOrigin/);
  assert.match(store, /current\.humanStatus !== 'READY_REVIEW'/);
  assert.match(store, /previous\?\.humanStatus === 'DONE'/);
  assert.match(store, /idempotencyKey/);
  assert.match(store, /requestHash/);
  assert.match(store, /expectedFingerprint/);
  assert.match(store, /expectedVersion/);
  assert.match(store, /FOR UPDATE/);
  assert.match(store, /updateMany/);
  assert.match(store, /projectNameOverride: targetProjectName/);
  assert.match(store, /P2034/);
  assert.match(route, /65_536/);
  assert.match(migration, /UNIQUE \("taskId", fingerprint, "humanStatus"\)/);
});

test('ofertas usan el cliente empresarial de sólo lectura', () => {
  assert.match(store, /companyReadPrisma/);
  assert.match(store, /businessDb\.product\.findMany/);
  assert.doesNotMatch(store, /db\.product\.findMany/);
  assert.match(store, /commercialUnavailable/);
  assert.match(store, /commercialProducts = await businessDb\.product\.findMany/);
});

test('inventario durable es interno, saneado y append-only para observaciones', () => {
  for (const table of ['CompanyOsCodexTask', 'CompanyOsCodexTaskObservation', 'CompanyOsCodexInventorySync']) {
    assert.match(migration, new RegExp(`CREATE TABLE public\\."${table}"`));
  }
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /company_os_codex_observation_append_only/);
  assert.match(managementMigration, /FORCE ROW LEVEL SECURITY/);
  assert.match(managementMigration, /GRANT SELECT, INSERT, UPDATE ON TABLE public\."CompanyOsCodexTaskBoardState" TO company_os_v3/);
  assert.match(managementMigration, /GRANT SELECT, INSERT ON TABLE public\."CompanyOsCodexTaskAction" TO company_os_v3/);
  assert.match(managementMigration, /company_os_codex_task_board_guard/);
  assert.match(managementMigration, /requestHash/);
  assert.match(managementMigration, /newVersion/);
  assert.match(managementMigration, /UNIQUE \("taskId", "newVersion"\)/);
  assert.match(managementMigration, /source_fingerprint/);
  assert.match(managementMigration, /previousProjectName/);
  assert.match(managementMigration, /resultSnapshot/);
  assert.match(replyMigration, /CREATE TABLE public\."CompanyOsCodexTaskReplyRevision"/);
  assert.match(replyMigration, /CREATE TABLE public\."CompanyOsCodexTaskReplyDelivery"/);
  assert.match(replyMigration, /one_active_per_task/);
  assert.match(replyMigration, /reply_revision_append_only/);
  assert.match(replyMigration, /FOREIGN KEY \("replyRevisionId", "taskId"\)/);
  assert.match(replyMigration, /company_os_codex_task_reply_delivery_guard/);
  assert.match(replyMigration, /"observedPromptHash" = "promptHash"/);
  assert.match(replyMigration, /state <> 'DELIVERED'/);
  assert.match(replyMigration, /outcome = 'SUCCEEDED'/);
  assert.match(replyMigration, /claim identity is immutable after claim/);
  assert.match(replyMigration, /OLD\.state = 'CONFIRMED' AND NEW\.state IN \('CLAIMED', 'SUPERSEDED'\)/);
  assert.match(replyMigration, /OLD\.state = 'CLAIMED' AND NEW\.state IN \('DELIVERED', 'FAILED', 'UNKNOWN_OUTCOME'\)/);
  assert.match(replyMigration, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(managementMigration, /rawText|prompt|conversation|cwd/);
  assert.doesNotMatch(migration, /rawText|prompt|conversation|cwd/);
});

test('el intake tolera que una tarea vuelva a una observación histórica', () => {
  const observationWrite = store.slice(
    store.indexOf('tx.companyOsCodexTaskObservation.createMany'),
    store.indexOf('if (input.finalChunk === true)'),
  );
  assert.match(observationWrite, /createMany/);
  assert.match(observationWrite, /skipDuplicates: true/);
  assert.doesNotMatch(store, /companyOsCodexTaskObservation\.create\(/);
});

test('intake Codex usa un secreto dedicado, identidad fija, timestamp y body exacto', () => {
  const prior = process.env.COMPANY_OS_CODEX_INTAKE_HMAC_SECRET;
  process.env.COMPANY_OS_CODEX_INTAKE_HMAC_SECRET = 'collector-secret-for-test';
  const workerId = 'codex-intake-ai-v1';
  const nonce = 'abcdefghijklmnop';
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ workerId, instanceId: 'test' });
  const signature = `sha256=${createHmac('sha256', process.env.COMPANY_OS_CODEX_INTAKE_HMAC_SECRET).update(`${workerId}.${nonce}.${timestamp}.${body}`).digest('hex')}`;
  const request = new Request('https://example.test/api/company-os/codex/v1/intake', { headers: {
    'x-company-os-worker-id': workerId,
    'x-company-os-nonce': nonce,
    'x-company-os-timestamp': String(timestamp),
    'x-company-os-signature-version': 'v2',
    'x-company-os-signature': signature,
  } });
  assert.ok(verifyCodexIntakeRequest(request, body));
  assert.equal(verifyCodexIntakeRequest(request, `${body} `), null);
  if (prior === undefined) delete process.env.COMPANY_OS_CODEX_INTAKE_HMAC_SECRET;
  else process.env.COMPANY_OS_CODEX_INTAKE_HMAC_SECRET = prior;
});
