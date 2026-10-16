import { Link } from 'react-router-dom';
import { Card } from '../../components/common/Card';
import { Status } from '../../components/common/Status';
import { ErrorState, LoadingState } from '../../components/common/States';
import { useApi } from '../../hooks/useApi';
import type { DocRow } from '../../types';
import { formatDateTime, formatINR } from '../../utils/format';

export const DOC_LABEL: Record<string, string> = {
  PR: 'Purchase Requisition', PO: 'Purchase Order', GR: 'Goods Receipt', SO: 'Sales Order', DL: 'Outbound Delivery', INV: 'Invoice', ST: 'Stock Transfer',
};

export function docLink(d: { docType: string; id: number }): string | null {
  switch (d.docType) {
    case 'PO': return `/procurement/purchase-orders/${d.id}`;
    case 'SO': return `/sales/orders/${d.id}`;
    case 'DL': return `/sales/deliveries/${d.id}`;
    case 'INV': return `/sales/invoices/${d.id}`;
    case 'PR': return '/procurement?tab=pr';
    case 'GR': return '/procurement?tab=gr';
    default: return null;
  }
}

export function DocumentFlow({ type, id }: { type: string; id: number }) {
  const { data, error, loading, reload } = useApi<{ items: DocRow[] }>(`/documents/flow?type=${type}&id=${id}`);
  return (
    <Card title="Document flow" subtitle="Preceding and subsequent documents">
      {loading && !data && <LoadingState inline />}
      {error && <ErrorState error={error} onRetry={reload} inline />}
      {data && (
        <ol className="timeline">
          {data.items.map((d) => {
            const link = docLink(d);
            const label = `${DOC_LABEL[d.docType]} ${d.number}`;
            const current = d.docType === type && d.id === id;
            return (
              <li key={`${d.docType}-${d.id}`} aria-current={current ? 'true' : undefined}>
                {current ? <strong>{label}</strong> : link ? <Link to={link}>{label}</Link> : label} <Status value={d.status} />
                {d.amount && <span className="muted"> · {formatINR(d.amount)}</span>}
                <small>{formatDateTime(d.createdAt)}</small>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
