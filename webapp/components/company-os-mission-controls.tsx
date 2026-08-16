'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Check, Loader2, Pencil, ShieldAlert, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type MissionStatus = 'PLANNED' | 'APPROVED' | 'REJECTED' | 'RUNNING' | 'BLOCKED' | 'REVIEW' | 'DONE';
type MissionAction = 'APPROVE' | 'REJECT' | 'EDIT' | 'POSTPONE' | 'MARK_INCORRECT';

type ProjectedMission = {
  id: string;
  agent: string;
  mission: string;
  why: string;
  expectedOutput: string;
  status: MissionStatus;
  head: { sequence: number; eventHash: string | null };
  eventCount: number;
  chainValid: true;
  effectiveRevision: Record<string, unknown> | null;
  latestEvent: {
    action: MissionAction;
    reason: string | null;
    deferUntil: string | null;
    revisionPayload: Record<string, unknown> | null;
    createdAt: string;
  } | null;
};

type DecisionDraft = {
  mission: ProjectedMission;
  action: Exclude<MissionAction, 'APPROVE'>;
};

const statusStyle: Record<MissionStatus, string> = {
  PLANNED: 'border-amber-500/30 text-amber-300',
  APPROVED: 'border-emerald-500/30 text-emerald-300',
  REJECTED: 'border-red-500/30 text-red-300',
  RUNNING: 'border-blue-500/30 text-blue-300',
  BLOCKED: 'border-orange-500/30 text-orange-300',
  REVIEW: 'border-violet-500/30 text-violet-300',
  DONE: 'border-cyan-500/30 text-cyan-300',
};

const dialogTitle: Record<DecisionDraft['action'], string> = {
  REJECT: 'Rechazar misión',
  EDIT: 'Editar misión',
  POSTPONE: 'Posponer misión',
  MARK_INCORRECT: 'Marcar información incorrecta',
};

