import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { DataTable } from '../../components/common/DataTable';
import { SelectField, TextField } from '../../components/common/Field';
import { Priority, SampleFlag, Status } from '../../components/common/Status';
import { FilterBar, PageHeader } from '../../components/layout/PageHeader';
import { useApi, useDebounced } from '../../hooks/useApi';
import { useListParams } from '../../hooks/useListParams';
import type { Page, TestCaseRow } from '../../types';
import { formatDateTime } from '../../utils/format';
import { TEST_STATUSES } from '../../utils/status';
import { TestCaseDialog } from './TestCaseDialog';

export function TestsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const L = useListParams(['q', 'status', 'requirementId', 'assigneeId', 'new'] as const);
  const [q, setQ] = useState(L.values.q);
  const dq = useDebounced(q, 300);
  const { data, error, loading, reload } = useApi<Page<TestCaseRow>>(`/test-cases${L.query({ q: dq, new: undefined })}`);

  return (
    <>
      <PageHeader title="Test Management" subtitle="Test cases, steps and executions. Status is derived from execution results."
        actions={can('test.manage') && <Button variant="emph" icon={<Plus size={16} />} onClick={() => L.set({ new: '1' })}>Create Test Case</Button>}>
        <FilterBar>
          <TextField label="Search" className="wide" placeholder="ID or title" value={q} onChange={(e) => { setQ(e.target.value); L.set({ q: e.target.value }); }} />
          <SelectField label="Status" value={L.values.status} onChange={(e) => L.set({ status: e.target.value })} options={TEST_STATUSES} placeholder="All" />
          <SelectField label="Tester" value={L.values.assigneeId} onChange={(e) => L.set({ assigneeId: e.target.value })} placeholder="Anyone" options={[{ value: 'me', label: 'Me' }]} />
        </FilterBar>
      </PageHeader>
      <div className="page-content">
        <section className="card">
          <header className="card-header"><h2 className="card-title">Test cases</h2><span className="card-count">{data ? `${data.total} items` : ''}</span></header>
          <DataTable caption="Test cases" rows={data?.items} loading={loading} error={error} onRetry={reload} rowKey={(t) => t.id}
            onRowClick={(t) => navigate(`/tests/${t.id}`)} sort={{ value: L.values.sort, onChange: (s) => L.set({ sort: s }) }}
            paging={data && { page: L.page, pageSize: data.pageSize, total: data.total, onPage: L.setPage }} emptyTitle="No test cases match the filters"
            columns={[
              { key: 'code', header: 'ID', sortKey: 'code', render: (t) => <Link to={`/tests/${t.id}`} onClick={(e) => e.stopPropagation()}>{t.code}</Link> },
              { key: 'title', header: 'Title', sortKey: 'title', render: (t) => <>{t.title} <SampleFlag show={t.isSample} /></> },
              { key: 'req', header: 'Requirement', render: (t) => t.requirementId ? <Link to={`/requirements/${t.requirementId}`} onClick={(e) => e.stopPropagation()}>{t.requirementCode}</Link> : '—' },
              { key: 'prio', header: 'Priority', render: (t) => <Priority value={t.priority} /> },
              { key: 'steps', header: 'Steps', align: 'right', render: (t) => t.stepCount },
              { key: 'tester', header: 'Tester', render: (t) => t.assigneeName ?? <span className="muted">Unassigned</span> },
              { key: 'last', header: 'Last executed', render: (t) => formatDateTime(t.lastExecutedAt) },
              { key: 'status', header: 'Status', sortKey: 'status', render: (t) => <Status value={t.status} /> },
            ]} />
        </section>
      </div>
      <TestCaseDialog open={L.values.new === '1'} requirementId={L.values.requirementId ? Number(L.values.requirementId) : undefined}
        onClose={() => L.set({ new: '' })} onSaved={(id) => navigate(`/tests/${id}`)} />
    </>
  );
}
