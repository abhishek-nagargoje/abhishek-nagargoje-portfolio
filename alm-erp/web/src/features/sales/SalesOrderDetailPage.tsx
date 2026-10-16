import { ShoppingCart, Truck, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { ConfirmDialog, Dialog } from '../../components/common/Dialog';
import { MessageStrip } from '../../components/common/MessageStrip';
import { Status } from '../../components/common/Status';
import { ErrorState, LoadingState } from '../../components/common/States';
import { PageHeader } from '../../components/layout/PageHeader';
import { useAction, useApi, useIdempotencyKey } from '../../hooks/useApi';
import { post } from '../../services/api';
import type { TxResult } from '../../types';
import { formatDate, formatDateTime, formatINR, formatNumber } from '../../utils/format';
import { DocumentFlow } from '../documents/DocumentFlow';

interface SO {
  id: number; number: number; status: string; netAmount: string; taxAmount: string; totalAmount: string; requestedDeliveryDate: string | null;
  createdAt: string; createdByName: string; plantCode: string; plantName: string; customerId: number; customerCode: string; customerName: string;
  customerCity: string; customerIndustry: string;
  items: { id: number; lineNo: number; quantity: number; unitPrice: string; netAmount: string; deliveredQty: number; materialId: number; materialCode: string; materialDescription: string; onHand: number; incoming: number }[];
  deliveries: { id: number; number: number; status: string; createdAt: string; invoiceId: number | null; invoiceNumber: number | null; quantity: number }[];
  purchaseOrders: { id: number; number: number; status: string; totalAmount: string }[];
}

export function SalesOrderDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const location = useLocation();
  const { data: so, error, loading, reload } = useApi<SO>(`/sales-orders/${id}`);
  const [msg, setMsg] = useState<string | null>((location.state as { message?: string } | null)?.message ?? null);
  const [delivering, setDelivering] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [key, resetKey] = useIdempotencyKey();
  const act = useAction();

  if (loading && !so) return <LoadingState />;
  if (error && !so) return <div className="page-content"><ErrorState error={error} onRetry={reload} /></div>;
  if (!so) return null;
  const open = ['Open', 'Partially Delivered'].includes(so.status);
  const items = so.items.map((i) => ({ ...i, open: i.quantity - i.deliveredQty }));
  const wanted = items.map((i) => ({ salesOrderItemId: i.id, quantity: Number(qty[i.id] || 0), open: i.open })).filter((w) => w.quantity > 0);
  const invalid = !wanted.length || wanted.some((w) => !Number.isInteger(w.quantity) || w.quantity > w.open);

  const tx = async (fn: () => Promise<TxResult>) => {
    const r = await act.run(fn);
    if (r) { resetKey(); setMsg(r.message); reload(); }
    return r;
  };

  return (
    <>
      <PageHeader crumbs={[{ to: '/sales', label: 'Sales & Delivery' }]} docTitle={`SO ${so.number}`}
        title={<>Sales Order {so.number} <Status value={so.status} inverted /></>}
        subtitle={`${so.customerName} · plant ${so.plantCode} · created by ${so.createdByName} on ${formatDateTime(so.createdAt)}`}
        actions={<>
          {open && can('po.create') && <Link className="btn" to={`/procurement?dialog=po&salesOrderId=${so.id}`}><ShoppingCart size={16} />Create PO for this order</Link>}
          {so.status === 'Open' && !so.deliveries.length && can('so.create') && <Button variant="negative" icon={<XCircle size={16} />} onClick={() => setCancelling(true)}>Cancel order</Button>}
          {open && can('delivery.create') && <Button variant="emph" icon={<Truck size={16} />} onClick={() => { setQty(Object.fromEntries(items.map((i) => [i.id, String(i.open)]))); act.setError(null); setDelivering(true); }}>Create Delivery</Button>}
        </>}>
        <dl className="object-attrs">
          <div><dt>Net value</dt><dd>{formatINR(so.netAmount)}</dd></div>
          <div><dt>Requested delivery</dt><dd>{formatDate(so.requestedDeliveryDate)}</dd></div>
          <div><dt>Customer</dt><dd><Link to={`/companies/${so.customerId}`}>{so.customerName}</Link></dd></div>
        </dl>
      </PageHeader>
      <div className="page-content">
        {msg && <MessageStrip type={/short/i.test(msg) ? 'warning' : 'success'} onClose={() => setMsg(null)}>{msg}</MessageStrip>}
        {act.error && !delivering && <MessageStrip type="error" onClose={() => act.setError(null)}>{act.error}</MessageStrip>}
        <div className="stack">
          <Card title="Items and availability" subtitle={`Availability at ${so.plantCode}. Stock is checked again at goods issue.`}>
            <div className="table-wrap">
              <table className="dt">
                <caption className="sr-only">Sales order items</caption>
                <thead><tr><th>Item</th><th>Material</th><th className="num">Ordered</th><th className="num">On deliveries</th><th className="num">On hand</th><th className="num">Incoming</th><th className="num">Unit price</th><th className="num">Net</th></tr></thead>
                <tbody>{items.map((i) => {
                  const short = Math.max(0, i.open - i.onHand - i.incoming);
                  return (
                    <tr key={i.id}><td>{i.lineNo * 10}</td><td><Link to={`/inventory/materials/${i.materialId}`}>{i.materialCode}</Link><span className="sub">{i.materialDescription}</span>
                      {short > 0 && open && <span className="sub" style={{ color: 'var(--c-negative)' }}>Uncovered: {short}</span>}</td>
                      <td className="num">{formatNumber(i.quantity)}</td><td className="num">{formatNumber(i.deliveredQty)}</td><td className="num">{formatNumber(i.onHand)}</td>
                      <td className="num">{formatNumber(i.incoming)}</td><td className="num">{formatINR(i.unitPrice)}</td><td className="num">{formatINR(i.netAmount)}</td></tr>
                  );
                })}</tbody>
              </table>
            </div>
            <div className="totals" style={{ marginTop: 12 }}>
              <div><span>Net</span><span>{formatINR(so.netAmount)}</span></div>
              <div><span>GST</span><span>{formatINR(so.taxAmount)}</span></div>
              <div className="grand"><span>Total</span><span>{formatINR(so.totalAmount)}</span></div>
            </div>
          </Card>
          <div className="card-grid">
            <Card title="Deliveries" count={so.deliveries.length}>
              {so.deliveries.length === 0 ? <p className="muted">No deliveries yet.</p> : (
                <ul className="timeline">{so.deliveries.map((d) => (
                  <li key={d.id}><Link to={`/sales/deliveries/${d.id}`}>Delivery {d.number}</Link> · {d.quantity} units <Status value={d.status} />
                    {d.invoiceId && <> · <Link to={`/sales/invoices/${d.invoiceId}`}>Invoice {d.invoiceNumber}</Link></>}<small>{formatDateTime(d.createdAt)}</small></li>
                ))}</ul>
              )}
            </Card>
            <Card title="Purchase orders for this order" count={so.purchaseOrders.length}>
              {so.purchaseOrders.length === 0 ? <p className="muted">None.</p> : (
                <ul className="timeline">{so.purchaseOrders.map((p) => <li key={p.id}><Link to={`/procurement/purchase-orders/${p.id}`}>PO {p.number}</Link> <Status value={p.status} /> · {formatINR(p.totalAmount)}</li>)}</ul>
              )}
            </Card>
            <DocumentFlow type="SO" id={so.id} />
          </div>
        </div>
      </div>
      <Dialog open={delivering} title={`Create Delivery for Sales Order ${so.number}`} onClose={() => setDelivering(false)} busy={act.pending}
        footer={<><Button variant="emph" busy={act.pending} disabled={invalid}
          onClick={() => void tx(() => post<TxResult>(`/sales-orders/${so.id}/deliveries`, { items: wanted.map(({ salesOrderItemId, quantity }) => ({ salesOrderItemId, quantity })) }, key)).then((r) => r && setDelivering(false))}>Create delivery</Button>
          <Button variant="transparent" onClick={() => setDelivering(false)}>Cancel</Button></>}>
        {act.error && <MessageStrip type="error">{act.error}</MessageStrip>}
        <table className="dt">
          <thead><tr><th>Material</th><th className="num">Open</th><th className="num">On hand</th><th style={{ width: 140 }}>Deliver now</th></tr></thead>
          <tbody>{items.map((i) => (
            <tr key={i.id}><td>{i.materialCode}</td><td className="num">{i.open}</td><td className="num">{i.onHand}</td>
              <td><input className="input input-sm" type="number" min={0} max={i.open} disabled={!i.open} aria-label={`Quantity to deliver for ${i.materialCode}`}
                aria-invalid={Number(qty[i.id] || 0) > i.open ? true : undefined} value={qty[i.id] ?? ''} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} /></td></tr>
          ))}</tbody>
        </table>
      </Dialog>
      <ConfirmDialog open={cancelling} title={`Cancel sales order ${so.number}`} destructive confirmLabel="Cancel order" busy={act.pending}
        message="The order is closed and its demand is removed from planning." onCancel={() => setCancelling(false)}
        onConfirm={() => void tx(() => post<TxResult>(`/sales-orders/${so.id}/cancel`, {}, key)).then(() => setCancelling(false))} />
    </>
  );
}
