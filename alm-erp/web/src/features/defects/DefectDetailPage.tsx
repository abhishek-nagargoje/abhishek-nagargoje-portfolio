import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { Comments, History } from '../../components/common/Comments';
import { Dialog } from '../../components/common/Dialog';
import { TextAreaField } from '../../components/common/Field';
import { MessageStrip } from '../../components/common/MessageStrip';
import { Priority, SampleFlag, Status } from '../../components/common/Status';
import { ErrorState, LoadingState } from '../../components/common/States';
import { useToast } from '../../components/common/Toast';
import { PageHeader } from '../../components/layout/PageHeader';
import { useAction, useApi } from '../../hooks/useApi';
import { patch } from '../../services/api';
import type { Defect } from '../../types';
import { formatDate, formatDateTime } from '../../utils/format';
import { DEFECT_NEXT } from '../../utils/status';
import { DefectDialog } from './DefectDialog';

const LABEL: Record<string, string> = { 'In Process': 'Start work', Fixed: 'Mark fixed', Retest: 'Send to retest', Closed: 'Close defect', Rejected: 'Reject', New: 'Reopen as new' };

export function DefectDetailPage() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const toast = useToast();
  const { data: d, error, loading, reload } = useApi<Defect>(`/defects/${id}`);
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const act = useAction();

  if (loading && !d) return <LoadingState />;
  if (error && !d) return <div className="page-content"><ErrorState error={error} onRetry={reload} /></div>;
  if (!d) return null;

  const canEdit = can('defect.edit') || d.assigneeId === user?.id;
  const allowed = (s: string) => (s === 'Closed' || d.status === 'Closed' ? can('defect.close') : canEdit);
  const needsResolution = (s: string) => s === 'Fixed' || s === 'Rejected';

  const apply = async () => {
    const body: Record<string, string> = { status: target! };
    if (needsResolution(target!)) body.resolution = resolution;
    const ok = await act.run(() => patch(`/defects/${d.id}`, body));
    if (ok) { toast(`${d.code}: ${target}`); setTarget(null); reload(); }
  };

  return (
    <>
      <PageHeader crumbs={[{ to: '/defects', label: 'Defects' }]} docTitle={d.code}
        title={<>{d.code} · {d.title} <Status value={d.status} inverted /> <SampleFlag show={d.isSample} /></>}
        actions={can('defect.edit') && <Button icon={<Pencil size={16} />} onClick={() => setEditing(true)}>Edit</Button>}>
        <dl className="object-attrs">
          <div><dt>Severity</dt><dd>{d.severity}</dd></div>
          <div><dt>Priority</dt><dd><Priority value={d.priority} /></dd></div>
          <div><dt>Assigned to</dt><dd>{d.assigneeName ?? 'Unassigned'}</dd></div>
          <div><dt>Requirement</dt><dd>{d.requirementId ? <Link to={`/requirements/${d.requirementId}`}>{d.requirementCode}</Link> : '—'}</dd></div>
          <div><dt>Test case</dt><dd>{d.testCaseId ? <><Link to={`/tests/${d.testCaseId}`}>{d.testCaseCode}</Link> <Status value={d.testCaseStatus ?? ''} /></> : '—'}</dd></div>
          {d.incidentId && <div><dt>Incident</dt><dd><Link to={`/monitoring/incidents/${d.incidentId}`}>{d.incidentCode}</Link></dd></div>}
          <div><dt>Reported</dt><dd>{d.createdByName} · {formatDate(d.createdAt)}</dd></div>
          {d.closedAt && <div><dt>Closed</dt><dd>{d.closedByName} · {formatDateTime(d.closedAt)}</dd></div>}
        </dl>
      </PageHeader>
      <div className="page-content">
        {act.error && !target && <MessageStrip type="error" onClose={() => act.setError(null)}>{act.error}</MessageStrip>}
        <div className="card-grid">
          <Card title="Workflow" subtitle="New → In Process → Fixed → Retest → Closed">
            <div className="row">
              {(DEFECT_NEXT[d.status] ?? []).map((s) => (
                <Button key={s} variant={s === 'Closed' ? 'positive' : s === 'Rejected' ? 'negative' : 'default'} disabled={!allowed(s)}
                  title={allowed(s) ? undefined : 'You do not have permission for this step'} onClick={() => { setResolution(d.resolution); act.setError(null); setTarget(s); }}>
                  {LABEL[s] ?? s}
                </Button>
              ))}
            </div>
            {d.status === 'Retest' && d.testCaseId && d.testCaseStatus !== 'Passed' && (
              <p className="muted small" style={{ marginTop: 8 }}>Closing requires a passing re-execution of <Link to={`/tests/${d.testCaseId}`}>{d.testCaseCode}</Link>.</p>
            )}
          </Card>
          <Card title="Details" className="span-2">
            <div className="form-grid">
              <div className="full"><div className="attr-label">Description</div><p className="prewrap">{d.description || '—'}</p></div>
              <div className="full"><div className="attr-label">Steps to reproduce</div><p className="prewrap">{d.stepsToReproduce || '—'}</p></div>
              <div><div className="attr-label">Expected result</div><p className="prewrap">{d.expectedResult || '—'}</p></div>
              <div><div className="attr-label">Actual result</div><p className="prewrap">{d.actualResult || '—'}</p></div>
              <div className="full"><div className="attr-label">Resolution</div><p className="prewrap">{d.resolution || '—'}</p></div>
            </div>
          </Card>
          <Comments entityType="defect" entityId={d.id} />
          <History items={d.history} />
        </div>
      </div>
      <DefectDialog open={editing} existing={d} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />
      <Dialog open={!!target} title={`${LABEL[target ?? ''] ?? target} – ${d.code}`} size="sm" onClose={() => setTarget(null)} busy={act.pending}
        footer={<><Button variant={target === 'Rejected' ? 'negative-emph' : 'emph'} busy={act.pending} disabled={!!target && needsResolution(target) && !resolution.trim()} onClick={() => void apply()}>Confirm</Button>
          <Button variant="transparent" onClick={() => setTarget(null)} disabled={act.pending}>Cancel</Button></>}>
        {act.error && <MessageStrip type="error">{act.error}</MessageStrip>}
        <p>Change status from “{d.status}” to “{target}”.</p>
        {target && needsResolution(target) && (
          <TextAreaField label="Resolution details" required rows={3} value={resolution} data-autofocus onChange={(e) => setResolution(e.target.value)} />
        )}
      </Dialog>
    </>
  );
}
