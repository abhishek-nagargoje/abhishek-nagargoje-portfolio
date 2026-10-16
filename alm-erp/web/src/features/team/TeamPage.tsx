import { DataTable } from '../../components/common/DataTable';
import { SelectField } from '../../components/common/Field';
import { SampleFlag } from '../../components/common/Status';
import { FilterBar, PageHeader } from '../../components/layout/PageHeader';
import { useApi } from '../../hooks/useApi';
import { useListParams } from '../../hooks/useListParams';
import type { Page, UserLite } from '../../types';
import { formatDateTime } from '../../utils/format';

interface Act { id: number; action: string; entityType: string | null; entityRef: string | null; summary: string; createdAt: string; actorName: string | null }

const ENTITY = { requirement: 'Requirements', task: 'Tasks', test_case: 'Test cases', defect: 'Defects', incident: 'Incidents', PO: 'Purchase orders', PR: 'Requisitions', SO: 'Sales orders', DL: 'Deliveries', INV: 'Invoices', ST: 'Stock transfers', material: 'Stock adjustments', company: 'Companies' };

export function TeamPage() {
  const team = useApi<{ items: UserLite[] }>('/users');
  const L = useListParams(['entityType'] as const);
  const log = useApi<Page<Act>>(`/activity${L.query()}`);
  return (
    <>
      <PageHeader title="Team & Activity" subtitle="Project team workload and the audit trail of business changes">
        <FilterBar>
          <SelectField label="Activity on" value={L.values.entityType} onChange={(e) => L.set({ entityType: e.target.value })} placeholder="Everything"
            options={Object.entries(ENTITY).map(([value, label]) => ({ value, label }))} />
        </FilterBar>
      </PageHeader>
      <div className="page-content">
        <div className="card-grid">
          <section className="card span-2">
            <header className="card-header"><h2 className="card-title">Activity log</h2><span className="card-count">{log.data ? `${log.data.total} entries` : ''}</span></header>
            <DataTable caption="Activity log" rows={log.data?.items} loading={log.loading} error={log.error} onRetry={log.reload} rowKey={(a) => a.id}
              paging={log.data && { page: L.page, pageSize: log.data.pageSize, total: log.data.total, onPage: L.setPage }} emptyTitle="No activity yet"
              columns={[
                { key: 'when', header: 'When', render: (a) => <span className="nowrap">{formatDateTime(a.createdAt)}</span> },
                { key: 'who', header: 'User', render: (a) => a.actorName ?? 'System' },
                { key: 'what', header: 'Activity', render: (a) => a.summary },
              ]} />
          </section>
          <section className="card">
            <header className="card-header"><h2 className="card-title">Project team</h2><span className="card-count">{team.data?.items.length ?? ''}</span></header>
            <DataTable caption="Project team" rows={team.data?.items} loading={team.loading} error={team.error} onRetry={team.reload} rowKey={(u) => u.id}
              columns={[
                { key: 'name', header: 'Name', render: (u) => <>{u.fullName} <SampleFlag show={u.isSample} /><span className="sub">{u.roles.join(', ')}{u.location ? ` · ${u.location}` : ''}</span></> },
                { key: 'open', header: 'Open items', align: 'right', render: (u) => u.openItems },
              ]} />
          </section>
        </div>
      </div>
    </>
  );
}
