import { Link, useParams } from 'react-router-dom';
import { Card } from '../../components/common/Card';
import { Status } from '../../components/common/Status';
import { ErrorState, LoadingState } from '../../components/common/States';
import { PageHeader } from '../../components/layout/PageHeader';
import { useApi } from '../../hooks/useApi';
import { formatDateTime, formatINR, formatNumber } from '../../utils/format';
import { DocumentFlow } from '../documents/DocumentFlow';

interface Invoice {
  id: number; number: number; status: string; netAmount: string; taxRateBp: number; taxAmount: string; totalAmount: string; createdAt: string;
  customerId: number; customerCode: string; customerName: string; customerCity: string; customerIndustry: string; deliveryId: number; deliveryNumber: number;
  salesOrderId: number; salesOrderNumber: number; plantCode: string; plantName: string; createdByName: string;
  items: { quantity: number; unitPrice: string; netAmount: string; materialCode: string; materialDescription: string }[];
}

export function InvoiceDetailPage() {
  const { id } = useParams();
  const { data: inv, error, loading, reload } = useApi<Invoice>(`/invoices/${id}`);
  if (loading && !inv) return <LoadingState />;
  if (error && !inv) return <div className="page-content"><ErrorState error={error} onRetry={reload} /></div>;
  if (!inv) return null;
  return (
    <>
      <PageHeader crumbs={[{ to: '/sales?tab=invoices', label: 'Invoices' }]} docTitle={`Invoice ${inv.number}`}
        title={<>Tax Invoice {inv.number} <Status value={inv.status} inverted /></>}
        subtitle={<>Posted by {inv.createdByName} on {formatDateTime(inv.createdAt)} · <Link to={`/sales/deliveries/${inv.deliveryId}`}>Delivery {inv.deliveryNumber}</Link> · <Link to={`/sales/orders/${inv.salesOrderId}`}>Sales order {inv.salesOrderNumber}</Link></>} />
      <div className="page-content">
        <div className="stack">
          <Card title="Invoice document">
            <div className="doc-parties">
              <div className="doc-party"><div className="attr-label">Issued by</div><strong>ABC Manufacturing</strong><br />Plant {inv.plantCode} – {inv.plantName}</div>
              <div className="doc-party"><div className="attr-label">Bill to</div><Link to={`/companies/${inv.customerId}`}><strong>{inv.customerName}</strong></Link><br />{inv.customerCode} · {inv.customerIndustry}<br />{inv.customerCity}</div>
            </div>
            <table className="dt">
              <thead><tr><th>Material</th><th className="num">Quantity</th><th className="num">Unit price</th><th className="num">Net</th></tr></thead>
              <tbody>{inv.items.map((i, n) => (
                <tr key={n}><td>{i.materialCode}<span className="sub">{i.materialDescription}</span></td><td className="num">{formatNumber(i.quantity)}</td><td className="num">{formatINR(i.unitPrice)}</td><td className="num">{formatINR(i.netAmount)}</td></tr>
              ))}</tbody>
            </table>
            <div className="totals" style={{ marginTop: 12 }}>
              <div><span>Net</span><span>{formatINR(inv.netAmount)}</span></div>
              <div><span>GST {inv.taxRateBp / 100}%</span><span>{formatINR(inv.taxAmount)}</span></div>
              <div className="grand"><span>Total</span><span>{formatINR(inv.totalAmount)}</span></div>
            </div>
          </Card>
          <div className="card-grid"><DocumentFlow type="INV" id={inv.id} /></div>
        </div>
      </div>
    </>
  );
}
