import { Pencil, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { Comments, History } from '../../components/common/Comments';
import { ConfirmDialog } from '../../components/common/Dialog';
import { MessageStrip } from '../../components/common/MessageStrip';
import { Priority, SampleFlag, Status } from '../../components/common/Status';
import { ErrorState, LoadingState } from '../../components/common/States';
import { useToast } from '../../components/common/Toast';
import { PageHeader } from '../../components/layout/PageHeader';
import { useAction, useApi } from '../../hooks/useApi';
import { patch, post } from '../../services/api';
import type { LinkedItem, Requirement } from '../../types';
import { formatDate, formatDateTime } from '../../utils/format';
import { REQUIREMENT_NEXT } from '../../utils/status';
import { RequirementDialog } from './RequirementDialog';

function LinkedTable({ items, base, empty, extra }: { items: LinkedItem[]; base: string; empty: string; extra?: (i: LinkedItem) => string }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return (
    <table className="dt">
      <tbody>
        {items.map((i) => (
          <tr key={i.id}>
            <td style={{ width: 90 }}><Link to={`${base}/${i.id}`}>{i.code}</Link></td>
            <td>{i.title}<span className="sub">{i.assigneeName ?? 'Unassigned'}{extra ? ` · ${extra(i)}` : ''}</span></td>
            <td className="num"><Status value={i.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RequirementDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const { data: r, error, loading, reload } = useApi<Requirement>(`/requirements/${id}`);
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const act = useAction();

  if (loading && !r) return <LoadingState />;
  if (error && !r) return <div className="page-content"><ErrorState error={error} onRetry={reload} /></div>;
  if (!r) return null;

  const next = REQUIREMENT_NEXT[r.status] ?? [];
  const allowed = (s: string) => (s === 'Approved' || r.status === 'Approved' ? can('req.signoff') : can('req.edit'));
  const testsPassed = r.tests.length > 0 && r.tests.every((t) => t.status === 'Passed');

  const changeStatus = async () => {
    const ok = await act.run(() => patch(`/requirements/${r.id}`, { status: target }));
    setTarget(null);
    if (ok) { toast(`Status changed to ${target}`); reload(); }
  };
  const generate = async () => {
    const res = await act.run(() => post<{ created: unknown[] }>(`/requirements/${r.id}/generate-tasks`));
    if (res) { toast(res.created.length ? `${res.created.length} standard tasks created` : 'Standard tasks already exist'); reload(); }
  };

  return (
    <>
      <PageHeader
        crumbs={[{ to: '/requirements', label: 'Requirements' }]}
        docTitle={r.code}
        title={<>{r.code} · {r.title} <Status value={r.status} inverted /> <SampleFlag show={r.isSample} /></>}
        actions={<>
          {can('req.edit') && <Button icon={<Pencil size={16} />} onClick={() => setEditing(true)}>Edit</Button>}
          {can('task.create') && <Button icon={<Wand2 size={16} />} busy={act.pending && !target} onClick={() => void generate()}>Generate standard tasks</Button>}
        </>}
      >
        <dl className="object-attrs">
          <div><dt>Priority</dt><dd><Priority value={r.priority} /></dd></div>
          <div><dt>Process</dt><dd>{r.processName ?? '—'}</dd></div>
          <div><dt>Fit-to-standard</dt><dd>{r.fitDecision}</dd></div>
          <div><dt>Assigned to</dt><dd>{r.assigneeName ?? 'Unassigned'}</dd></div>
          <div><dt>Landscape</dt><dd><Link to="/deployment">{r.deploymentStage}</Link></dd></div>
          <div><dt>Created</dt><dd>{r.createdByName} · {formatDate(r.createdAt)}</dd></div>
          {r.approvedByName && <div><dt>Signed off</dt><dd>{r.approvedByName} · {formatDateTime(r.approvedAt)}</dd></div>}
        </dl>
      </PageHeader>
      <div className="page-content">
        {act.error && <MessageStrip type="error" onClose={() => act.setError(null)}>{act.error}</MessageStrip>}
        <div className="card-grid">
          <Card title="Status" subtitle="Only valid next steps are offered">
            <div className="row">
              {next.map((s) => (
                <Button key={s} variant={s === 'Approved' ? 'positive' : s === 'Rejected' ? 'negative' : 'default'} disabled={!allowed(s)}
                  title={allowed(s) ? undefined : 'You do not have permission for this step'} onClick={() => setTarget(s)}>
                  {s === 'Approved' ? 'Sign off (Approve)' : `Set to ${s}`}
                </Button>
              ))}
            </div>
            {r.status === 'In Test' && (
              <p className="muted small" style={{ marginTop: 12 }}>
                Sign-off requires the Business User, Project Manager or Procurement Head role and all linked tests passed
                ({r.tests.filter((t) => t.status === 'Passed').length}/{r.tests.length} passed{testsPassed ? ' ✓' : ''}).
              </p>
            )}
          </Card>
          <Card title="Business need" className="span-2">
            <p className="prewrap">{r.description || <span className="muted">No description.</span>}</p>
            {r.fitNotes && <><h3 className="attr-label" style={{ marginTop: 12 }}>Fit-to-standard notes</h3><p className="prewrap">{r.fitNotes}</p></>}
          </Card>
          <Card title="Tasks" className="span-2" count={r.tasks.length} actions={can('task.create') && <Link className="btn btn-sm btn-transparent" to={`/tasks?new=1&requirementId=${r.id}`}>Add task</Link>}>
            <LinkedTable items={r.tasks} base="/tasks" empty="No tasks linked." extra={(t) => `due ${formatDate(t.dueDate)}`} />
          </Card>
          <Card title="Test cases" className="span-2" count={r.tests.length} actions={can('test.manage') && <Link className="btn btn-sm btn-transparent" to={`/tests?new=1&requirementId=${r.id}`}>Add test case</Link>}>
            <LinkedTable items={r.tests} base="/tests" empty="No test cases linked – sign-off is not possible yet." />
          </Card>
          <Card title="Defects" count={r.defects.length}>
            <LinkedTable items={r.defects} base="/defects" empty="No defects." extra={(d) => d.severity ?? ''} />
          </Card>
          <Card title="Promotion history">
            {r.deployments.length === 0 ? <p className="muted">Not promoted yet (in DEV).</p> : (
              <ul className="timeline">{r.deployments.map((d) => <li key={d.id}>{d.fromStage} → {d.toStage}{d.notes ? ` – ${d.notes}` : ''}<small>{d.performedByName} · {formatDateTime(d.createdAt)}</small></li>)}</ul>
            )}
          </Card>
          <Comments entityType="requirement" entityId={r.id} />
          <History items={r.history} />
        </div>
      </div>
      <RequirementDialog open={editing} existing={r} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />
      <ConfirmDialog open={!!target} title={target === 'Approved' ? 'Give business sign-off' : 'Change status'} busy={act.pending}
        message={target === 'Approved' ? `Confirm business sign-off for ${r.code}. This is recorded with your name.` : `Change the status of ${r.code} from “${r.status}” to “${target}”?`}
        confirmLabel={target === 'Approved' ? 'Sign off' : 'Change status'} destructive={target === 'Rejected'}
        onConfirm={() => void changeStatus()} onCancel={() => setTarget(null)} />
    </>
  );
}
