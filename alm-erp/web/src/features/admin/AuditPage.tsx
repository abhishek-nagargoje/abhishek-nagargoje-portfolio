import { DataTable } from '../../components/common/DataTable';
import { PageHeader } from '../../components/layout/PageHeader';
import { useApi } from '../../hooks/useApi';
import { useListParams } from '../../hooks/useListParams';
import type { Page } from '../../types';
import { formatDateTime } from '../../utils/format';

interface Entry { id: number; action: string; summary: string; createdAt: string; actorName: string | null; ip: string | null }

export function AuditPage() {
  const L = useListParams([] as const);
  const { data, error, loading, reload } = useApi<Page<Entry>>(`/activity${L.query({ category: 'security' })}`);
  return (
    <>
      <PageHeader title="Security Audit Log" subtitle="Sign-ins, failed attempts, password changes, user and configuration changes" />
      <div className="page-content">
        <section className="card">
          <DataTable caption="Security events" rows={data?.items} loading={loading} error={error} onRetry={reload} rowKey={(e) => e.id} emptyTitle="No security events"
            paging={data && { page: L.page, pageSize: data.pageSize, total: data.total, onPage: L.setPage }}
            columns={[
              { key: 'when', header: 'When', render: (e) => <span className="nowrap">{formatDateTime(e.createdAt)}</span> },
              { key: 'event', header: 'Event', render: (e) => <code>{e.action}</code> },
              { key: 'summary', header: 'Details', render: (e) => e.summary },
              { key: 'user', header: 'User', render: (e) => e.actorName ?? '—' },
              { key: 'ip', header: 'IP address', render: (e) => e.ip ?? '—' },
            ]} />
        </section>
      </div>
    </>
  );
}
