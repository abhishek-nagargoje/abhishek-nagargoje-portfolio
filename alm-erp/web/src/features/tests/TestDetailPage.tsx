import { CheckCircle2, Pencil, Play, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { Comments } from '../../components/common/Comments';
import { ConfirmDialog } from '../../components/common/Dialog';
import { MessageStrip } from '../../components/common/MessageStrip';
import { Priority, SampleFlag, Status } from '../../components/common/Status';
import { ErrorState, LoadingState } from '../../components/common/States';
import { useToast } from '../../components/common/Toast';
import { PageHeader } from '../../components/layout/PageHeader';
import { useAction, useApi } from '../../hooks/useApi';
import { post } from '../../services/api';
import type { TestCase } from '../../types';
import { formatDateTime } from '../../utils/format';
import { TestCaseDialog } from './TestCaseDialog';

export function TestDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const { data: loaded, error, loading, reload } = useApi<TestCase>(`/test-cases/${id}`);
  const [tc, setTc] = useState<TestCase | undefined>();
  const [editing, setEditing] = useState(false);
  const [actuals, setActuals] = useState<Record<number, string>>({});
  const [cancelOpen, setCancelOpen] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const act = useAction();
  useEffect(() => { if (loaded) setTc(loaded); }, [loaded]);

  if (loading && !tc) return <LoadingState />;
  if (error && !tc) return <div className="page-content"><ErrorState error={error} onRetry={reload} /></div>;
  if (!tc) return null;

  const open = tc.executions.find((e) => !e.completedAt);
  const resultFor = (stepId: number) => open?.results.find((r) => r.stepId === stepId);
  const canExec = can('test.execute');

  const start = async () => {
    const r = await act.run(() => post<{ testCase: TestCase }>(`/test-cases/${tc.id}/executions`));
    if (r) { setTc(r.testCase); setActuals({}); setMsg(null); }
  };
  const record = async (stepId: number, result: 'Passed' | 'Failed') => {
    if (!open) return;
    const actualResult = actuals[stepId] ?? resultFor(stepId)?.actualResult ?? '';
    const r = await act.run(() => post<{ testCase: TestCase; defect: { id: number; code: string } | null }>(
      `/test-executions/${open.id}/steps/${stepId}`, { result, actualResult }));
    if (!r) return;
    setTc(r.testCase);
    if (r.defect) setMsg({ type: 'warning', text: `Step failed – defect ${r.defect.code} recorded and assigned.` });
    else if (r.testCase.status === 'Passed') { setMsg({ type: 'success', text: 'All steps passed. The test case is Passed and ready for business sign-off.' }); toast(`${tc.code} passed`); }
  };
  const cancel = async () => {
    const r = await act.run(() => post<{ testCase: TestCase }>(`/test-executions/${open!.id}/cancel`));
    setCancelOpen(false);
    if (r) setTc(r.testCase);
  };

  return (
    <>
      <PageHeader crumbs={[{ to: '/tests', label: 'Test Management' }]} docTitle={tc.code}
        title={<>{tc.code} · {tc.title} <Status value={tc.status} inverted /> <SampleFlag show={tc.isSample} /></>}
        actions={<>
          {can('test.manage') && <Button icon={<Pencil size={16} />} disabled={!!open} title={open ? 'Finish or cancel the running execution first' : undefined} onClick={() => setEditing(true)}>Edit</Button>}
          {canExec && !open && <Button variant="emph" icon={<Play size={16} />} busy={act.pending} disabled={!tc.steps.length} onClick={() => void start()}>Start execution</Button>}
          {canExec && open && <Button variant="negative" onClick={() => setCancelOpen(true)}>Cancel execution</Button>}
        </>}>
        <dl className="object-attrs">
          <div><dt>Requirement</dt><dd>{tc.requirementId ? <Link to={`/requirements/${tc.requirementId}`}>{tc.requirementCode} {tc.requirementTitle}</Link> : '—'}</dd></div>
          <div><dt>Priority</dt><dd><Priority value={tc.priority} /></dd></div>
          <div><dt>Tester</dt><dd>{tc.assigneeName ?? 'Unassigned'}</dd></div>
          <div><dt>Created by</dt><dd>{tc.createdByName}</dd></div>
        </dl>
      </PageHeader>
      <div className="page-content">
        {act.error && <MessageStrip type="error" onClose={() => act.setError(null)}>{act.error}</MessageStrip>}
        {msg && <MessageStrip type={msg.type} onClose={() => setMsg(null)}>{msg.text}</MessageStrip>}
        <div className="stack">
          <Card title={open ? `Execution #${open.id} in progress` : 'Test steps'} subtitle={open ? `Started by ${open.executedByName} · ${formatDateTime(open.startedAt)}` : tc.description || undefined} bodyClass="flush">
            {!tc.steps.length && <p className="muted" style={{ padding: 16 }}>No steps defined. Edit the test case to add steps.</p>}
            {tc.steps.length > 0 && (
              <div className="table-wrap">
                <table className="dt">
                  <caption className="sr-only">Test steps</caption>
                  <thead><tr><th style={{ width: 40 }}>#</th><th>Action</th><th>Expected result</th>{open && <><th>Actual result</th><th>Result</th></>}</tr></thead>
                  <tbody>
                    {tc.steps.map((s) => {
                      const r = resultFor(s.id);
                      return (
                        <tr key={s.id}>
                          <td>{s.seq}</td>
                          <td>{s.action}</td>
                          <td>{s.expectedResult}</td>
                          {open && (
                            <>
                              <td style={{ minWidth: 220 }}>
                                <input className="input input-sm" aria-label={`Actual result for step ${s.seq}`} disabled={!canExec}
                                  value={actuals[s.id] ?? r?.actualResult ?? ''} onChange={(e) => setActuals({ ...actuals, [s.id]: e.target.value })}
                                  placeholder="Required when failing" />
                              </td>
                              <td className="nowrap">
                                <span className="row" style={{ flexWrap: 'nowrap' }}>
                                  <Button size="sm" variant="positive" disabled={!canExec || act.pending} onClick={() => void record(s.id, 'Passed')} aria-label={`Pass step ${s.seq}`}>Pass</Button>
                                  <Button size="sm" variant="negative" disabled={!canExec || act.pending} onClick={() => void record(s.id, 'Failed')} aria-label={`Fail step ${s.seq}`}>Fail</Button>
                                  {r?.result === 'Passed' && <CheckCircle2 size={18} color="var(--c-positive)" aria-label="Passed" />}
                                  {r?.result === 'Failed' && <XCircle size={18} color="var(--c-negative)" aria-label="Failed" />}
                                </span>
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {open && <p className="muted small" style={{ padding: '8px 16px' }}>A failed step automatically records a defect. The test passes only when every step passes in the same execution.</p>}
          </Card>
          <div className="card-grid">
            <Card title="Execution history" count={tc.executions.length} className="span-2">
              {tc.executions.length === 0 ? <p className="muted">Not executed yet.</p> : (
                <table className="dt">
                  <thead><tr><th>Run</th><th>Executed by</th><th>Started</th><th>Completed</th><th>Steps</th><th>Result</th></tr></thead>
                  <tbody>{tc.executions.map((e) => (
                    <tr key={e.id}><td>#{e.id}</td><td>{e.executedByName}</td><td>{formatDateTime(e.startedAt)}</td><td>{formatDateTime(e.completedAt)}</td>
                      <td>{e.results.filter((x) => x.result === 'Passed').length} passed · {e.results.filter((x) => x.result === 'Failed').length} failed</td>
                      <td><Status value={e.completedAt ? e.status : `${e.status === 'Failed' ? 'Failed' : 'In Execution'}`} /></td></tr>
                  ))}</tbody>
                </table>
              )}
            </Card>
            <Card title="Defects from this test" count={tc.defects.length}>
              {tc.defects.length === 0 ? <p className="muted">None.</p> : (
                <ul className="timeline">{tc.defects.map((d) => <li key={d.id}><Link to={`/defects/${d.id}`}>{d.code}</Link> {d.title} <Status value={d.status} /></li>)}</ul>
              )}
            </Card>
            <Comments entityType="test_case" entityId={tc.id} />
          </div>
        </div>
      </div>
      <TestCaseDialog open={editing} existing={tc} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />
      <ConfirmDialog open={cancelOpen} title="Cancel execution" busy={act.pending} destructive confirmLabel="Cancel execution"
        message="Steps recorded so far are kept in the history. An incomplete execution never counts as passed."
        onConfirm={() => void cancel()} onCancel={() => setCancelOpen(false)} />
    </>
  );
}
