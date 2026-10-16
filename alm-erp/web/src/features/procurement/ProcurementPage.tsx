import { Plus, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { DataTable } from '../../components/common/DataTable';
import { Dialog } from '../../components/common/Dialog';
import { SelectField, TextField } from '../../components/common/Field';
import { emptyLine, LineItems, toApiLines, type Line } from '../../components/common/LineItems';
import { MessageStrip } from '../../components/common/MessageStrip';
import { CompanySelect, MaterialPicker, PlantSelect } from '../../components/common/Pickers';
import { Status } from '../../components/common/Status';
import { Tabs } from '../../components/common/Tabs';
import { FilterBar, PageHeader } from '../../components/layout/PageHeader';
import { useAction, useApi, useIdempotencyKey } from '../../hooks/useApi';
import { useListParams } from '../../hooks/useListParams';
import { post, qs } from '../../services/api';
import type { Material, Page, TxResult } from '../../types';
import { formatDateTime, formatINR, formatNumber } from '../../utils/format';

interface PoRow {
  id: number; number: number; status: string; netAmount: string; totalAmount: string; approvalRequired: boolean; createdAt: string;
  plantCode: string; vendorName: string; customerName: string | null; createdByName: string; itemsSummary: string; quantity: number; receivedQty: number;
}
interface PrRow {
  id: number; number: number; quantity: number; status: string; source: string; createdAt: string; plantCode: string; materialId: number;
  materialCode: string; materialDescription: string; customerName: string | null; createdByName: string; purchaseOrderId: number | null; purchaseOrderNumber: number | null;
}
interface GrRow { id: number; number: number; postedAt: string; plantCode: string; purchaseOrderId: number; purchaseOrderNumber: number; vendorName: string; postedByName: string; itemsSummary: string }

const PO_STATUSES = ['Pending Approval', 'Approved', 'Partially Received', 'Received', 'Rejected', 'Cancelled'];

export function ProcurementPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const L = useListParams(['tab', 'status', 'plantId', 'q', 'dialog', 'requisitionId', 'salesOrderId'] as const, { tab: 'po' });
  const tab = L.values.tab;
  const settings = useApi<{ poApprovalThreshold: string; gstRateBp: number }>('/settings/business');
  const listPath = tab === 'po' ? '/purchase-orders' : tab === 'pr' ? '/purchase-requisitions' : '/goods-receipts';
  const list = useApi<Page<PoRow | PrRow | GrRow>>(`${listPath}${qs({ status: tab === 'gr' ? undefined : L.values.status, plantId: L.values.plantId, q: L.values.q, page: L.page, pageSize: 25 })}`);
  const [result, setResult] = useState<string | null>(null);
  const dialog = L.values.dialog;
  const close = () => L.set({ dialog: '', requisitionId: '', salesOrderId: '' });
  const done = (r: TxResult, to?: string) => { close(); setResult(r.message); list.reload(); if (to) navigate(to); };

  return (
    <>
      <PageHeader title="Procurement" subtitle={settings.data ? `Purchase orders above ${formatINR(settings.data.poApprovalThreshold, true)} net need Procurement Head approval · GST ${settings.data.gstRateBp / 100}%` : 'Requisitions, purchase orders and goods receipts'}
        actions={<>
          {can('pr.create') && can('po.create') && <Button icon={<Zap size={16} />} onClick={() => L.set({ dialog: 'quick' })}>Quick PR + PO</Button>}
          {can('pr.create') && <Button icon={<Plus size={16} />} onClick={() => L.set({ dialog: 'pr' })}>Create Requisition</Button>}
          {can('po.create') && <Button variant="emph" icon={<Plus size={16} />} onClick={() => L.set({ dialog: 'po' })}>Create Purchase Order</Button>}
        </>}
        after={<Tabs label="Procurement documents" value={tab} onChange={(t) => L.set({ tab: t, status: '' })}
          tabs={[{ id: 'po', label: 'Purchase Orders' }, { id: 'pr', label: 'Purchase Requisitions' }, { id: 'gr', label: 'Goods Receipts' }]} />}>
        {tab !== 'gr' && (
          <FilterBar>
            <TextField label="Search" placeholder={tab === 'po' ? 'PO number or vendor' : 'PR number or material'} value={L.values.q} onChange={(e) => L.set({ q: e.target.value })} />
            <SelectField label="Status" value={L.values.status} onChange={(e) => L.set({ status: e.target.value })} placeholder="All"
              options={tab === 'po' ? [{ value: 'open', label: 'All open' }, ...PO_STATUSES.map((s) => ({ value: s, label: s }))] : ['Open', 'Ordered', 'Cancelled']} />
            <PlantSelect label="Plant" value={L.values.plantId ? Number(L.values.plantId) : null} onChange={(v) => L.set({ plantId: v ? String(v) : '' })} placeholder="All plants" />
          </FilterBar>
        )}
      </PageHeader>
      <div className="page-content" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {result && <MessageStrip type="success" onClose={() => setResult(null)}>{result}</MessageStrip>}
        <section className="card">
          <header className="card-header"><h2 className="card-title">{tab === 'po' ? 'Purchase orders' : tab === 'pr' ? 'Purchase requisitions' : 'Goods receipts'}</h2>
            <span className="card-count">{list.data ? `${formatNumber(list.data.total)} documents` : ''}</span></header>
          {tab === 'po' && (
            <DataTable<PoRow> caption="Purchase orders" rows={list.data?.items as PoRow[] | undefined} loading={list.loading} error={list.error} onRetry={list.reload}
              rowKey={(r) => r.id} onRowClick={(r) => navigate(`/procurement/purchase-orders/${r.id}`)} emptyTitle="No purchase orders"
              paging={list.data && { page: L.page, pageSize: list.data.pageSize, total: list.data.total, onPage: L.setPage }}
              columns={[
                { key: 'no', header: 'PO', render: (r) => <Link to={`/procurement/purchase-orders/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.number}</Link> },
                { key: 'vendor', header: 'Vendor', render: (r) => <>{r.vendorName}{r.customerName && <span className="sub">for {r.customerName}</span>}</> },
                { key: 'items', header: 'Items', render: (r) => <>{r.itemsSummary}<span className="sub">received {r.receivedQty} of {r.quantity}</span></> },
                { key: 'plant', header: 'Plant', render: (r) => r.plantCode },
                { key: 'net', header: 'Net value', align: 'right', render: (r) => formatINR(r.netAmount) },
                { key: 'created', header: 'Created', render: (r) => <>{formatDateTime(r.createdAt)}<span className="sub">{r.createdByName}</span></> },
                { key: 'status', header: 'Status', render: (r) => <Status value={r.status} /> },
              ]} />
          )}
          {tab === 'pr' && (
            <DataTable<PrRow> caption="Purchase requisitions" rows={list.data?.items as PrRow[] | undefined} loading={list.loading} error={list.error} onRetry={list.reload}
              rowKey={(r) => r.id} emptyTitle="No purchase requisitions"
              paging={list.data && { page: L.page, pageSize: list.data.pageSize, total: list.data.total, onPage: L.setPage }}
              columns={[
                { key: 'no', header: 'PR', render: (r) => r.number },
                { key: 'mat', header: 'Material', render: (r) => <><Link to={`/inventory/materials/${r.materialId}`}>{r.materialCode}</Link><span className="sub">{r.materialDescription}</span></> },
                { key: 'qty', header: 'Quantity', align: 'right', render: (r) => formatNumber(r.quantity) },
                { key: 'plant', header: 'Plant', render: (r) => r.plantCode },
                { key: 'for', header: 'For customer', render: (r) => r.customerName ?? <span className="muted">Stock replenishment</span> },
                { key: 'src', header: 'Source', render: (r) => r.source },
                { key: 'created', header: 'Created', render: (r) => <>{formatDateTime(r.createdAt)}<span className="sub">{r.createdByName}</span></> },
                { key: 'status', header: 'Status', render: (r) => <Status value={r.status} /> },
                { key: 'act', header: '', align: 'right', render: (r) => r.purchaseOrderId
                  ? <Link to={`/procurement/purchase-orders/${r.purchaseOrderId}`}>PO {r.purchaseOrderNumber}</Link>
                  : r.status === 'Open' && can('po.create') ? <Button size="sm" onClick={() => L.set({ dialog: 'po', requisitionId: String(r.id) })}>Create PO</Button> : null },
              ]} />
          )}
          {tab === 'gr' && (
            <DataTable<GrRow> caption="Goods receipts" rows={list.data?.items as GrRow[] | undefined} loading={list.loading} error={list.error} onRetry={list.reload}
              rowKey={(r) => r.id} emptyTitle="No goods receipts yet"
              paging={list.data && { page: L.page, pageSize: list.data.pageSize, total: list.data.total, onPage: L.setPage }}
              columns={[
                { key: 'no', header: 'Goods receipt', render: (r) => r.number },
                { key: 'po', header: 'PO', render: (r) => <Link to={`/procurement/purchase-orders/${r.purchaseOrderId}`}>{r.purchaseOrderNumber}</Link> },
                { key: 'vendor', header: 'Vendor', render: (r) => r.vendorName },
                { key: 'items', header: 'Items', render: (r) => r.itemsSummary },
                { key: 'plant', header: 'Plant', render: (r) => r.plantCode },
                { key: 'posted', header: 'Posted', render: (r) => <>{formatDateTime(r.postedAt)}<span className="sub">{r.postedByName}</span></> },
              ]} />
          )}
        </section>
      </div>
      <RequisitionDialog open={dialog === 'pr'} onClose={close} onDone={(r) => { done(r); L.set({ tab: 'pr', dialog: '' }); }} />
      <PurchaseOrderDialog open={dialog === 'po'} onClose={close} requisitionId={L.values.requisitionId ? Number(L.values.requisitionId) : null}
        salesOrderId={L.values.salesOrderId ? Number(L.values.salesOrderId) : null} onDone={(r) => done(r, `/procurement/purchase-orders/${r.id}`)} />
      <QuickOrderDialog open={dialog === 'quick'} onClose={close} onDone={(r) => done(r)} />
    </>
  );
}

function RequisitionDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (r: TxResult) => void }) {
  const act = useAction();
  const resetError = act.setError;
  const [key, resetKey] = useIdempotencyKey();
  const [plantId, setPlantId] = useState<number | null>(null);
  const [material, setMaterial] = useState<Material | null>(null);
  const [quantity, setQuantity] = useState('');
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setTouched(false); resetError(null); } }, [open, resetError]);
  const qtyOk = /^\d+$/.test(quantity) && Number(quantity) > 0;
  const submit = async () => {
    setTouched(true);
    if (!plantId || !material || !qtyOk) return;
    const r = await act.run(() => post<TxResult>('/purchase-requisitions', { plantId, materialId: material.id, quantity: Number(quantity), customerId }, key));
    if (r) { resetKey(); setMaterial(null); setQuantity(''); onDone(r); }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Create Purchase Requisition" busy={act.pending}
      footer={<><Button variant="emph" busy={act.pending} onClick={() => void submit()}>Create requisition</Button><Button variant="transparent" onClick={onClose}>Cancel</Button></>}>
      {act.error && <MessageStrip type="error">{act.error}</MessageStrip>}
      <div className="form-grid">
        <PlantSelect label="Plant" required value={plantId} onChange={setPlantId} placeholder="— Select plant —" error={touched && !plantId ? 'Select a plant.' : null} />
        <TextField label="Quantity" required type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} error={touched && !qtyOk ? 'Enter a whole quantity greater than 0.' : null} />
        <MaterialPicker label="Material" required value={material} onChange={setMaterial} className="full" error={touched && !material ? 'Select a material.' : null} />
        <CompanySelect type="Customer" label="For customer (optional)" value={customerId} onChange={setCustomerId} placeholder="— Internal / stock replenishment —" className="full" />
      </div>
    </Dialog>
  );
}

function PurchaseOrderDialog({ open, onClose, onDone, requisitionId, salesOrderId }: {
  open: boolean; onClose: () => void; onDone: (r: TxResult) => void; requisitionId: number | null; salesOrderId: number | null;
}) {
  const act = useAction();
  const [key, resetKey] = useIdempotencyKey();
  const openPrs = useApi<Page<PrRow>>(open ? '/purchase-requisitions?status=Open&pageSize=200' : null);
  const openSos = useApi<Page<{ id: number; number: number; customerName: string; itemsSummary: string; plantCode: string }>>(open ? '/sales-orders?status=open&pageSize=200' : null);
  const settings = useApi<{ poApprovalThreshold: string }>(open ? '/settings/business' : null);
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [plantId, setPlantId] = useState<number | null>(null);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [prId, setPrId] = useState<number | null>(null);
  const [soId, setSoId] = useState<number | null>(null);
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [errors, setErrors] = useState<(string | null)[]>([]);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTouched(false); setErrors([]); act.setError(null);
    setPrId(requisitionId); setSoId(salesOrderId); setLines([emptyLine()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requisitionId, salesOrderId]);

  const pr = openPrs.data?.items.find((p) => p.id === prId);
  const submit = async () => {
    setTouched(true);
    if (!vendorId) return;
    let body: Record<string, unknown> = { vendorId, customerId, salesOrderId: soId };
    if (prId) body = { ...body, requisitionId: prId };
    else {
      if (!plantId) return;
      const v = toApiLines(lines);
      setErrors(v.errors);
      if (!v.valid) return;
      body = { ...body, plantId, items: v.items };
    }
    const r = await act.run(() => post<TxResult>('/purchase-orders', body, key));
    if (r) { resetKey(); onDone(r); }
  };

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Create Purchase Order" busy={act.pending}
      footer={<><Button variant="emph" busy={act.pending} onClick={() => void submit()}>Create purchase order</Button><Button variant="transparent" onClick={onClose}>Cancel</Button></>}>
      {act.error && <MessageStrip type="error">{act.error}</MessageStrip>}
      {settings.data && <MessageStrip type="info">Orders above {formatINR(settings.data.poApprovalThreshold, true)} net are created as “Pending Approval” and routed to the Procurement Head.</MessageStrip>}
      <div className="form-grid">
        <CompanySelect type="Vendor" label="Vendor" required value={vendorId} onChange={setVendorId} error={touched && !vendorId ? 'Select a vendor.' : null} />
        <SelectField label="From purchase requisition" value={prId ?? ''} placeholder="— None —" onChange={(e) => setPrId(e.target.value ? Number(e.target.value) : null)}
          options={(openPrs.data?.items ?? []).map((p) => ({ value: p.id, label: `PR ${p.number} · ${p.plantCode} · ${p.quantity} × ${p.materialCode}` }))} />
        <SelectField label="For sales order" value={soId ?? ''} placeholder="— None —" onChange={(e) => setSoId(e.target.value ? Number(e.target.value) : null)}
          options={(openSos.data?.items ?? []).map((s) => ({ value: s.id, label: `SO ${s.number} · ${s.plantCode} · ${s.customerName} · ${s.itemsSummary}` }))} />
        <CompanySelect type="Customer" label="On behalf of customer" value={customerId} onChange={setCustomerId} placeholder="— None —" />
        {!prId && <PlantSelect label="Plant" required value={plantId} onChange={setPlantId} placeholder="— Select plant —" error={touched && !plantId ? 'Select a plant.' : null} />}
      </div>
      <h3 className="card-title" style={{ margin: '16px 0 8px' }}>Items</h3>
      {pr ? <p>The order takes over the requisition: <strong>{pr.quantity} × {pr.materialCode}</strong> ({pr.materialDescription}) at plant {pr.plantCode}, priced at standard cost.</p>
        : <LineItems lines={lines} onChange={setLines} priceField="costPrice" priceHint="Blank = standard cost" errors={errors} />}
    </Dialog>
  );
}

function QuickOrderDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (r: TxResult) => void }) {
  const act = useAction();
  const resetError = act.setError;
  const [key, resetKey] = useIdempotencyKey();
  const [f, setF] = useState({ customerId: null as number | null, vendorId: null as number | null, plantId: null as number | null, quantity: '' });
  const [material, setMaterial] = useState<Material | null>(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setTouched(false); resetError(null); } }, [open, resetError]);
  const qtyOk = /^\d+$/.test(f.quantity) && Number(f.quantity) > 0;
  const submit = async () => {
    setTouched(true);
    if (!f.customerId || !f.vendorId || !f.plantId || !material || !qtyOk) return;
    const r = await act.run(() => post<TxResult>('/procurement/quick-order', { ...f, materialId: material.id, quantity: Number(f.quantity) }, key));
    if (r) { resetKey(); onDone(r); }
  };
  const req = (v: unknown, m: string) => (touched && !v ? m : null);
  return (
    <Dialog open={open} onClose={onClose} title="Quick: Requisition and Purchase Order for a customer" busy={act.pending}
      footer={<><Button variant="emph" busy={act.pending} onClick={() => void submit()}>Create PR and PO</Button><Button variant="transparent" onClick={onClose}>Cancel</Button></>}>
      {act.error && <MessageStrip type="error">{act.error}</MessageStrip>}
      <p className="muted">Creates the requisition and the purchase order in one transaction. The approval rule applies to the order.</p>
      <div className="form-grid">
        <CompanySelect type="Customer" label="Customer" required value={f.customerId} onChange={(v) => setF({ ...f, customerId: v })} error={req(f.customerId, 'Select a customer.')} />
        <CompanySelect type="Vendor" label="Vendor" required value={f.vendorId} onChange={(v) => setF({ ...f, vendorId: v })} error={req(f.vendorId, 'Select a vendor.')} />
        <PlantSelect label="Plant" required value={f.plantId} onChange={(v) => setF({ ...f, plantId: v })} placeholder="— Select plant —" error={req(f.plantId, 'Select a plant.')} />
        <TextField label="Quantity" required type="number" min={1} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} error={touched && !qtyOk ? 'Enter a whole quantity greater than 0.' : null} />
        <MaterialPicker label="Material" required value={material} onChange={setMaterial} className="full" error={req(material, 'Select a material.')} />
      </div>
    </Dialog>
  );
}
