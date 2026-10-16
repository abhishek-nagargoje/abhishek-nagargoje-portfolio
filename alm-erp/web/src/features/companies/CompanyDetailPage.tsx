import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { MessageStrip } from '../../components/common/MessageStrip';
import { SampleFlag, Status } from '../../components/common/Status';
import { ErrorState, LoadingState } from '../../components/common/States';
import { PageHeader } from '../../components/layout/PageHeader';
import { useApi } from '../../hooks/useApi';
import type { Company } from '../../types';
import { formatDateTime, formatINR } from '../../utils/format';
import { DOC_LABEL, docLink } from '../documents/DocumentFlow';
import { CompanyDialog } from './CompanyDialog';

export function CompanyDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data: c, error, loading, reload } = useApi<Company>(`/companies/${id}`);
  const [editing, setEditing] = useState(false);
  if (loading && !c) return <LoadingState />;
  if (error && !c) return <div className="page-content"><ErrorState error={error} onRetry={reload} /></div>;
  if (!c) return null;
  const attr = (label: string, value: React.ReactNode) => <div><dt>{label}</dt><dd>{value || '—'}</dd></div>;
  return (
    <>
      <PageHeader crumbs={[{ to: '/companies', label: 'Customers & Vendors' }]} docTitle={c.name}
        title={<>{c.name} <Status value={c.status} inverted /> <SampleFlag show={c.isSample} /></>} subtitle={`${c.type} ${c.code} · ${c.industry}`}
        actions={<>
          {c.type === 'Customer' && can('so.create') && <Link className="btn" to="/sales?new=1">Create Sales Order</Link>}
          {c.type === 'Vendor' && can('po.create') && <Link className="btn" to="/procurement?dialog=po">Create Purchase Order</Link>}
          {can('company.manage') && <Button icon={<Pencil size={16} />} onClick={() => setEditing(true)}>Edit</Button>}
        </>} />
      <div className="page-content">
        {c.isSample && <MessageStrip type="info">Sample company from the development seed. Names and contacts are fictitious; no tax ID is stored.</MessageStrip>}
        <div className="card-grid">
          <Card title="Company details" className="span-2">
            <dl className="object-attrs" style={{ marginTop: 0 }}>
              {attr('Address', [c.addressLine, c.city, c.state, c.postalCode].filter(Boolean).join(', '))}
              {attr('Payment terms', c.paymentTerms)}
              {c.type === 'Vendor' && attr('Vendor rating', c.vendorRating ? `${'★'.repeat(c.vendorRating)}${'☆'.repeat(5 - c.vendorRating)}` : 'Not rated')}
              {c.restricted ? attr('Contact details', <span className="muted">Restricted to authorised roles</span>) : <>
                {attr('GSTIN', c.gstin)}
                {attr('Contact', c.contactName)}
                {attr('Email', c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : null)}
                {attr('Phone', c.phone)}
                {c.type === 'Customer' && attr('Credit limit', formatINR(c.creditLimit))}
              </>}
            </dl>
          </Card>
          <Card title="Recent documents" count={c.documents.length}>
            {c.documents.length === 0 ? <p className="muted">No documents yet.</p> : (
              <ul className="timeline">{c.documents.map((d) => {
                const l = docLink(d);
                return <li key={`${d.docType}-${d.id}`}>{l ? <Link to={l}>{DOC_LABEL[d.docType]} {d.number}</Link> : `${DOC_LABEL[d.docType]} ${d.number}`} <Status value={d.status} />{d.amount && ` · ${formatINR(d.amount)}`}<small>{formatDateTime(d.createdAt)}</small></li>;
              })}</ul>
            )}
          </Card>
        </div>
      </div>
      <CompanyDialog open={editing} existing={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />
    </>
  );
}
