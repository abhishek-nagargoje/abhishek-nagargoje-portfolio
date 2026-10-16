import { PackageCheck, Receipt, Truck } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { ConfirmDialog } from '../../components/common/Dialog';
import { MessageStrip } from '../../components/common/MessageStrip';
import { Status } from '../../components/common/Status';
import { ErrorState, LoadingState } from '../../components/common/States';
import { PageHeader } from '../../components/layout/PageHeader';
import { useAction, useApi, useIdempotencyKey } from '../../hooks/useApi';
import { post } from '../../services/api';
import type { TxResult } from '../../types';
import { formatDateTime, formatINR, formatNumber } from '../../utils/format';
import { DocumentFlow } from '../documents/DocumentFlow';

interface DL {
  id: number; number: number; status: string; createdAt: string; plantCode: string; salesOrderId: number; salesOrderNumber: number; customerName: string;
  createdByName: string; pickedByName: string | null; pickedAt: string | null; goodsIssuedByName: string | null; goodsIssuedAt: string | null;
  invoiceId: number | null; invoiceNumber: number | null;
  items: { id: number; quantity: number; materialId: number; materialCode: string; materialDescription: string; unitPrice: string; onHand: number }[];
}

const STEPS = ['Created', 'Picked', 'Goods Issued', 'Billed'];

export function DeliveryDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data: d, error, loading, reload } = useApi<DL>(`/deliveries/${id}`);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'pick' | 'gi' | 'invoice' | null>(null);
  const [key, resetKey] = useIdempotencyKey();
  const act = useAction();

  if (loading && !d) return <LoadingState />;
  if (error && !d) return <div className="page-content"><ErrorState error={error} onRetry={reload} /></div>;
  if (!d) return null;
  const shortItems = d.items.filter((i) => i.onHand < i.quantity);
  const run = async (path: string) => {
    const r = await act.run(() => post<TxResult>(`/deliveries/${d.id}/${path}`, {}, key));
    setConfirm(null);
    if (r) { resetKey(); setMsg(r.message); reload(); }
  };
  const step = STEPS.indexOf(d.status);

  return (
    <>
      <PageHeader crumbs={[{ to: '/sales?tab=deliveries', label: 'Deliveries' }]} docTitle={`Delivery ${d.number}`}
        title={<>Outbound Delivery {d.number} <Status value={d.status} inverted /></>}
        subtitle={<>{d.customerName} · plant {d.plantCode} · <Link to={`/sales/orders/${d.salesOrderId}`}>Sales order {d.salesOrderNumber}</Link></>}
        actions={<>
          {d.status === 'Created' && can('delivery.pick') && <Button variant="emph" icon={<PackageCheck size={16} />} onClick={() => setConfirm('pick')}>Confirm Pick & Pack</Button>}
          {d.status === 'Picked' && can('delivery.goods_issue') && <Button variant="emph" icon={<Truck size={16} />} onClick={() => setConfirm('gi')}>Post Goods Issue</Button>}
          {d.status === 'Goods Issued' && can('invoice.create') && <Button variant="emph" icon={<Receipt size={16} />} onClick={() => setConfirm('invoice')}>Create Invoice</Button>}
          {d.invoiceId && <Link className="btn" to={`/sales/invoices/${d.invoiceId}`}>Invoice {d.invoiceNumber}</Link>}
        </>}>
        <ol className="stage-flow" aria-label="Delivery progress" style={{ marginTop: 12, listStyle: 'none', padding: 0 }}>
          {STEPS.map((s, i) => <li key={s} style={{ display: 'contents' }}><span className={i === step ? 'current' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>{s}</span></li>)}
        </ol>
      </PageHeader>
      <div className="page-content">
        {msg && <MessageStrip type="success" onClose={() => setMsg(null)}>{msg}</MessageStrip>}
        {act.error && <MessageStrip type="error" onClose={() => act.setError(null)}>{act.error}</MessageStrip>}
        {d.status === 'Picked' && shortItems.length > 0 && (
          <MessageStrip type="warning">Insufficient stock for {shortItems.map((i) => `${i.materialCode} (${i.onHand} on hand, ${i.quantity} needed)`).join(', ')}. Receive goods or transfer stock before posting the goods issue.</MessageStrip>
        )}
        <div className="card-grid">
          <Card title="Items" className="span-2">
            <table className="dt">
              <thead><tr><th>Material</th><th className="num">Quantity</th><th className="num">On hand @{d.plantCode}</th><th className="num">Unit price</th></tr></thead>
              <tbody>{d.items.map((i) => (
                <tr key={i.id}><td><Link to={`/inventory/materials/${i.materialId}`}>{i.materialCode}</Link><span className="sub">{i.materialDescription}</span></td>
                  <td className="num">{formatNumber(i.quantity)}</td><td className="num" style={{ color: d.status !== 'Goods Issued' && d.status !== 'Billed' && i.onHand < i.quantity ? 'var(--c-negative)' : undefined }}>{formatNumber(i.onHand)}</td>
                  <td className="num">{formatINR(i.unitPrice)}</td></tr>
              ))}</tbody>
            </table>
          </Card>
          <Card title="Processing">
            <ul className="timeline">
              <li>Created<small>{d.createdByName} · {formatDateTime(d.createdAt)}</small></li>
              {d.pickedAt && <li>Picked & packed<small>{d.pickedByName} · {formatDateTime(d.pickedAt)}</small></li>}
              {d.goodsIssuedAt && <li>Goods issue posted<small>{d.goodsIssuedByName} · {formatDateTime(d.goodsIssuedAt)}</small></li>}
            </ul>
          </Card>
          <DocumentFlow type="DL" id={d.id} />
        </div>
      </div>
      <ConfirmDialog open={!!confirm} busy={act.pending} onCancel={() => setConfirm(null)}
        title={confirm === 'pick' ? 'Confirm picking' : confirm === 'gi' ? 'Post goods issue' : 'Create invoice'}
        confirmLabel={confirm === 'pick' ? 'Confirm' : confirm === 'gi' ? 'Post goods issue' : 'Create invoice'}
        message={confirm === 'pick' ? `Confirm that all items of delivery ${d.number} are picked and packed.`
          : confirm === 'gi' ? `Stock at ${d.plantCode} will be reduced for every item. If any item is short, nothing is posted.`
          : `Create the customer invoice for delivery ${d.number}, including GST. A delivery can be billed only once.`}
        onConfirm={() => void run(confirm === 'pick' ? 'pick' : confirm === 'gi' ? 'goods-issue' : 'invoice')} />
    </>
  );
}
