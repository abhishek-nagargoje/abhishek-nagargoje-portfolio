import { Link } from 'react-router-dom';
import { Button } from '../../components/common/Button';
import { DataTable } from '../../components/common/DataTable';
import { SelectField } from '../../components/common/Field';
import { FilterBar, PageHeader } from '../../components/layout/PageHeader';
import { useAction, useApi } from '../../hooks/useApi';
import { useListParams } from '../../hooks/useListParams';
import { post } from '../../services/api';
import type { Page } from '../../types';
import { formatDateTime } from '../../utils/format';

interface Notif { id: number; message: string; link: string | null; isRead: boolean; createdAt: string; actorName: string | null }

export function NotificationsPage() {
  const L = useListParams(['unread'] as const);
  const { data, error, loading, reload } = useApi<Page<Notif> & { unread: number }>(`/notifications${L.query()}`);
  const act = useAction();
  const mark = async (id: number) => { if (await act.run(() => post(`/notifications/${id}/read`))) reload(); };
  return (
    <>
      <PageHeader title="Notifications" subtitle={data ? `${data.unread} unread` : undefined}
        actions={<Button disabled={!data?.unread} busy={act.pending} onClick={() => void act.run(() => post('/notifications/read-all')).then(reload)}>Mark all as read</Button>}>
        <FilterBar>
          <SelectField label="Show" value={L.values.unread} onChange={(e) => L.set({ unread: e.target.value })} placeholder="All" options={[{ value: 'true', label: 'Unread only' }]} />
        </FilterBar>
      </PageHeader>
      <div className="page-content">
        <section className="card">
          <DataTable caption="Notifications" rows={data?.items} loading={loading} error={error} onRetry={reload} rowKey={(n) => n.id} emptyTitle="No notifications"
            paging={data && { page: L.page, pageSize: data.pageSize, total: data.total, onPage: L.setPage }}
            columns={[
              { key: 'msg', header: 'Message', render: (n) => <span style={{ fontWeight: n.isRead ? undefined : 600 }}>{n.link ? <Link to={n.link} onClick={() => !n.isRead && void post(`/notifications/${n.id}/read`)}>{n.message}</Link> : n.message}</span> },
              { key: 'from', header: 'From', render: (n) => n.actorName ?? 'System' },
              { key: 'when', header: 'Received', render: (n) => formatDateTime(n.createdAt) },
              { key: 'act', header: '', align: 'right', render: (n) => !n.isRead && <Button size="sm" variant="transparent" onClick={() => void mark(n.id)}>Mark read</Button> },
            ]} />
        </section>
      </div>
    </>
  );
}
