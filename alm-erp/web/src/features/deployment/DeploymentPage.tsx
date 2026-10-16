import { ArrowRight, CheckCircle2, Cloud, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { ColumnChart } from '../../components/charts/Charts';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { DataTable } from '../../components/common/DataTable';
import { Dialog } from '../../components/common/Dialog';
import { TextAreaField } from '../../components/common/Field';
import { MessageStrip } from '../../components/common/MessageStrip';
import { Status } from '../../components/common/Status';
import { ErrorState, LoadingState } from '../../components/common/States';
import { useToast } from '../../components/common/Toast';
import { PageHeader } from '../../components/layout/PageHeader';
import { useAction, useApi } from '../../hooks/useApi';
import { post } from '../../services/api';
import { formatDateTime } from '../../utils/format';

interface Item { id: number; code: string; title: string; status: string; deploymentStage: 'DEV' | 'QA' | 'PROD'; processName: string | null; lastPromotedAt: string | null }
interface Hist { id: number; fromStage: string; toStage: string; notes: string; createdAt: string; requirementId: number; requirementCode: string; performedByName: string }
interface Checks { target: string | null; ready: boolean; stage: string; checks: { key: string; label: string; ok: boolean; detail: string }[] }

const STAGES = [
  { id: 'DEV', name: 'Development', desc: 'Configuration and build' },
  { id: 'QA', name: 'Quality Assurance', desc: 'Integration and acceptance testing' },
  { id: 'PROD', name: 'Production', desc: 'Live business operation' },
] as const;

export function DeploymentPage() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ items: Item[]; history: Hist[] }>('/deployments');
  const [sel, setSel] = useState<Item | null>(null);
  const checks = useApi<Checks>(sel ? `/deployments/${sel.id}/checks` : null);
  const [notes, setNotes] = useState('');
  const act = useAction();

  const promote = async () => {
    const r = await act.run(() => post<{ stage: string }>(`/deployments/${sel!.id}/promote`, { notes }));
    if (r) { toast(`${sel!.code} promotion to ${r.stage} recorded`); setSel(null); reload(); }
  };
  const perm = checks.data?.target === 'PROD' ? 'deploy.prod' : 'deploy.qa';

  return (
    <>
      <PageHeader title="Landscape & Deployment" subtitle="Promotion workflow DEV → QA → PROD. Promotions are recorded workflow steps with their gate checks; this system does not move transports in a connected SAP system." />
      <div className="page-content">
        {loading && !data && <LoadingState />}
        {error && <ErrorState error={error} onRetry={reload} />}
        {data && (
          <div className="stack">
            <div className="card-grid fixed">
              {STAGES.map((s) => {
                const items = data.items.filter((i) => i.deploymentStage === s.id);
                const by = (st: string[]) => items.filter((i) => st.includes(i.status)).length;
                return (
                  <section key={s.id} className="card ls-card">
                    <header className="card-header">
                      <Cloud className="ls-icon" aria-hidden strokeWidth={1.4} />
                      <div><h2 className="card-title">{s.id} · {s.name}</h2><div className="card-subtitle">{s.desc}</div></div>
                    </header>
                    <div className="ls-metrics">
                      <span className="ls-total" aria-label={`${items.length} features`}>{items.length}</span>
                      <div style={{ flex: 1 }}>
                        <ColumnChart title={`${s.id} features by status`} height={130} data={[
                          { label: 'Approved', value: by(['Approved']), color: 'var(--chart-good)' },
                          { label: 'In Test', value: by(['In Test']), color: 'var(--chart-warn)' },
                          { label: 'Other', value: by(['New', 'Fit-to-Standard', 'In Realization']), color: 'var(--chart-1)' },
                        ]} />
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
            <section className="card">
              <header className="card-header"><h2 className="card-title">Features in the landscape</h2><span className="card-count">{data.items.length}</span></header>
              <DataTable caption="Features in the landscape" rows={data.items} rowKey={(i) => i.id} emptyTitle="No requirements yet"
                columns={[
                  { key: 'code', header: 'Feature', render: (i) => <><Link to={`/requirements/${i.id}`}>{i.code}</Link> {i.title}<span className="sub">{i.processName ?? '—'}</span></> },
                  { key: 'status', header: 'Requirement status', render: (i) => <Status value={i.status} /> },
                  { key: 'stage', header: 'Landscape', render: (i) => (
                    <span className="stage-flow" aria-label={`Currently in ${i.deploymentStage}`}>
                      {STAGES.map((s, idx) => {
                        const cur = STAGES.findIndex((x) => x.id === i.deploymentStage);
                        return <span key={s.id} className={idx === cur ? 'current' : idx < cur ? 'done' : ''}>{s.id}</span>;
                      })}
                    </span>) },
                  { key: 'last', header: 'Last promotion', render: (i) => formatDateTime(i.lastPromotedAt) },
                  { key: 'act', header: '', align: 'right', render: (i) => i.deploymentStage === 'PROD'
                    ? <Status value="In production" tone="positive" />
                    : <Button size="sm" icon={<ArrowRight size={14} />} onClick={() => { setNotes(''); act.setError(null); setSel(i); }}>Promote…</Button> },
                ]} />
            </section>
            <Card title="Promotion history" count={data.history.length}>
              {data.history.length === 0 ? <p className="muted">No promotions recorded yet.</p> : (
                <ul className="timeline">{data.history.map((h) => (
                  <li key={h.id}><Link to={`/requirements/${h.requirementId}`}>{h.requirementCode}</Link> {h.fromStage} → {h.toStage}{h.notes ? ` – ${h.notes}` : ''}<small>{h.performedByName} · {formatDateTime(h.createdAt)}</small></li>
                ))}</ul>
              )}
            </Card>
          </div>
        )}
      </div>
      <Dialog open={!!sel} onClose={() => setSel(null)} title={`Promote ${sel?.code ?? ''} to ${checks.data?.target ?? '…'}`} busy={act.pending}
        footer={<><Button variant="emph" busy={act.pending} disabled={!checks.data?.ready || !can(perm)} onClick={() => void promote()}>Record promotion</Button>
          <Button variant="transparent" onClick={() => setSel(null)} disabled={act.pending}>Cancel</Button></>}>
        {checks.loading && <LoadingState inline />}
        {checks.error && <ErrorState error={checks.error} inline />}
        {act.error && <MessageStrip type="error">{act.error}</MessageStrip>}
        {checks.data && (
          <div className="stack">
            <ul className="check-list">
              {checks.data.checks.map((c) => (
                <li key={c.key}>{c.ok ? <CheckCircle2 size={18} className="ok" aria-label="Passed" /> : <XCircle size={18} className="bad" aria-label="Failed" />}
                  <span>{c.label}<span className="muted small"> – {c.detail}</span></span></li>
              ))}
            </ul>
            {!can(perm) && <MessageStrip type="warning">Your role cannot record promotions to {checks.data.target}.</MessageStrip>}
            {!checks.data.ready && <MessageStrip type="info">Resolve the failed checks before promoting.</MessageStrip>}
            <TextAreaField label="Notes (e.g. change request reference)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        )}
      </Dialog>
    </>
  );
}
