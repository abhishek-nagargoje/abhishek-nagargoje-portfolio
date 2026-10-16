import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BarList, ColumnChart, Donut, StackedBar } from '../../components/charts/Charts';
import { Card } from '../../components/common/Card';
import { SelectField } from '../../components/common/Field';
import { SampleFlag, Status } from '../../components/common/Status';
import { ErrorState, LoadingState } from '../../components/common/States';
import { FilterBar, PageHeader } from '../../components/layout/PageHeader';
import { useApi } from '../../hooks/useApi';
import { formatDate, formatINRCompact, formatNumber, timeAgo } from '../../utils/format';
import { REQUIREMENT_STATUSES, TASK_STATUSES, TEST_STATUSES } from '../../utils/status';

interface Overview {
  project: null | {
    id: number; code: string; name: string; status: string; isSample: boolean; currentPhase: string | null; phaseEndsOn: string | null;
    remainingDays: number | null; phases: { name: string; startDate: string; endDate: string }[];
  };
  tasks: { byStatus: Record<string, number>; assignedToMe: number; upcoming: { id: number; code: string; title: string; status: string; dueDate: string | null; priority: string; assigneeName: string | null }[] };
  today: { failedTestRuns: number; blockedTasks: number; overdueTasks: number; unassignedTasks: number };
  requirements: { byStatus: Record<string, number> };
  tests: { byStatus: Record<string, number> };
  defects: { openBySeverity: Record<string, number> };
  procurement: { openPos: number; pendingApproval: number; approvableByOthers: number; openPoValue: string; openPrs: number; canApprove: boolean };
  sales: { openSos: number; openDeliveries: number; billedRevenue: string };
  recentActivity: { id: number; summary: string; createdAt: string; actorName: string | null }[];
  notifications: { id: number; message: string; link: string | null; createdAt: string }[];
}

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

