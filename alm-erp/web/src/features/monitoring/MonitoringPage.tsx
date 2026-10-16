import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Donut, StackedColumns } from '../../components/charts/Charts';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { DataTable } from '../../components/common/DataTable';
import { Dialog } from '../../components/common/Dialog';
import { SelectField, TextAreaField, TextField } from '../../components/common/Field';
import { MessageStrip } from '../../components/common/MessageStrip';
import { UserSelect } from '../../components/common/Pickers';
import { SampleFlag, Status } from '../../components/common/Status';
import { ErrorState, LoadingState } from '../../components/common/States';
import { FilterBar, PageHeader } from '../../components/layout/PageHeader';
import { useAction, useApi } from '../../hooks/useApi';
import { useListParams } from '../../hooks/useListParams';
import { post } from '../../services/api';
import type { Page } from '../../types';
import { formatDateTime, formatNumber } from '../../utils/format';
import { SEVERITIES } from '../../utils/status';

interface Kpis {
  posPendingApproval: number; posStuck: number; posCreatedToday: number; deliveriesAwaitingGi: number; deliveriesAwaitingBilling: number;
  stockoutsWithDemand: number; openIncidents: number; stuckAfterHours: number;
  volume: { day: string; po: number; gr: number; so: number; dl: number; inv: number }[];
  openIncidentsBySeverity: { severity: string; count: number }[];
}
interface IncidentRow { id: number; code: string; title: string; severity: string; status: string; source: string; isSample: boolean; createdAt: string; processName: string | null; assigneeName: string | null }

function KpiTile({ label, value, sub, bad, to }: { label: string; value: number; sub: string; bad?: boolean; to: string }) {
  return (
    <Link to={to} className="card" style={{ padding: 16, display: 'block', color: 'inherit', textDecoration: 'none' }}>
      <div className="muted">{label}</div>
      <div className={`kpi-number ${bad ? (value ? 'negative' : 'positive') : ''}`}>{formatNumber(value)}</div>
      <div className="muted small">{sub}</div>
    </Link>
  );
}

