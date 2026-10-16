import { useNavigate } from 'react-router-dom';
import { DataTable } from '../../components/common/DataTable';
import { SelectField, TextField } from '../../components/common/Field';
import { PlantSelect } from '../../components/common/Pickers';
import { Status } from '../../components/common/Status';
import { FilterBar, PageHeader } from '../../components/layout/PageHeader';
import { useApi } from '../../hooks/useApi';
import { useListParams } from '../../hooks/useListParams';
import type { DocRow, Page } from '../../types';
import { formatDateTime, formatINR, formatNumber } from '../../utils/format';
import { DOC_LABEL, docLink } from './DocumentFlow';

export function DocumentsPage() {
  const navigate = useNavigate();
  const L = useListParams(['type', 'plantId', 'number'] as const);
  const numberOk = !L.values.number || /^\d{1,12}$/.test(L.values.number);
  const { data, error, loading, reload } = useApi<Page<DocRow>>(numberOk ? `/documents${L.query()}` : null);
  return (
    <>
      <PageHeader title="Document Flow" subtitle="All ERP documents across procurement, inventory and sales">
        <FilterBar>
          <SelectField label="Document type" value={L.values.type} onChange={(e) => L.set({ type: e.target.value })} placeholder="All types"
            options={Object.entries(DOC_LABEL).map(([value, label]) => ({ value, label }))} />
          <TextField label="Document number" inputMode="numeric" value={L.values.number} onChange={(e) => L.set({ number: e.target.value.trim() })}
            error={numberOk ? null : 'Digits only.'} />
          <PlantSelect label="Plant" value={L.values.plantId ? Number(L.values.plantId) : null} onChange={(v) => L.set({ plantId: v ? String(v) : '' })} placeholder="All plants" />
        </FilterBar>
      </PageHeader>
      <div className="page-content">
        <section className="card">
          <header className="card-header"><h2 className="card-title">Documents</h2><span className="card-count">{data ? `${formatNumber(data.total)} documents` : ''}</span></header>
          <DataTable caption="Documents" rows={data?.items} loading={loading} error={error} onRetry={reload} rowKey={(d) => `${d.docType}-${d.id}`}
            onRowClick={(d) => { const l = docLink(d); if (l) navigate(l); }} emptyTitle="No documents yet"
            emptyText="Create a sales order, requisition or purchase order to start a document flow."
            paging={data && { page: L.page, pageSize: data.pageSize, total: data.total, onPage: L.setPage }}
            columns={[
              { key: 'type', header: 'Type', render: (d) => DOC_LABEL[d.docType] },
              { key: 'no', header: 'Number', render: (d) => d.number },
              { key: 'plant', header: 'Plant', render: (d) => d.plantCode },
              { key: 'partner', header: 'Partner', render: (d) => d.partnerName ?? '—' },
              { key: 'amount', header: 'Amount', align: 'right', render: (d) => (d.amount ? formatINR(d.amount) : '—') },
              { key: 'by', header: 'Created', render: (d) => <>{formatDateTime(d.createdAt)}<span className="sub">{d.createdByName}</span></> },
              { key: 'status', header: 'Status', render: (d) => <Status value={d.status} /> },
            ]} />
        </section>
      </div>
    </>
  );
}
