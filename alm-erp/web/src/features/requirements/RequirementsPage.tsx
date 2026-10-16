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
import type { Page, RequirementRow } from '../../types';
import { PRIORITIES, REQUIREMENT_STATUSES } from '../../utils/status';
import { RequirementDialog } from './RequirementDialog';

export function RequirementsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const users = useUsers();
  const processes = useApi<{ items: { id: number; name: string }[] }>('/processes');
  const L = useListParams(['q', 'status', 'priority', 'processId', 'assigneeId', 'stage'] as const);
  const [q, setQ] = useState(L.values.q);
  const dq = useDebounced(q, 300);
  const [creating, setCreating] = useState(false);
  const path = `/requirements${L.query({ q: dq })}`;
  const { data, error, loading, reload } = useApi<Page<RequirementRow>>(path);

  return (
    <>
      <PageHeader title="Requirements" subtitle="Business needs, fit-to-standard decisions and sign-off"
        actions={can('req.create') && <Button variant="emph" icon={<Plus size={16} />} onClick={() => setCreating(true)}>Create Requirement</Button>}>
        <FilterBar>
          <TextField label="Search" className="wide" placeholder="ID, title or description" value={q}
            onChange={(e) => { setQ(e.target.value); L.set({ q: e.target.value }); }} />
          <SelectField label="Status" value={L.values.status} onChange={(e) => L.set({ status: e.target.value })} options={REQUIREMENT_STATUSES} placeholder="All" />
          <SelectField label="Priority" value={L.values.priority} onChange={(e) => L.set({ priority: e.target.value })} options={PRIORITIES} placeholder="All" />
          <SelectField label="Process" value={L.values.processId} onChange={(e) => L.set({ processId: e.target.value })} placeholder="All"
            options={(processes.data?.items ?? []).map((p) => ({ value: p.id, label: p.name }))} />
          <SelectField label="Assigned to" value={L.values.assigneeId} onChange={(e) => L.set({ assigneeId: e.target.value })} placeholder="Anyone"
            options={[{ value: 'me', label: 'Me' }, ...(users ?? []).map((u) => ({ value: u.id, label: u.fullName }))]} />
        </FilterBar>
      </PageHeader>
      <div className="page-content">
        <section className="card">
          <header className="card-header"><h2 className="card-title">Requirements</h2><span className="card-count">{data ? `${data.total} items` : ''}</span></header>
          <DataTable
            caption="Requirements" rows={data?.items} loading={loading} error={error} onRetry={reload} rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/requirements/${r.id}`)}
            sort={{ value: L.values.sort, onChange: (s) => L.set({ sort: s }) }}
            paging={data && { page: L.page, pageSize: data.pageSize, total: data.total, onPage: L.setPage }}
            emptyTitle="No requirements match the filters"
            columns={[
              { key: 'code', header: 'ID', sortKey: 'code', render: (r) => <Link to={`/requirements/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.code}</Link> },
              { key: 'title', header: 'Title', sortKey: 'title', render: (r) => <>{r.title} <SampleFlag show={r.isSample} /><span className="sub">{r.processName ?? 'No process'}</span></> },
              { key: 'priority', header: 'Priority', sortKey: 'priority', render: (r) => <Priority value={r.priority} /> },
              { key: 'status', header: 'Status', sortKey: 'status', render: (r) => <Status value={r.status} /> },
              { key: 'fit', header: 'Fit', render: (r) => r.fitDecision },
              { key: 'assignee', header: 'Assigned to', render: (r) => r.assigneeName ?? <span className="muted">Unassigned</span> },
              { key: 'links', header: 'Tasks / Tests', align: 'right', render: (r) => `${r.taskCount} / ${r.testCount}` },
              { key: 'stage', header: 'Landscape', render: (r) => <span className="tag">{r.deploymentStage}</span> },
            ]}
          />
        </section>
      </div>
      <RequirementDialog open={creating} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); navigate(`/requirements/${id}`); }} />
    </>
  );
}
