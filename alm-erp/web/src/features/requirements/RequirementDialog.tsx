import { useEffect, useState } from 'react';
import { Button } from '../../components/common/Button';
import { Dialog } from '../../components/common/Dialog';
import { SelectField, TextAreaField, TextField } from '../../components/common/Field';
import { MessageStrip } from '../../components/common/MessageStrip';
import { UserSelect } from '../../components/common/Pickers';
import { useToast } from '../../components/common/Toast';
import { useAction, useApi } from '../../hooks/useApi';
import { patch, post } from '../../services/api';
import type { Requirement } from '../../types';
import { PRIORITIES } from '../../utils/status';

/** Create or edit a requirement. Status changes happen on the detail page. */
export function RequirementDialog({ open, onClose, onSaved, existing, processId }: {
  open: boolean; onClose: () => void; onSaved: (id: number) => void; existing?: Requirement; processId?: number;
}) {
  const processes = useApi<{ items: { id: number; name: string }[] }>(open ? '/processes' : null);
  const toast = useToast();
  const act = useAction();
  const [f, setF] = useState({ title: '', description: '', priority: 'High', processId: '', fitDecision: 'Partly', fitNotes: '', assigneeId: null as number | null });
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTouched(false);
    act.setError(null);
    setF(existing
      ? { title: existing.title, description: existing.description, priority: existing.priority, processId: String(existing.processId ?? ''),
          fitDecision: existing.fitDecision, fitNotes: existing.fitNotes, assigneeId: existing.assigneeId }
      : { title: '', description: '', priority: 'High', processId: processId ? String(processId) : '', fitDecision: 'Partly', fitNotes: '', assigneeId: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing, processId]);

  const titleError = touched && !f.title.trim() ? 'Title is required.' : null;
  const save = async () => {
    setTouched(true);
    if (!f.title.trim()) return;
    const body = { ...f, title: f.title.trim(), processId: f.processId ? Number(f.processId) : null };
    const r = await act.run(() => existing ? patch<Requirement>(`/requirements/${existing.id}`, body) : post<Requirement>('/requirements', body));
    if (r) { toast(existing ? 'Requirement saved' : `${r.code} created – team notified`); onSaved(r.id); }
  };

  return (
    <Dialog open={open} onClose={onClose} title={existing ? `Edit ${existing.code}` : 'Create Requirement'} size="lg" busy={act.pending}
      footer={<><Button variant="emph" busy={act.pending} onClick={() => void save()}>{existing ? 'Save' : 'Create'}</Button><Button variant="transparent" onClick={onClose} disabled={act.pending}>Cancel</Button></>}>
      {act.error && <MessageStrip type="error">{act.error}</MessageStrip>}
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <TextField label="Title" required className="full" maxLength={200} value={f.title} error={titleError} data-autofocus
          onChange={(e) => setF({ ...f, title: e.target.value })} />
        <TextAreaField label="Business need (as received from the business)" className="full" rows={4} value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })} />
        <SelectField label="Priority" required value={f.priority} options={PRIORITIES} onChange={(e) => setF({ ...f, priority: e.target.value })} />
        <SelectField label="Business process" value={f.processId} placeholder="— None —" onChange={(e) => setF({ ...f, processId: e.target.value })}
          options={(processes.data?.items ?? []).map((p) => ({ value: p.id, label: p.name }))} />
        <SelectField label="Fit-to-standard result" value={f.fitDecision} options={['Yes', 'Partly', 'No']} onChange={(e) => setF({ ...f, fitDecision: e.target.value })} />
        <UserSelect label="Assigned to" value={f.assigneeId} onChange={(v) => setF({ ...f, assigneeId: v })} />
        <TextAreaField label="Fit-to-standard notes" className="full" rows={2} value={f.fitNotes} onChange={(e) => setF({ ...f, fitNotes: e.target.value })} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