export function CompanyOsMissionControls({ runId }: { runId: string }) {
  const [missions, setMissions] = useState<ProjectedMission[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<DecisionDraft | null>(null);
  const [reason, setReason] = useState('');
  const [deferUntil, setDeferUntil] = useState('');
  const [editedMission, setEditedMission] = useState('');
  const [editedWhy, setEditedWhy] = useState('');
  const [editedOutput, setEditedOutput] = useState('');

  const loadMissions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/company-os/missions?runId=${encodeURIComponent(runId)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'No se pudieron leer las misiones persistidas');
      if (!Array.isArray(payload.missions)) throw new Error('Readback de misiones inválido');
      setMissions(payload.missions);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void loadMissions();
  }, [loadMissions]);

  function openDialog(mission: ProjectedMission, action: DecisionDraft['action']) {
    const effectiveRevision = mission.effectiveRevision;
    setDraft({ mission, action });
    setReason('');
    setDeferUntil('');
    setEditedMission(String(effectiveRevision?.mission ?? mission.mission));
    setEditedWhy(String(effectiveRevision?.why ?? mission.why));
    setEditedOutput(String(effectiveRevision?.expectedOutput ?? mission.expectedOutput));
  }

  async function decide(mission: ProjectedMission, action: MissionAction, extra: Record<string, unknown> = {}) {
    setPendingId(mission.id);
    setError('');
    try {
      const response = await fetch('/api/company-os/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId: mission.id,
          action,
          expectedHead: mission.head.sequence,
          idempotencyKey: `ui:${crypto.randomUUID()}`,
          ...extra,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'No se pudo guardar y verificar la decisión');
      if (!payload.mission?.chainValid) throw new Error('Readback de auditoría inválido');
      setMissions((current) => current.map((item) => item.id === mission.id ? payload.mission : item));
      setDraft(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Error inesperado');
      if ((requestError instanceof Error ? requestError.message : '').includes('Conflicto de versión')) {
        await loadMissions();
      }
    } finally {
      setPendingId(null);
    }
  }

  async function submitDraft() {
    if (!draft) return;
    if (draft.action === 'REJECT') {
      await decide(draft.mission, draft.action, { reason });
    } else if (draft.action === 'EDIT') {
      await decide(draft.mission, draft.action, {
        reason: reason || null,
        revisionPayload: { mission: editedMission.trim(), why: editedWhy.trim(), expectedOutput: editedOutput.trim() },
      });
    } else if (draft.action === 'POSTPONE') {
      await decide(draft.mission, draft.action, {
        reason: reason || null,
        deferUntil: deferUntil ? new Date(deferUntil).toISOString() : null,
      });
    } else {
      await decide(draft.mission, draft.action, {
        reason,
        incorrectData: { statement: reason.trim() },
      });
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Leyendo misiones persistidas…</div>;
  }

  return (
    <div className="space-y-3">
      <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-200">
        Aprobar confirma el análisis; no ejecuta compras, pagos, mensajes ni cambios. RUNNING y DONE están reservados para una versión futura y no tienen controles en V2.
      </p>
      {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      {missions.map((mission) => {
        const disabled = pendingId === mission.id || mission.status === 'REJECTED' || mission.status === 'RUNNING' || mission.status === 'DONE';
        const revision = mission.effectiveRevision;
        const displayMission = String(revision?.mission ?? mission.mission);
        const displayWhy = String(revision?.why ?? mission.why);
        const displayOutput = String(revision?.expectedOutput ?? mission.expectedOutput);
        return (
          <div key={mission.id} className="grid gap-3 rounded-2xl border border-white/10 bg-slate-950/80 p-4 md:grid-cols-[180px_1fr]">
            <div>
              <div className="font-bold text-violet-300">{mission.agent}</div>
              <Badge variant="outline" className={`mt-2 ${statusStyle[mission.status]}`}>{mission.status}</Badge>
              <p className="mt-2 text-[11px] text-slate-500">Auditoría #{mission.head.sequence} · cadena verificada</p>
            </div>
            <div className="space-y-3">
              <div>
                <p className="font-semibold text-slate-100">{displayMission}</p>
                <p className="mt-1 text-sm text-slate-400">{displayWhy}</p>
                <p className="mt-2 text-xs text-cyan-300">Entregable: {displayOutput}</p>
              </div>
              {mission.latestEvent?.deferUntil && <p className="text-xs text-amber-300">Pospuesta hasta {new Date(mission.latestEvent.deferUntil).toLocaleString('es-AR', { timeZone: 'America/New_York' })}</p>}
              {mission.latestEvent?.reason && <p className="text-xs text-slate-500">Última decisión: {mission.latestEvent.reason}</p>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={disabled || !['PLANNED', 'REVIEW'].includes(mission.status)} onClick={() => void decide(mission, 'APPROVE')} className="bg-emerald-500 text-slate-950 hover:bg-emerald-300"><Check className="mr-1 h-3.5 w-3.5" /> Aprobar</Button>
                <Button size="sm" variant="outline" disabled={disabled} onClick={() => openDialog(mission, 'REJECT')}><X className="mr-1 h-3.5 w-3.5" /> Rechazar</Button>
                <Button size="sm" variant="outline" disabled={disabled} onClick={() => openDialog(mission, 'EDIT')}><Pencil className="mr-1 h-3.5 w-3.5" /> Editar</Button>
                <Button size="sm" variant="outline" disabled={disabled} onClick={() => openDialog(mission, 'POSTPONE')}><CalendarClock className="mr-1 h-3.5 w-3.5" /> Posponer</Button>
                <Button size="sm" variant="outline" disabled={disabled || mission.status === 'BLOCKED'} onClick={() => openDialog(mission, 'MARK_INCORRECT')} className="border-orange-500/30 text-orange-300"><ShieldAlert className="mr-1 h-3.5 w-3.5" /> Información incorrecta</Button>
                {pendingId === mission.id && <Loader2 className="h-4 w-4 animate-spin self-center text-cyan-300" />}
              </div>
            </div>
          </div>
        );
      })}

      <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open && !pendingId) setDraft(null); }}>
        <DialogContent className="border-white/10 bg-slate-950 text-slate-100 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{draft ? dialogTitle[draft.action] : 'Decisión'}</DialogTitle>
            <DialogDescription className="text-slate-400">La decisión se guarda como evento append-only y no modifica información empresarial.</DialogDescription>
          </DialogHeader>
          {draft?.action === 'EDIT' && (
            <div className="space-y-3">
              <div><Label htmlFor="mission-edit">Misión</Label><Textarea id="mission-edit" value={editedMission} onChange={(event) => setEditedMission(event.target.value)} maxLength={1000} /></div>
              <div><Label htmlFor="why-edit">Motivo</Label><Textarea id="why-edit" value={editedWhy} onChange={(event) => setEditedWhy(event.target.value)} maxLength={1000} /></div>
              <div><Label htmlFor="output-edit">Entregable</Label><Textarea id="output-edit" value={editedOutput} onChange={(event) => setEditedOutput(event.target.value)} maxLength={1000} /></div>
            </div>
          )}
          {draft?.action === 'POSTPONE' && (
            <div><Label htmlFor="defer-until">Revisar después de</Label><Input id="defer-until" type="datetime-local" value={deferUntil} onChange={(event) => setDeferUntil(event.target.value)} /></div>
          )}
          {draft?.action !== 'EDIT' && (
            <div><Label htmlFor="decision-reason">{draft?.action === 'POSTPONE' ? 'Nota opcional' : 'Motivo obligatorio'}</Label><Textarea id="decision-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} /></div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={Boolean(pendingId)}>Cancelar</Button>
            <Button onClick={() => void submitDraft()} disabled={Boolean(pendingId) || !draft || (['REJECT', 'MARK_INCORRECT'].includes(draft.action) && !reason.trim()) || (draft.action === 'POSTPONE' && !deferUntil) || (draft.action === 'EDIT' && (!editedMission.trim() || !editedWhy.trim() || !editedOutput.trim()))}>
              {pendingId && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar decisión
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
