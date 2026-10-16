import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { DataTable } from '../../components/common/DataTable';
import { SelectField, TextField } from '../../components/common/Field';
import { SampleFlag, Status } from '../../components/common/Status';
import { FilterBar, PageHeader } from '../../components/layout/PageHeader';
import { useApi, useDebounced } from '../../hooks/useApi';
import { useListParams } from '../../hooks/useListParams';
import type { CompanyRow, Page } from '../../types';
import { formatNumber } from '../../utils/format';
import { CompanyDialog } from './CompanyDialog';

export function CompaniesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const L = useListParams(['q', 'type', 'status'] as const);
  const [q, setQ] = useState(L.values.q);
  const dq = useDebounced(q, 300);
  const [creating, setCreating] = useState(false);
  const { data, error, loading, reload } = useApi<Page<CompanyRow>>(`/companies${L.query({ q: dq })}`);
  return (
    <>
      <PageHeader title="Customers & Vendors" subtitle="Company master data. Contact details are visible only to authorised roles."
        actions={can('company.manage') && <Button variant="emph" icon={<Plus size={16} />} onClick={() => setCreating(true)}>Create Company</Button>}>
        <FilterBar>
          <TextField label="Search" className="wide" placeholder="Name, ID, city or industry" value={q} onChange={(e) => { setQ(e.target.value); L.set({ q: e.target.value }); }} />
          <SelectField label="Type" value={L.values.type} onChange={(e) => L.set({ type: e.target.value })} options={['Customer', 'Vendor']} placeholder="All" />
          <SelectField label="Status" value={L.values.status} onChange={(e) => L.set({ status: e.target.value })} options={['Active', 'Blocked']} placeholder="All" />
        </FilterBar>
      </PageHeader>
      <div className="page-content">
        <section className="card">
          <header className="card-header"><h2 className="card-title">Companies</h2><span className="card-count">{data ? `${formatNumber(data.total)} found` : ''}</span></header>
          <DataTable caption="Companies" rows={data?.items} loading={loading} error={error} onRetry={reload} rowKey={(c) => c.id}
            onRowClick={(c) => navigate(`/companies/${c.id}`)} emptyTitle="No companies match"
            paging={data && { page: L.page, pageSize: data.pageSize, total: data.total, onPage: L.setPage }}
            columns={[
              { key: 'code', header: 'ID', render: (c) => <Link to={`/companies/${c.id}`} onClick={(e) => e.stopPropagation()}>{c.code}</Link> },
              { key: 'name', header: 'Name', render: (c) => <>{c.name} <SampleFlag show={c.isSample} /></> },
              { key: 'type', header: 'Type', render: (c) => c.type },
              { key: 'ind', header: 'Industry', render: (c) => c.industry },
              { key: 'city', header: 'City', render: (c) => c.city },
              { key: 'contact', header: 'Contact', render: (c) => c.restricted ? <span className="muted">Restricted</span> : c.contactName || '—' },
              { key: 'terms', header: 'Terms', render: (c) => c.paymentTerms },
              { key: 'status', header: 'Status', render: (c) => <Status value={c.status} /> },
            ]} />
        </section>
      </div>
      <CompanyDialog open={creating} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/companies/${id}`)} />
    </>
  );
}