export function OverviewPage() {
  const projects = useApi<{ items: { id: number; name: string }[] }>('/projects');
  const [projectId, setProjectId] = useState<string>('');
  const { data, error, loading, reload } = useApi<Overview>(`/dashboard/overview${projectId ? `?projectId=${projectId}` : ''}`);
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title="Project Overview"
        subtitle={data?.project ? <>{data.project.name} <SampleFlag show={data.project.isSample} label="Sample project" /></> : undefined}
        actions={<><Link className="btn btn-transparent" to="/requirements">Requirements</Link><Link className="btn btn-transparent" to="/tasks">Tasks</Link></>}
      >
        <FilterBar>
          <SelectField label="Project" className="wide" value={projectId || String(data?.project?.id ?? '')} onChange={(e) => setProjectId(e.target.value)}
            options={(projects.data?.items ?? []).map((p) => ({ value: p.id, label: p.name }))} />
        </FilterBar>
      </PageHeader>
      <div className="page-content">
        {loading && !data && <LoadingState />}
        {error && <ErrorState error={error} onRetry={reload} />}
        {data && !data.project && <ErrorState error="No project exists yet. An administrator can load the sample project with the seed command." />}
        {data?.project && (
          <div className="card-grid fixed">
            <Card title="Project" to="/tasks">
              <div className="row between"><span className="muted">Project Status:</span><Status value={data.project.status} inverted /></div>
              <p className="muted" style={{ margin: '16px 0 8px' }}>Overall Task Progress:</p>
              <StackedBar title="Tasks by status" data={TASK_STATUSES.map((s) => ({ label: s, value: data.tasks.byStatus[s] ?? 0 }))} />
              <div className="row between" style={{ marginTop: 24 }}>
                <span className="muted">Current Phase:</span>
                <span style={{ fontSize: '1.25rem', color: 'var(--c-brand)' }}>{data.project.currentPhase ?? '—'}</span>
              </div>
              <div className="text-right muted" style={{ marginTop: 12 }}>Ends on <span style={{ color: 'var(--c-text)' }}>{formatDate(data.project.phaseEndsOn)}</span></div>
              {data.project.remainingDays !== null && (
                <div className="text-right muted" style={{ marginTop: 6 }}>Remaining <span style={{ color: data.project.remainingDays < 0 ? 'var(--c-negative)' : 'var(--c-positive)' }}>{data.project.remainingDays}</span> Days</div>
              )}
            </Card>

            <Card title="Phase Timeline" subtitle="Elapsed time per phase">
              {data.project.phases.map((p) => {
                const s = Date.parse(p.startDate), e = Date.parse(p.endDate) + 86_400_000, now = Date.now();
                const pct = Math.round(Math.min(1, Math.max(0, (now - s) / (e - s))) * 100);
                return (
                  <div key={p.name} style={{ marginBottom: 10 }}>
                    <div className="row between"><span>{p.name}{p.name === data.project!.currentPhase ? ' (Current Phase)' : ''}</span><span className="muted small">{pct} %</span></div>
                    <div className="progress" role="progressbar" aria-label={`${p.name} elapsed`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
                    <span className="muted small">{formatDate(p.startDate)} – {formatDate(p.endDate)}</span>
                  </div>
                );
              })}
            </Card>

            <Card title="Today" bodyClass="flush">
              {[
                { label: 'Failed Test Runs', value: data.today.failedTestRuns, tone: 'negative', to: '/tests?status=Failed' },
                { label: 'Blocked Tasks', value: data.today.blockedTasks, tone: 'negative', to: '/tasks?status=Blocked' },
                { label: 'Overdue Tasks', value: data.today.overdueTasks, tone: 'critical', to: '/tasks?overdue=true' },
                { label: 'Unassigned Tasks', value: data.today.unassignedTasks, tone: '', to: '/tasks?assigneeId=none' },
              ].map((r) => (
                <div key={r.label} className={`list-row indicator clickable ${r.value ? r.tone : ''}`} onClick={() => navigate(r.to)}>
                  <Link to={r.to} style={{ color: 'inherit' }}>{r.label}</Link>
                  <span className={`value ${r.value ? r.tone : ''}`}>{formatNumber(r.value)}</span>
                </div>
              ))}
            </Card>

            <Card title="Upcoming Tasks" className="span-2" bodyClass="flush">
              <div className="kpi-row" style={{ padding: '12px 16px' }}>
                <Link to="/tasks?assigneeId=me"><span className="kpi-number">{data.tasks.assignedToMe}</span><span className="kpi-caption">Assigned to Me</span></Link>
                <Link to="/tasks?status=open"><span className="kpi-number" style={{ fontSize: '1rem' }}>{formatNumber(sum(data.tasks.byStatus) - (data.tasks.byStatus.Done ?? 0))}</span><span className="kpi-caption">All Open Tasks</span></Link>
              </div>
              {data.tasks.upcoming.length === 0 && <p className="muted" style={{ padding: '0 16px 16px' }}>No open tasks.</p>}
              {data.tasks.upcoming.map((t) => (
                <div key={t.id} className="list-row">
                  <Link to={`/tasks/${t.id}`}>{t.title}</Link>
                  <span className="muted small nowrap">{t.assigneeName ?? 'Unassigned'}</span>
                  <span className="spacer" />
                  <span className="small nowrap" style={{ color: t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10) ? 'var(--c-critical-text)' : undefined }}>{formatDate(t.dueDate)}</span>
                  <Status value={t.status} inverted />
                </div>
              ))}
            </Card>

            <Card title="Tasks" to="/tasks" count={`${formatNumber(sum(data.tasks.byStatus))} total`}>
              <ColumnChart title="Tasks by status" data={TASK_STATUSES.map((s) => ({ label: s, value: data.tasks.byStatus[s] ?? 0 }))} />
            </Card>

            <Card title="Requirement Statuses" to="/requirements">
              <BarList title="Requirements by status" data={REQUIREMENT_STATUSES.map((s) => ({ label: s, value: data.requirements.byStatus[s] ?? 0 }))} />
            </Card>

            <Card title="Test Execution" to="/tests">
              <ColumnChart title="Test cases by status" data={TEST_STATUSES.map((s) => ({ label: s, value: data.tests.byStatus[s] ?? 0 }))} />
            </Card>

            <Card title="Open Defects" to="/defects?status=open" subtitle="By severity">
              <Donut title="Open defects by severity" data={['Critical', 'High', 'Medium', 'Low'].map((s) => ({ label: s, value: data.defects.openBySeverity[s] ?? 0 }))} />
            </Card>

            <Card title="Procurement" to="/procurement" bodyClass="flush">
              <div className="list-row"><Link to="/procurement?tab=po&status=open">Open Purchase Orders</Link><span className="value">{formatNumber(data.procurement.openPos)}</span></div>
              <div className={`list-row indicator ${data.procurement.pendingApproval ? 'critical' : ''}`}>
                <Link to="/procurement?tab=po&status=Pending%20Approval">Pending Approval</Link>
                <span className={`value ${data.procurement.pendingApproval ? 'critical' : ''}`}>{formatNumber(data.procurement.pendingApproval)}</span>
              </div>
              <div className="list-row"><Link to="/procurement?tab=pr">Open Requisitions</Link><span className="value">{formatNumber(data.procurement.openPrs)}</span></div>
              <div className="list-row"><span>Open PO Value (incl. GST)</span><span className="value">{formatINRCompact(data.procurement.openPoValue)}</span></div>
            </Card>

            <Card title="Sales & Delivery" to="/sales" bodyClass="flush">
              <div className="list-row"><Link to="/sales?status=open">Open Sales Orders</Link><span className="value">{formatNumber(data.sales.openSos)}</span></div>
              <div className="list-row"><Link to="/sales?tab=deliveries">Deliveries not yet Billed</Link><span className="value">{formatNumber(data.sales.openDeliveries)}</span></div>
              <div className="list-row"><Link to="/sales?tab=invoices">Billed Revenue (incl. GST)</Link><span className="value" style={{ color: 'var(--c-positive)' }}>{formatINRCompact(data.sales.billedRevenue)}</span></div>
            </Card>

            <Card title="Needs Your Attention" to="/notifications" count={data.notifications.length ? `${data.notifications.length} unread` : undefined} bodyClass="flush">
              {data.notifications.length === 0 && <p className="muted" style={{ padding: 16 }}>No unread notifications.</p>}
              {data.notifications.map((n) => (
                <div key={n.id} className="list-row">{n.link ? <Link to={n.link}>{n.message}</Link> : <span>{n.message}</span>}<span className="spacer" /><span className="muted small nowrap">{timeAgo(n.createdAt)}</span></div>
              ))}
            </Card>

            <Card title="Recent Activity" to="/team" className="span-2">
              {data.recentActivity.length === 0 ? <p className="muted">No activity yet.</p> : (
                <ul className="timeline">
                  {data.recentActivity.map((a) => <li key={a.id}>{a.summary}<small>{a.actorName ?? 'System'} · {timeAgo(a.createdAt)}</small></li>)}
                </ul>
              )}
            </Card>

          </div>
        )}
      </div>
    </>
  );
}
