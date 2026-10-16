import { useEffect, useState } from 'react';
import { Button } from '../../components/common/Button';
import { Dialog } from '../../components/common/Dialog';
import { SelectField, TextAreaField, TextField } from '../../components/common/Field';
import { MessageStrip } from '../../components/common/MessageStrip';
import { RequirementSelect, UserSelect } from '../../components/common/Pickers';
import { useToast } from '../../components/common/Toast';
import { useAction } from '../../hooks/useApi';
import { patch, post } from '../../services/api';
import type { Task } from '../../types';
import { PRIORITIES } from '../../utils/status';

export function TaskDialog({ open, onClose, onSaved, existing, requirementId }: {
  open: boolean; onClose: () => void; onSaved: (id: number) => void; existing?: Task; requirementId?: number;
}) {
  const toast = useToast();
  const act = useAction();
  const [touched, setTouched] = useState(false);
  const [f, setF] = useState({ title: '', description: '', priority: 'High', requirementId: null as number | null, assigneeId: null as number | null, dueDate: '' });
  useEffect(() => {
    if (!open) return;
    setTouched(false);
    act.setError(null);
    setF(existing
      ? { title: existing.title, description: existing.description, priority: existing.priority, requirementId: existing.requirementId, assigneeId: existing.assigneeId, dueDate: existing.dueDate ?? '' }
      : { title: '', description: '', priority: 'High', requirementId: requirementId ?? null, assigneeId: null, dueDate: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing, requirementId]);

  const save = async () => {
    setTouched(true);
    if (!f.title.trim()) return;
    const body = { ...f, title: f.title.trim(), dueDate: f.dueDate || null };
    const t = await act.run(() => existing ? patch<Task>(`/tasks/${existing.id}`, body) : post<Task>('/tasks', body));
    if (t) { toast(existing ? 'Task saved' : `${t.code} created`); onSaved(t.id); }
  };

  return (
    <Dialog open={open} onClose={onClose} title={existing ? `Edit ${existing.code}` : 'Create Task'} busy={act.pending}
      footer={<><Button variant="emph" busy={act.pending} onClick={() => void save()}>{existing ? 'Save' : 'Create'}</Button><Button variant="transparent" onClick={onClose} disabled={act.pending}>Cancel</Button></>}>
      {act.error && <MessageStrip type="error">{act.error}</MessageStrip>}
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <TextField label="Title" required className="full" maxLength={200} value={f.title} data-autofocus
          error={touched && !f.title.trim() ? 'Title is required.' : null} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <TextAreaField label="Description" className="full" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <SelectField label="Priority" value={f.priority} options={PRIORITIES} onChange={(e) => setF({ ...f, priority: e.target.value })} />
        <TextField label="Due date" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
        <UserSelect label="Assigned to" value={f.assigneeId} onChange={(v) => setF({ ...f, assigneeId: v })} />
        <RequirementSelect label="Linked requirement" value={f.requirementId} onChange={(v) => setF({ ...f, requirementId: v })} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
