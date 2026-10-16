import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { DataTable } from '../../components/common/DataTable';
import { SelectField, TextField } from '../../components/common/Field';
import { useUsers } from '../../components/common/Pickers';
import { SampleFlag, Status } from '../../components/common/Status';
import { FilterBar, PageHeader } from '../../components/layout/PageHeader';
import { useApi, useDebounced } from '../../hooks/useApi';
import { useListParams } from '../../hooks/useListParams';
import type { DefectRow, Page } from '../../types';
import { formatDateTime } from '../../utils/format';
import { DEFECT_STATUSES, SEVERITIES } from '../../utils/status';
import { DefectDialog } from './DefectDialog';

export function DefectsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const users = useUsers();
  const L = useListParams(['q', 'status', 'severity', 'assigneeId', 'requirementId'] as const);
  const [q, setQ] = useState(L.values.q);
  const dq = useDebounced(q, 300);
  const [creating, setCreating] = useState(false);
  const { data, error, loading, reload } = useApi<Page<DefectRow>>(`/defects${L.query({ q: dq })}`);
  return (
    <>
      <PageHeader title="Defects" subtitle="Issues from testing and operations, through fix, retest and closure"
        actions={can('defect.create') && <Button variant="emph" icon={<Plus size={16} />} onClick={() => setCreating(true)}>Report Defect</Button>}>
        <FilterBar>
          <TextField label="Search" className="wide" placeholder="ID or title" value={q} onChange={(e) => { setQ(e.target.value); L.set({ q: e.target.value }); }} />
          <SelectField label="Status" value={L.values.status} onChange={(e) => L.set({ status: e.target.value })} placeholder="All"
            options={[{ value: 'open', label: 'All open' }, ...DEFECT_STATUSES.map((s) => ({ value: s, label: s }))]} />
          <SelectField label="Severity" value={L.values.severity} onChange={(e) => L.set({ severity: e.target.value })} options={SEVERITIES} placeholder="All" />
          <SelectField label="Assigned to" value={L.values.assigneeId} onChange={(e) => L.set({ assigneeId: e.target.value })} placeholder="Anyone"
            options={[{ value: 'me', label: 'Me' }, ...(users ?? []).map((u) => ({ value: u.id, label: u.fullName }))]} />
        </FilterBar>
      </PageHeader>
      <div className="page-content">
        <section className="card">
          <header className="card-header"><h2 className="card-title">Defects</h2><span className="card-count">{data ? `${data.total} items` : ''}</span></header>
          <DataTable caption="Defects" rows={data?.items} loading={loading} error={error} onRetry={reload} rowKey={(d) => d.id}
            onRowClick={(d) => navigate(`/defects/${d.id}`)} sort={{ value: L.values.sort, onChange: (s) => L.set({ sort: s }) }}
            paging={data && { page: L.page, pageSize: data.pageSize, total: data.total, onPage: L.setPage }} emptyTitle="No defects match the filters"
            columns={[
              { key: 'code', header: 'ID', sortKey: 'code', render: (d) => <Link to={`/defects/${d.id}`} onClick={(e) => e.stopPropagation()}>{d.code}</Link> },
              { key: 'title', header: 'Title', sortKey: 'title', render: (d) => <>{d.title} <SampleFlag show={d.isSample} /></> },
              { key: 'sev', header: 'Severity', sortKey: 'severity', render: (d) => <Status value={d.severity} tone={d.severity === 'Critical' ? 'negative' : d.severity === 'High' ? 'critical' : 'neutral'} /> },
              { key: 'links', header: 'Requirement / Test', render: (d) => <>{d.requirementCode ?? '—'}{d.testCaseCode ? ` / ${d.testCaseCode}` : ''}</> },
              { key: 'owner', header: 'Assigned to', render: (d) => d.assigneeName ?? <span className="muted">Unassigned</span> },
              { key: 'updated', header: 'Updated', sortKey: 'updated', render: (d) => formatDateTime(d.updatedAt) },
              { key: 'status', header: 'Status', sortKey: 'status', render: (d) => <Status value={d.status} /> },
            ]} />
        </section>
      </div>
      <DefectDialog open={creating} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/defects/${id}`)} />
    </>
  );
}
