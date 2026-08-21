#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const HOME = homedir();
const ROOT = process.env.DIEGOSERVER_WORKSPACE || join(HOME, '02_DESARROLLO');
const REPO = process.env.DIEGOSERVER_REPO || join(ROOT, 'Sistema-Manejo-Eswcargo');
const LABEL = process.env.DIEGOSERVER_TASK_LABEL || 'diegoserver-task';
const INTERVAL = Number(process.env.DIEGOSERVER_POLL_MS || 60000);
const STATE_DIR = join(HOME, '.diegoserver-worker');
const STATE_FILE = join(STATE_DIR, 'state.json');
mkdirSync(STATE_DIR, { recursive: true });

function sh(cmd, args, cwd = REPO) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function gh(args) { return sh('gh', args); }
function loadState() { try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { done: [] }; } }
function saveState(s) { writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }
function ensureRepo() {
  mkdirSync(ROOT, { recursive: true });
  if (!existsSync(join(REPO, '.git'))) sh('gh', ['repo','clone','diegoteacade22/Sistema-Manejo-Eswcargo', REPO], ROOT);
  sh('git', ['fetch','--all','--prune']);
}
function codexExec(prompt) {
  const help = sh('codex', ['exec','--help'], REPO);
  const args = ['exec'];
  if (help.includes('--full-auto')) args.push('--full-auto');
  else if (help.includes('--dangerously-bypass-approvals-and-sandbox')) args.push('--dangerously-bypass-approvals-and-sandbox');
  if (help.includes('--cd')) args.push('--cd', REPO);
  args.push(prompt);
  const r = spawnSync('codex', args, { cwd: REPO, encoding: 'utf8', timeout: 45 * 60 * 1000 });
  return { code: r.status ?? 1, out: `${r.stdout || ''}\n${r.stderr || ''}`.trim().slice(-12000) };
}
function runIssue(issue) {
  const branch = `diegoserver/task-${issue.number}-${Date.now()}`;
  sh('git', ['checkout','main']);
  sh('git', ['reset','--hard','origin/main']);
  sh('git', ['clean','-fd']);
  sh('git', ['checkout','-b',branch]);
  const prompt = `You are the DiegoServer production coding worker. Complete GitHub issue #${issue.number}: ${issue.title}\n\n${issue.body || ''}\n\nRules: work only in this repository; inspect AGENTS.md and existing contracts first; preserve security/read-only boundaries unless the issue explicitly authorizes a scoped change; run relevant tests; do not expose secrets; commit all completed changes with a clear message. If blocked, explain exactly why.`;
  const result = codexExec(prompt);
  let summary = result.out || '(sin salida)';
  if (result.code === 0) {
    try {
      sh('git', ['push','-u','origin',branch]);
      const pr = gh(['pr','create','--base','main','--head',branch,'--title',`DiegoServer: ${issue.title}`,'--body',`Ejecutado por DiegoServer desde la tarea #${issue.number}.\n\nRevisar tests y cambios antes de merge.`]);
      summary = `Trabajo terminado. PR: ${pr}\n\n${summary}`;
    } catch (e) { summary = `Codex terminó pero falló push/PR: ${e.message}\n\n${summary}`; }
  } else summary = `Codex terminó con código ${result.code}.\n\n${summary}`;
  gh(['issue','comment',String(issue.number),'--body',summary]);
}
async function cycle() {
  ensureRepo();
  const state = loadState();
  const raw = gh(['issue','list','--state','open','--label',LABEL,'--limit','10','--json','number,title,body']);
  const issues = JSON.parse(raw || '[]');
  for (const issue of issues) {
    if (state.done.includes(issue.number)) continue;
    try { runIssue(issue); }
    catch (e) { try { gh(['issue','comment',String(issue.number),'--body',`DiegoServer worker bloqueado: ${e.message}`]); } catch {} }
    state.done.push(issue.number); saveState(state);
  }
}
console.log(`DiegoServer worker activo. Repo=${REPO} label=${LABEL} interval=${INTERVAL}ms`);
for (;;) { try { await cycle(); } catch (e) { console.error(new Date().toISOString(), e.message); } await new Promise(r => setTimeout(r, INTERVAL)); }
