import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/common/Button';
import { Dialog } from '../../components/common/Dialog';
import { SelectField, TextAreaField, TextField } from '../../components/common/Field';
import { MessageStrip } from '../../components/common/MessageStrip';
import { RequirementSelect, UserSelect } from '../../components/common/Pickers';
import { useToast } from '../../components/common/Toast';
import { useAction } from '../../hooks/useApi';
import { patch, post } from '../../services/api';
import type { TestCase } from '../../types';
import { PRIORITIES } from '../../utils/status';

type Step = { action: string; expectedResult: string };

export function TestCaseDialog({ open, onClose, onSaved, existing, requirementId }: {
  open: boolean; onClose: () => void; onSaved: (id: number) => void; existing?: TestCase; requirementId?: number;
}) {
  const toast = useToast();
  const act = useAction();
  const [touched, setTouched] = useState(false);
  const [f, setF] = useState({ title: '', description: '', priority: 'High', requirementId: null as number | null, assigneeId: null as number | null });
  const [steps, setSteps] = useState<Step[]>([{ action: '', expectedResult: '' }]);

  useEffect(() => {
    if (!open) return;
    setTouched(false);
    act.setError(null);
    if (existing) {
      setF({ title: existing.title, description: existing.description, priority: existing.priority, requirementId: existing.requirementId, assigneeId: existing.assigneeId });
      setSteps(existing.steps.length ? existing.steps.map((s) => ({ action: s.action, expectedResult: s.expectedResult })) : [{ action: '', expectedResult: '' }]);
    } else {
      setF({ title: '', description: '', priority: 'High', requirementId: requirementId ?? null, assigneeId: null });
      setSteps([{ action: '', expectedResult: '' }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing, requirementId]);

  const filled = steps.filter((s) => s.action.trim() || s.expectedResult.trim());
  const stepError = touched && filled.some((s) => !s.action.trim()) ? 'Every step needs an action.' : null;
  const stepsChanged = existing && JSON.stringify(filled) !== JSON.stringify(existing.steps.map((s) => ({ action: s.action, expectedResult: s.expectedResult })));

  const save = async () => {
    setTouched(true);
    if (!f.title.trim() || filled.some((s) => !s.action.trim())) return;
    const body = { ...f, title: f.title.trim(), ...(existing && !stepsChanged ? {} : { steps: filled.map((s) => ({ action: s.action.trim(), expectedResult: s.expectedResult.trim() })) }) };
    const tc = await act.run(() => existing ? patch<TestCase>(`/test-cases/${existing.id}`, body) : post<TestCase>('/test-cases', body));
    if (tc) { toast(existing ? 'Test case saved' : `${tc.code} created`); onSaved(tc.id); }
  };
  const move = (i: number, d: number) => {
    const n = [...steps];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    setSteps(n);
  };

  return (
    <Dialog open={open} onClose={onClose} size="lg" title={existing ? `Edit ${existing.code}` : 'Create Test Case'} busy={act.pending}
      footer={<><Button variant="emph" busy={act.pending} onClick={() => void save()}>{existing ? 'Save' : 'Create'}</Button><Button variant="transparent" onClick={onClose} disabled={act.pending}>Cancel</Button></>}>
      {act.error && <MessageStrip type="error">{act.error}</MessageStrip>}
      {stepsChanged && existing && existing.executions.length > 0 && (
        <MessageStrip type="warning">Changing the steps resets the test status to Ready. Earlier execution results stay in the history.</MessageStrip>
      )}
      <div className="form-grid">
        <TextField label="Title" required className="full" value={f.title} maxLength={200} data-autofocus
          error={touched && !f.title.trim() ? 'Title is required.' : null} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <TextAreaField label="Objective" className="full" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <SelectField label="Priority" value={f.priority} options={PRIORITIES} onChange={(e) => setF({ ...f, priority: e.target.value })} />
        <RequirementSelect label="Requirement (traceability)" value={f.requirementId} onChange={(v) => setF({ ...f, requirementId: v })} />
        <UserSelect label="Tester" value={f.assigneeId} onChange={(v) => setF({ ...f, assigneeId: v })} />
      </div>
      <h3 className="card-title" style={{ margin: '20px 0 8px' }}>Test steps</h3>
      {stepError && <p className="field-error" role="alert">{stepError}</p>}
      <table className="dt">
        <thead><tr><th style={{ width: 32 }}>#</th><th>Action</th><th>Expected result</th><th style={{ width: 110 }}><span className="sr-only">Step actions</span></th></tr></thead>
        <tbody>
          {steps.map((s, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td><input className="input" aria-label={`Step ${i + 1} action`} value={s.action} onChange={(e) => setSteps(steps.map((x, j) => j === i ? { ...x, action: e.target.value } : x))} /></td>
              <td><input className="input" aria-label={`Step ${i + 1} expected result`} value={s.expectedResult} onChange={(e) => setSteps(steps.map((x, j) => j === i ? { ...x, expectedResult: e.target.value } : x))} /></td>
              <td className="nowrap">
                <Button size="sm" variant="transparent" iconOnly aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></Button>
                <Button size="sm" variant="transparent" iconOnly aria-label={`Move step ${i + 1} down`} disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></Button>
                <Button size="sm" variant="transparent" iconOnly aria-label={`Remove step ${i + 1}`} disabled={steps.length === 1} onClick={() => setSteps(steps.filter((_, j) => j !== i))}><Trash2 size={14} /></Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button size="sm" variant="transparent" icon={<Plus size={14} />} style={{ marginTop: 8 }} onClick={() => setSteps([...steps, { action: '', expectedResult: '' }])}>Add step</Button>
    </Dialog>
  );
}
