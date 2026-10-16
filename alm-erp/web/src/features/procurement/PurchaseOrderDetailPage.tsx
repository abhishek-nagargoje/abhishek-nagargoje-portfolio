import { CheckCircle2, PackageCheck, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { History } from '../../components/common/Comments';
import { ConfirmDialog, Dialog } from '../../components/common/Dialog';
import { TextAreaField } from '../../components/common/Field';
import { MessageStrip } from '../../components/common/MessageStrip';
import { Status } from '../../components/common/Status';
import { ErrorState, LoadingState } from '../../components/common/States';
import { PageHeader } from '../../components/layout/PageHeader';
import { useAction, useApi, useIdempotencyKey } from '../../hooks/useApi';
import { post } from '../../services/api';
import type { HistoryEntry, TxResult } from '../../types';
import { formatDateTime, formatINR, formatNumber } from '../../utils/format';
import { DocumentFlow } from '../documents/DocumentFlow';

interface PO {
  id: number; number: number; status: string; netAmount: string; taxAmount: string; totalAmount: string; approvalRequired: boolean;
  approvedByName: string | null; approvedAt: string | null; rejectionReason: string; createdBy: number; createdByName: string; createdAt: string;
  plantCode: string; plantName: string; vendorCode: string; vendorName: string; vendorCity: string; vendorIndustry: string;
  vendorId: number; customerId: number | null; customerCode: string | null; customerName: string | null;
  requisitionNumber: number | null; salesOrderId: number | null; salesOrderNumber: number | null;
  items: { id: number; lineNo: number; quantity: number; unitPrice: string; netAmount: string; receivedQty: number; materialId: number; materialCode: string; materialDescription: string }[];
  receipts: { id: number; number: number; postedAt: string; postedByName: string; quantity: number }[];
  history: HistoryEntry[];
}

export function PurchaseOrderDetailPage() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const { data: po, error, loading, reload } = useApi<PO>(`/purchase-orders/${id}`);
  const settings = useApi<{ allowSelfApproval: boolean; gstRateBp: number }>('/settings/business');
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [receiving, setReceiving] = useState(false);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [key, resetKey] = useIdempotencyKey();
  const act = useAction();

  if (loading && !po) return <LoadingState />;
  if (error && !po) return <div className="page-content"><ErrorState error={error} onRetry={reload} /></div>;
  if (!po) return null;

  const pending = po.status === 'Pending Approval';
  const ownPo = po.createdBy === user?.id;
  const canApprove = can('po.approve') && (!ownPo || settings.data?.allowSelfApproval);
  const receivable = ['Approved', 'Partially Received'].includes(po.status) && can('gr.post');
  const runTx = async (fn: () => Promise<TxResult>) => {
    const r = await act.run(fn);
    if (r) { resetKey(); setMsg(r.message); reload(); }
    return r;
  };
  const openReceipt = () => {
    setQty(Object.fromEntries(po.items.map((i) => [i.id, String(i.quantity - i.receivedQty)])));
    act.setError(null);
    setReceiving(true);
  };
  const receiptItems = po.items.map((i) => ({ purchaseOrderItemId: i.id, quantity: Number(qty[i.id] || 0), open: i.quantity - i.receivedQty, code: i.materialCode }))
    .filter((i) => i.quantity > 0);
  const receiptInvalid = !receiptItems.length || receiptItems.some((i) => !Number.isInteger(i.quantity) || i.quantity > i.open);

  return (
    <>
      <PageHeader crumbs={[{ to: '/procurement?tab=po', label: 'Procurement' }]} docTitle={`PO ${po.number}`}
        title={<>Purchase Order {po.number} <Status value={po.status} inverted /></>}
        subtitle={`${po.vendorName} · plant ${po.plantCode} · created by ${po.createdByName} on ${formatDateTime(po.createdAt)}`}
        actions={<>
          {pending && can('po.approve') && <>
            <Button variant="positive-emph" icon={<CheckCircle2 size={16} />} disabled={!canApprove} title={canApprove ? undefined : 'You cannot approve a purchase order you created'} onClick={() => setConfirm(true)}>Approve</Button>
            <Button variant="negative" icon={<XCircle size={16} />} onClick={() => { setReason(''); setRejecting(true); }}>Reject</Button>
          </>}
          {receivable && <Button variant="emph" icon={<PackageCheck size={16} />} onClick={openReceipt}>Post Goods Receipt</Button>}
        </>}>
        <dl className="object-attrs">
          <div><dt>Net value</dt><dd>{formatINR(po.netAmount)}</dd></div>
          <div><dt>Approval</dt><dd>{po.approvalRequired ? (po.approvedByName ? `Approved by ${po.approvedByName} · ${formatDateTime(po.approvedAt)}` : pending ? 'Required – awaiting Procurement Head' : po.status) : 'Not required (below threshold)'}</dd></div>
          {po.requisitionNumber && <div><dt>Requisition</dt><dd>PR {po.requisitionNumber}</dd></div>}
          {po.salesOrderId && <div><dt>Sales order</dt><dd><Link to={`/sales/orders/${po.salesOrderId}`}>SO {po.salesOrderNumber}</Link></dd></div>}
        </dl>
      </PageHeader>
      <div className="page-content">
        {msg && <MessageStrip type="success" onClose={() => setMsg(null)}>{msg}</MessageStrip>}
        {act.error && !receiving && !rejecting && <MessageStrip type="error" onClose={() => act.setError(null)}>{act.error}</MessageStrip>}
        {pending && ownPo && can('po.approve') && !settings.data?.allowSelfApproval && <MessageStrip type="info">You created this order, so another approver must release it.</MessageStrip>}
        {po.status === 'Rejected' && <MessageStrip type="error">Rejected: {po.rejectionReason}</MessageStrip>}
        <div className="stack">
          <Card title="Purchase order document">
            <div className="doc-parties">
              <div className="doc-party"><div className="attr-label">Issued by</div><strong>ABC Manufacturing</strong><br />Plant {po.plantCode} – {po.plantName}<br />{po.createdByName}</div>
              <div className="doc-party"><div className="attr-label">Vendor</div><Link to={`/companies/${po.vendorId}`}><strong>{po.vendorName}</strong></Link><br />{po.vendorCode} · {po.vendorIndustry}<br />{po.vendorCity}</div>
              {po.customerName && <div className="doc-party"><div className="attr-label">On behalf of customer</div><Link to={`/companies/${po.customerId}`}><strong>{po.customerName}</strong></Link><br />{po.customerCode}</div>}
            </div>
            <div className="table-wrap">
              <table className="dt">
                <caption className="sr-only">Purchase order items</caption>
                <thead><tr><th>Item</th><th>Material</th><th className="num">Quantity</th><th className="num">Received</th><th className="num">Unit price</th><th className="num">Net</th></tr></thead>
                <tbody>{po.items.map((i) => (
                  <tr key={i.id}><td>{i.lineNo * 10}</td><td><Link to={`/inventory/materials/${i.materialId}`}>{i.materialCode}</Link><span className="sub">{i.materialDescription}</span></td>
                    <td className="num">{formatNumber(i.quantity)}</td><td className="num">{formatNumber(i.receivedQty)}</td><td className="num">{formatINR(i.unitPrice)}</td><td className="num">{formatINR(i.netAmount)}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div className="totals" style={{ marginTop: 12 }}>
              <div><span>Net</span><span>{formatINR(po.netAmount)}</span></div>
              <div><span>GST{settings.data ? ` ${settings.data.gstRateBp / 100}%` : ''}</span><span>{formatINR(po.taxAmount)}</span></div>
              <div className="grand"><span>Total</span><span>{formatINR(po.totalAmount)}</span></div>
            </div>
          </Card>
          <div className="card-grid">
            <Card title="Goods receipts" count={po.receipts.length}>
              {po.receipts.length === 0 ? <p className="muted">Nothing received yet.</p> : (
                <ul className="timeline">{po.receipts.map((r) => <li key={r.id}>GR {r.number}: {formatNumber(r.quantity)} units<small>{r.postedByName} · {formatDateTime(r.postedAt)}</small></li>)}</ul>
              )}
            </Card>
            <DocumentFlow type="PO" id={po.id} />
            <History items={po.history} />
          </div>
        </div>
      </div>
      <ConfirmDialog open={confirm} title={`Approve PO ${po.number}`} confirmLabel="Approve" busy={act.pending}
        message={`Approve purchase order ${po.number} for ${formatINR(po.netAmount)} net (${formatINR(po.totalAmount)} incl. GST) from ${po.vendorName}?`}
        onCancel={() => setConfirm(false)} onConfirm={() => void runTx(() => post<TxResult>(`/purchase-orders/${po.id}/approve`, {}, key)).then(() => setConfirm(false))} />
      <Dialog open={rejecting} title={`Reject PO ${po.number}`} size="sm" onClose={() => setRejecting(false)} busy={act.pending}
        footer={<><Button variant="negative-emph" busy={act.pending} disabled={reason.trim().length < 3} onClick={() => void runTx(() => post<TxResult>(`/purchase-orders/${po.id}/reject`, { reason }, key)).then((r) => r && setRejecting(false))}>Reject</Button>
          <Button variant="transparent" onClick={() => setRejecting(false)}>Cancel</Button></>}>
        {act.error && <MessageStrip type="error">{act.error}</MessageStrip>}
        <TextAreaField label="Reason" required rows={3} value={reason} data-autofocus onChange={(e) => setReason(e.target.value)} hint="The creator is notified. A linked requisition becomes open again." />
      </Dialog>
      <Dialog open={receiving} title={`Goods Receipt for PO ${po.number}`} onClose={() => setReceiving(false)} busy={act.pending}
        footer={<><Button variant="emph" busy={act.pending} disabled={receiptInvalid}
          onClick={() => void runTx(() => post<TxResult>(`/purchase-orders/${po.id}/goods-receipts`, { items: receiptItems.map(({ purchaseOrderItemId, quantity }) => ({ purchaseOrderItemId, quantity })) }, key)).then((r) => r && setReceiving(false))}>Post goods receipt</Button>
          <Button variant="transparent" onClick={() => setReceiving(false)}>Cancel</Button></>}>
        {act.error && <MessageStrip type="error">{act.error}</MessageStrip>}
        <p className="muted">Stock at plant {po.plantCode} increases by the received quantity. Over-delivery is not accepted.</p>
        <table className="dt">
          <thead><tr><th>Material</th><th className="num">Open</th><th style={{ width: 140 }}>Receive now</th></tr></thead>
          <tbody>{po.items.map((i) => {
            const open = i.quantity - i.receivedQty;
            const v = Number(qty[i.id] || 0);
            return (
              <tr key={i.id}><td>{i.materialCode}</td><td className="num">{open}</td>
                <td><input className="input input-sm" type="number" min={0} max={open} aria-label={`Quantity to receive for ${i.materialCode}`} disabled={open === 0}
                  aria-invalid={v > open || !Number.isInteger(v) ? true : undefined} value={qty[i.id] ?? ''} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} /></td></tr>
            );
          })}</tbody>
        </table>
      </Dialog>
    </>
  );
}
