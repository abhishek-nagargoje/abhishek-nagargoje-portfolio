import { useEffect, useState } from 'react';
import { Button } from '../../components/common/Button';
import { Dialog } from '../../components/common/Dialog';
import { SelectField, TextAreaField, TextField } from '../../components/common/Field';
import { MessageStrip } from '../../components/common/MessageStrip';
import { RequirementSelect, UserSelect } from '../../components/common/Pickers';
import { useToast } from '../../components/common/Toast';
import { useAction } from '../../hooks/useApi';
import { patch, post } from '../../services/api';
import type { Defect } from '../../types';
import { PRIORITIES, SEVERITIES } from '../../utils/status';

const blank = { title: '', description: '', stepsToReproduce: '', expectedResult: '', actualResult: '', severity: 'Medium', priority: 'High', requirementId: null as number | null, assigneeId: null as number | null };

export function DefectDialog({ open, onClose, onSaved, existing }: { open: boolean; onClose: () => void; onSaved: (id: number) => void; existing?: Defect }) {
  const toast = useToast();
  const act = useAction();
  const [touched, setTouched] = useState(false);
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (!open) return;
    setTouched(false);
    act.setError(null);
    setF(existing ? {
      title: existing.title, description: existing.description, stepsToReproduce: existing.stepsToReproduce, expectedResult: existing.expectedResult,
      actualResult: existing.actualResult, severity: existing.severity, priority: existing.priority, requirementId: existing.requirementId, assigneeId: existing.assigneeId,
    } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing]);

  const save = async () => {
    setTouched(true);
    if (!f.title.trim()) return;
    const { requirementId, ...rest } = f;
    const body = existing ? { ...rest, title: f.title.trim() } : { ...f, title: f.title.trim() };
    const d = await act.run(() => existing ? patch<Defect>(`/defects/${existing.id}`, body) : post<Defect>('/defects', { ...body, requirementId }));
    if (d) { toast(existing ? 'Defect saved' : `${d.code} reported`); onSaved(d.id); }
  };

  return (
    <Dialog open={open} onClose={onClose} size="lg" title={existing ? `Edit ${existing.code}` : 'Report Defect'} busy={act.pending}
      footer={<><Button variant="emph" busy={act.pending} onClick={() => void save()}>{existing ? 'Save' : 'Report'}</Button><Button variant="transparent" onClick={onClose} disabled={act.pending}>Cancel</Button></>}>
      {act.error && <MessageStrip type="error">{act.error}</MessageStrip>}
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <TextField label="Title" required className="full" maxLength={200} value={f.title} data-autofocus
          error={touched && !f.title.trim() ? 'Title is required.' : null} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <SelectField label="Severity" value={f.severity} options={SEVERITIES} onChange={(e) => setF({ ...f, severity: e.target.value })} />
        <SelectField label="Priority" value={f.priority} options={PRIORITIES} onChange={(e) => setF({ ...f, priority: e.target.value })} />
        <UserSelect label="Assigned to" value={f.assigneeId} onChange={(v) => setF({ ...f, assigneeId: v })} />
        {!existing && <RequirementSelect label="Requirement" value={f.requirementId} onChange={(v) => setF({ ...f, requirementId: v })} />}
        <TextAreaField label="Description" className="full" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <TextAreaField label="Steps to reproduce" className="full" rows={3} value={f.stepsToReproduce} onChange={(e) => setF({ ...f, stepsToReproduce: e.target.value })} />
        <TextAreaField label="Expected result" rows={2} value={f.expectedResult} onChange={(e) => setF({ ...f, expectedResult: e.target.value })} />
        <TextAreaField label="Actual result" rows={2} value={f.actualResult} onChange={(e) => setF({ ...f, actualResult: e.target.value })} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
