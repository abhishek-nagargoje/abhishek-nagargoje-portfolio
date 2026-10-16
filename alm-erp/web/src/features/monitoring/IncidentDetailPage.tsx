import { Bug, CheckCircle2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { Dialog } from '../../components/common/Dialog';
import { SelectField, TextAreaField } from '../../components/common/Field';
import { MessageStrip } from '../../components/common/MessageStrip';
import { RequirementSelect, UserSelect } from '../../components/common/Pickers';
import { SampleFlag, Status } from '../../components/common/Status';
import { ErrorState, LoadingState } from '../../components/common/States';
import { useToast } from '../../components/common/Toast';
import { PageHeader } from '../../components/layout/PageHeader';
import { useAction, useApi } from '../../hooks/useApi';
import { post } from '../../services/api';
import { formatDateTime } from '../../utils/format';

interface Incident {
  id: number; code: string; title: string; description: string; severity: string; status: string; source: string; isSample: boolean;
  processName: string | null; assigneeName: string | null; createdByName: string; createdAt: string; resolvedByName: string | null;
  resolvedAt: string | null; resolution: string;
  notes: { id: number; kind: string; body: string; createdAt: string; authorName: string }[];
  defects: { id: number; code: string; title: string; status: string }[];
}

export function IncidentDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { data: i, error, loading, reload } = useApi<Incident>(`/monitoring/incidents/${id}`);
  const [note, setNote] = useState({ kind: 'Investigation', body: '' });
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState('');
  const [raising, setRaising] = useState(false);
  const [def, setDef] = useState({ requirementId: null as number | null, assigneeId: null as number | null });
  const act = useAction();

  if (loading && !i) return <LoadingState />;
  if (error && !i) return <div className="page-content"><ErrorState error={error} onRetry={reload} /></div>;
  if (!i) return null;
  const manage = can('incident.manage');
  const resolved = i.status === 'Resolved';

  const addNote = async () => {
    if (await act.run(() => post(`/monitoring/incidents/${i.id}/notes`, note))) { setNote({ ...note, body: '' }); reload(); }
  };
  const resolve = async () => {
    if (await act.run(() => post(`/monitoring/incidents/${i.id}/resolve`, { resolution }))) { setResolving(false); toast(`${i.code} resolved`); reload(); }
  };
  const reopen = async () => { if (await act.run(() => post(`/monitoring/incidents/${i.id}/reopen`))) reload(); };
  const raise = async () => {
    const r = await act.run(() => post<{ defectId: number }>(`/monitoring/incidents/${i.id}/defect`, def));
    if (r) { toast('Defect raised from incident'); navigate(`/defects/${r.defectId}`); }
  };

  return (
    <>
      <PageHeader crumbs={[{ to: '/monitoring', label: 'Operations Monitoring' }]} docTitle={i.code}
        title={<>{i.code} · {i.title} <Status value={i.status} inverted /> <SampleFlag show={i.isSample} label="Demonstration" /></>}
        actions={<>
          {can('defect.create') && <Button icon={<Bug size={16} />} onClick={() => setRaising(true)}>Create defect</Button>}
          {manage && !resolved && <Button variant="positive-emph" icon={<CheckCircle2 size={16} />} onClick={() => { setResolution(''); setResolving(true); }}>Resolve</Button>}
          {manage && resolved && <Button icon={<RotateCcw size={16} />} busy={act.pending} onClick={() => void reopen()}>Reopen</Button>}
        </>}>
        <dl className="object-attrs">
          <div><dt>Severity</dt><dd>{i.severity}</dd></div>
          <div><dt>Process</dt><dd>{i.processName ?? '—'}</dd></div>
          <div><dt>Assigned to</dt><dd>{i.assigneeName ?? '—'}</dd></div>
          <div><dt>Opened</dt><dd>{i.createdByName} · {formatDateTime(i.createdAt)}</dd></div>
          {i.resolvedAt && <div><dt>Resolved</dt><dd>{i.resolvedByName} · {formatDateTime(i.resolvedAt)}</dd></div>}
        </dl>
      </PageHeader>
      <div className="page-content">
        {act.error && <MessageStrip type="error" onClose={() => act.setError(null)}>{act.error}</MessageStrip>}
        {i.isSample && <MessageStrip type="info">This is a demonstration incident created for training. It does not come from production telemetry.</MessageStrip>}
        <div className="card-grid">
          <Card title="Alert details" className="span-2">
            <p className="prewrap">{i.description || <span className="muted">No description.</span>}</p>
            <p className="muted small">Suggested flow: KPI → alert → investigate → find the document → identify the cause → correct → monitor again.</p>
          </Card>
          <Card title="Linked defects" count={i.defects.length}>
            {i.defects.length === 0 ? <p className="muted">None.</p> : <ul className="timeline">{i.defects.map((d) => <li key={d.id}><Link to={`/defects/${d.id}`}>{d.code}</Link> {d.title} <Status value={d.status} /></li>)}</ul>}
          </Card>
          <Card title="Investigation log" className="span-2" count={i.notes.length}>
            {i.notes.length === 0 && <p className="muted">No notes yet.</p>}
            <ul className="timeline">{i.notes.map((n) => <li key={n.id}><span className="tag">{n.kind}</span> <span className="prewrap">{n.body}</span><small>{n.authorName} · {formatDateTime(n.createdAt)}</small></li>)}</ul>
            {manage && !resolved && (
              <form className="form-grid" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); void addNote(); }}>
                <SelectField label="Type" value={note.kind} options={['Investigation', 'Action']} onChange={(e) => setNote({ ...note, kind: e.target.value })} />
                <TextAreaField label="Note" className="full" rows={2} value={note.body} onChange={(e) => setNote({ ...note, body: e.target.value })} />
                <div><Button type="submit" variant="emph" busy={act.pending} disabled={!note.body.trim()}>Add note</Button></div>
              </form>
            )}
          </Card>
          {resolved && <Card title="Resolution"><p className="prewrap">{i.resolution}</p></Card>}
        </div>
      </div>
      <Dialog open={resolving} title={`Resolve ${i.code}`} size="sm" onClose={() => setResolving(false)} busy={act.pending}
        footer={<><Button variant="positive-emph" busy={act.pending} disabled={!resolution.trim()} onClick={() => void resolve()}>Resolve</Button><Button variant="transparent" onClick={() => setResolving(false)}>Cancel</Button></>}>
        <TextAreaField label="Resolution" required rows={3} value={resolution} data-autofocus onChange={(e) => setResolution(e.target.value)} />
      </Dialog>
      <Dialog open={raising} title={`Create defect from ${i.code}`} size="sm" onClose={() => setRaising(false)} busy={act.pending}
        footer={<><Button variant="emph" busy={act.pending} onClick={() => void raise()}>Create defect</Button><Button variant="transparent" onClick={() => setRaising(false)}>Cancel</Button></>}>
        <div className="stack">
          <RequirementSelect label="Related requirement" value={def.requirementId} onChange={(v) => setDef({ ...def, requirementId: v })} />
          <UserSelect label="Assign to" value={def.assigneeId} onChange={(v) => setDef({ ...def, assigneeId: v })} />
        </div>
      </Dialog>
    </>
  );
}