export function MonitoringPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const kpi = useApi<Kpis>('/monitoring/kpis');
  const L = useListParams(['status', 'severity'] as const, { status: 'open' });
  const inc = useApi<Page<IncidentRow>>(`/monitoring/incidents${L.query()}`);
  const processes = useApi<{ items: { id: number; name: string }[] }>('/processes');
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ title: '', description: '', severity: 'High', processId: '', assigneeId: null as number | null, isSample: false });
  const act = useAction();
  const k = kpi.data;

  const create = async () => {
    if (!f.title.trim()) return;
    const r = await act.run(() => post<{ id: number }>('/monitoring/incidents', { ...f, title: f.title.trim(), processId: f.processId ? Number(f.processId) : null }));
    if (r) navigate(`/monitoring/incidents/${r.id}`);
  };

  return (
    <>
      <PageHeader title="Operations Monitoring" subtitle="Business process KPIs computed from the documents in this system, and incident handling. No external telemetry is connected."
        actions={can('incident.manage') && <Button variant="emph" icon={<Plus size={16} />} onClick={() => { setF({ title: '', description: '', severity: 'High', processId: '', assigneeId: null, isSample: false }); setCreating(true); }}>Open Incident</Button>}>
        <FilterBar>
          <SelectField label="Incident status" value={L.values.status} onChange={(e) => L.set({ status: e.target.value })} placeholder="All"
            options={[{ value: 'open', label: 'Open & investigating' }, 'Open', 'Investigating', 'Resolved'].map((o) => typeof o === 'string' ? { value: o, label: o } : o)} />
          <SelectField label="Severity" value={L.values.severity} onChange={(e) => L.set({ severity: e.target.value })} options={SEVERITIES} placeholder="All" />
        </FilterBar>
      </PageHeader>
      <div className="page-content">
        {kpi.loading && !k && <LoadingState />}
        {kpi.error && <ErrorState error={kpi.error} onRetry={kpi.reload} />}
        {k && (
          <div className="stack">
            <div className="card-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
              <KpiTile label="POs pending approval" value={k.posPendingApproval} sub={`${k.posCreatedToday} POs created today`} to="/procurement?tab=po&status=Pending%20Approval" />
              <KpiTile label="POs stuck in approval" value={k.posStuck} sub={`Pending > ${k.stuckAfterHours} h`} bad to="/procurement?tab=po&status=Pending%20Approval" />
              <KpiTile label="Deliveries awaiting goods issue" value={k.deliveriesAwaitingGi} sub="Created or picked" to="/sales?tab=deliveries" />
              <KpiTile label="Deliveries awaiting billing" value={k.deliveriesAwaitingBilling} sub="Goods issued, not invoiced" to="/sales?tab=deliveries&status=Goods%20Issued" />
              <KpiTile label="Stock-outs with open demand" value={k.stockoutsWithDemand} sub="Material/plant combinations" bad to="/mrp" />
              <KpiTile label="Open incidents" value={k.openIncidents} sub="Open or investigating" bad to="/monitoring?status=open" />
            </div>
            <div className="card-grid">
              <Card title={<><strong>1</strong> Document Volume</>} subtitle="Business documents created per day, last 14 days" className="span-2">
                <StackedColumns title="Documents per day" categories={k.volume.map((v) => v.day.slice(5).split('-').reverse().join('.'))} series={[
                  { label: 'Purchase orders', values: k.volume.map((v) => v.po), color: 'var(--chart-1)' },
                  { label: 'Goods receipts', values: k.volume.map((v) => v.gr), color: 'var(--chart-3)' },
                  { label: 'Sales orders', values: k.volume.map((v) => v.so), color: 'var(--chart-5)' },
                  { label: 'Deliveries', values: k.volume.map((v) => v.dl), color: 'var(--chart-2)' },
                  { label: 'Invoices', values: k.volume.map((v) => v.inv), color: 'var(--chart-4)' },
                ]} />
              </Card>
              <Card title={<><strong>2</strong> Open Incidents by Severity</>}>
                <Donut title="Open incidents by severity" data={['Critical', 'High', 'Medium', 'Low'].map((s) => ({ label: s, value: k.openIncidentsBySeverity.find((x) => x.severity === s)?.count ?? 0 }))} />
              </Card>
            </div>
            <section className="card">
              <header className="card-header"><h2 className="card-title"><strong>3</strong> Incidents</h2><span className="card-count">{inc.data ? `${inc.data.total} items` : ''}</span></header>
              <DataTable caption="Incidents" rows={inc.data?.items} loading={inc.loading} error={inc.error} onRetry={inc.reload} rowKey={(i) => i.id}
                onRowClick={(i) => navigate(`/monitoring/incidents/${i.id}`)} emptyTitle="No incidents" emptyText="All monitored processes are running without open incidents."
                paging={inc.data && { page: L.page, pageSize: inc.data.pageSize, total: inc.data.total, onPage: L.setPage }}
                columns={[
                  { key: 'code', header: 'ID', render: (i) => <Link to={`/monitoring/incidents/${i.id}`} onClick={(e) => e.stopPropagation()}>{i.code}</Link> },
                  { key: 'title', header: 'Alert', render: (i) => <>{i.title} <SampleFlag show={i.isSample} label="Demonstration" /><span className="sub">{i.processName ?? 'No process'}</span></> },
                  { key: 'sev', header: 'Severity', render: (i) => <Status value={i.severity} tone={i.severity === 'Critical' ? 'negative' : i.severity === 'High' ? 'critical' : 'neutral'} /> },
                  { key: 'owner', header: 'Assigned to', render: (i) => i.assigneeName ?? '—' },
                  { key: 'opened', header: 'Opened', render: (i) => formatDateTime(i.createdAt) },
                  { key: 'status', header: 'Status', render: (i) => <Status value={i.status} /> },
                ]} />
            </section>
          </div>
        )}
      </div>
      <Dialog open={creating} title="Open Incident" onClose={() => setCreating(false)} busy={act.pending}
        footer={<><Button variant="emph" busy={act.pending} disabled={!f.title.trim()} onClick={() => void create()}>Open incident</Button><Button variant="transparent" onClick={() => setCreating(false)}>Cancel</Button></>}>
        {act.error && <MessageStrip type="error">{act.error}</MessageStrip>}
        <div className="form-grid">
          <TextField label="Alert" required className="full" value={f.title} data-autofocus placeholder="e.g. Purchase orders stuck in approval" onChange={(e) => setF({ ...f, title: e.target.value })} />
          <SelectField label="Severity" value={f.severity} options={SEVERITIES} onChange={(e) => setF({ ...f, severity: e.target.value })} />
          <SelectField label="Business process" value={f.processId} placeholder="— None —" onChange={(e) => setF({ ...f, processId: e.target.value })}
            options={(processes.data?.items ?? []).map((p) => ({ value: p.id, label: p.name }))} />
          <UserSelect label="Assigned to" value={f.assigneeId} onChange={(v) => setF({ ...f, assigneeId: v })} />
          <TextAreaField label="Description" className="full" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <label className="checkbox full"><input type="checkbox" checked={f.isSample} onChange={(e) => setF({ ...f, isSample: e.target.checked })} /> Demonstration incident (training scenario, not a real production alert)</label>
        </div>
      </Dialog>
    </>
  );
}
