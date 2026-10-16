import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { DataTable } from '../../components/common/DataTable';
import { SelectField, TextField } from '../../components/common/Field';
import { useUsers } from '../../components/common/Pickers';
import { Priority, SampleFlag, Status } from '../../components/common/Status';
import { FilterBar, PageHeader } from '../../components/layout/PageHeader';
import { useApi, useDebounced } from '../../hooks/useApi';
import { useListParams } from '../../hooks/useListParams';
import type { Page, TaskRow } from '../../types';
import { formatDate, todayISO } from '../../utils/format';
import { PRIORITIES, TASK_STATUSES } from '../../utils/status';
import { TaskDialog } from './TaskDialog';

export function TasksPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const users = useUsers();
  const L = useListParams(['q', 'status', 'priority', 'assigneeId', 'requirementId', 'overdue', 'new'] as const);
  const [q, setQ] = useState(L.values.q);
  const dq = useDebounced(q, 300);
  const { data, error, loading, reload } = useApi<Page<TaskRow>>(`/tasks${L.query({ q: dq, new: undefined })}`);
  const creating = L.values.new === '1';

  return (
    <>
      <PageHeader title="Tasks" subtitle="Implementation work items, owners and due dates"
        actions={can('task.create') && <Button variant="emph" icon={<Plus size={16} />} onClick={() => L.set({ new: '1' })}>Create Task</Button>}>
        <FilterBar>
          <TextField label="Search" className="wide" placeholder="ID or title" value={q} onChange={(e) => { setQ(e.target.value); L.set({ q: e.target.value }); }} />
          <SelectField label="Status" value={L.values.status} onChange={(e) => L.set({ status: e.target.value })} placeholder="All"
            options={[{ value: 'open', label: 'All open' }, ...TASK_STATUSES.map((s) => ({ value: s, label: s }))]} />
          <SelectField label="Priority" value={L.values.priority} onChange={(e) => L.set({ priority: e.target.value })} options={PRIORITIES} placeholder="All" />
          <SelectField label="Owner" value={L.values.assigneeId} onChange={(e) => L.set({ assigneeId: e.target.value })} placeholder="Anyone"
            options={[{ value: 'me', label: 'Me' }, { value: 'none', label: 'Unassigned' }, ...(users ?? []).map((u) => ({ value: u.id, label: u.fullName }))]} />
          <SelectField label="Due" value={L.values.overdue} onChange={(e) => L.set({ overdue: e.target.value })} placeholder="Any time"
            options={[{ value: 'true', label: 'Overdue' }]} />
        </FilterBar>
      </PageHeader>
      <div className="page-content">
        <section className="card">
          <header className="card-header"><h2 className="card-title">Tasks</h2><span className="card-count">{data ? `${data.total} items` : ''}</span></header>
          <DataTable caption="Tasks" rows={data?.items} loading={loading} error={error} onRetry={reload} rowKey={(t) => t.id}
            onRowClick={(t) => navigate(`/tasks/${t.id}`)} sort={{ value: L.values.sort, onChange: (s) => L.set({ sort: s }) }}
            paging={data && { page: L.page, pageSize: data.pageSize, total: data.total, onPage: L.setPage }}
            emptyTitle="No tasks match the filters"
            columns={[
              { key: 'code', header: 'ID', sortKey: 'code', render: (t) => <Link to={`/tasks/${t.id}`} onClick={(e) => e.stopPropagation()}>{t.code}</Link> },
              { key: 'title', header: 'Title', sortKey: 'title', render: (t) => <>{t.title} <SampleFlag show={t.isSample} /></> },
              { key: 'req', header: 'Requirement', render: (t) => t.requirementId ? <Link to={`/requirements/${t.requirementId}`} onClick={(e) => e.stopPropagation()}>{t.requirementCode}</Link> : '—' },
              { key: 'priority', header: 'Priority', sortKey: 'priority', render: (t) => <Priority value={t.priority} /> },
              { key: 'owner', header: 'Owner', render: (t) => t.assigneeName ?? <span className="muted">Unassigned</span> },
              { key: 'due', header: 'Due', sortKey: 'due', render: (t) => <span style={{ color: t.dueDate && t.dueDate < todayISO() && t.status !== 'Done' ? 'var(--c-negative)' : undefined }}>{formatDate(t.dueDate)}</span> },
              { key: 'status', header: 'Status', sortKey: 'status', render: (t) => <Status value={t.status} /> },
            ]}
          />
        </section>
      </div>
      <TaskDialog open={creating} requirementId={L.values.requirementId ? Number(L.values.requirementId) : undefined}
        onClose={() => L.set({ new: '' })} onSaved={(id) => navigate(`/tasks/${id}`)} />
    </>
  );
}
