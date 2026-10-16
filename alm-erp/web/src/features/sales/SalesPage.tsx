import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { DataTable } from '../../components/common/DataTable';
import { Dialog } from '../../components/common/Dialog';
import { SelectField, TextField } from '../../components/common/Field';
import { emptyLine, LineItems, toApiLines, type Line } from '../../components/common/LineItems';
import { MessageStrip } from '../../components/common/MessageStrip';
import { CompanySelect, PlantSelect } from '../../components/common/Pickers';
import { Status } from '../../components/common/Status';
import { Tabs } from '../../components/common/Tabs';
import { FilterBar, PageHeader } from '../../components/layout/PageHeader';
import { useAction, useApi, useIdempotencyKey } from '../../hooks/useApi';
import { useListParams } from '../../hooks/useListParams';
import { post, qs } from '../../services/api';
import type { Page, TxResult } from '../../types';
import { formatDate, formatDateTime, formatINR, formatNumber } from '../../utils/format';

interface SoRow { id: number; number: number; status: string; netAmount: string; totalAmount: string; requestedDeliveryDate: string | null; createdAt: string; plantCode: string; customerName: string; createdByName: string; itemsSummary: string; quantity: number; deliveredQty: number }
interface DlRow { id: number; number: number; status: string; createdAt: string; plantCode: string; salesOrderId: number; salesOrderNumber: number; customerName: string; invoiceId: number | null; invoiceNumber: number | null; itemsSummary: string }
interface InvRow { id: number; number: number; status: string; netAmount: string; taxAmount: string; totalAmount: string; createdAt: string; customerName: string; deliveryId: number; deliveryNumber: number; salesOrderNumber: number }

export function SalesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const L = useListParams(['tab', 'status', 'plantId', 'q', 'new'] as const, { tab: 'orders' });
  const tab = L.values.tab;
  const path = tab === 'orders' ? '/sales-orders' : tab === 'deliveries' ? '/deliveries' : '/invoices';
  const list = useApi<Page<SoRow | DlRow | InvRow>>(`${path}${qs({ status: tab === 'invoices' ? undefined : L.values.status, plantId: tab === 'invoices' ? undefined : L.values.plantId, q: tab === 'orders' ? L.values.q : undefined, page: L.page, pageSize: 25 })}`);
  const statuses = tab === 'orders' ? [{ value: 'open', label: 'All open' }, ...['Open', 'Partially Delivered', 'Delivered', 'Cancelled'].map((s) => ({ value: s, label: s }))]
    : [{ value: 'open', label: 'Not billed' }, ...['Created', 'Picked', 'Goods Issued', 'Billed'].map((s) => ({ value: s, label: s }))];
  return (
    <>
      <PageHeader title="Sales & Delivery" subtitle="Sales order → delivery → pick & pack → goods issue → billing"
        actions={can('so.create') && <Button variant="emph" icon={<Plus size={16} />} onClick={() => L.set({ new: '1' })}>Create Sales Order</Button>}
        after={<Tabs label="Sales documents" value={tab} onChange={(t) => L.set({ tab: t, status: '' })} tabs={[{ id: 'orders', label: 'Sales Orders' }, { id: 'deliveries', label: 'Deliveries' }, { id: 'invoices', label: 'Invoices' }]} />}>
        {tab !== 'invoices' && (
          <FilterBar>
            {tab === 'orders' && <TextField label="Search" placeholder="Order number or customer" value={L.values.q} onChange={(e) => L.set({ q: e.target.value })} />}
            <SelectField label="Status" value={L.values.status} onChange={(e) => L.set({ status: e.target.value })} placeholder="All" options={statuses} />
            <PlantSelect label="Plant" value={L.values.plantId ? Number(L.values.plantId) : null} onChange={(v) => L.set({ plantId: v ? String(v) : '' })} placeholder="All plants" />
          </FilterBar>
        )}
      </PageHeader>
      <div className="page-content" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        <section className="card">
          <header className="card-header"><h2 className="card-title">{tab === 'orders' ? 'Sales orders' : tab === 'deliveries' ? 'Outbound deliveries' : 'Invoices'}</h2>
            <span className="card-count">{list.data ? `${formatNumber(list.data.total)} documents` : ''}</span></header>
          {tab === 'orders' && (
            <DataTable<SoRow> caption="Sales orders" rows={list.data?.items as SoRow[] | undefined} loading={list.loading} error={list.error} onRetry={list.reload} rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/sales/orders/${r.id}`)} emptyTitle="No sales orders" paging={list.data && { page: L.page, pageSize: list.data.pageSize, total: list.data.total, onPage: L.setPage }}
              columns={[
                { key: 'no', header: 'Order', render: (r) => <Link to={`/sales/orders/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.number}</Link> },
                { key: 'cust', header: 'Customer', render: (r) => r.customerName },
                { key: 'items', header: 'Items', render: (r) => <>{r.itemsSummary}<span className="sub">delivered {r.deliveredQty} of {r.quantity}</span></> },
                { key: 'plant', header: 'Plant', render: (r) => r.plantCode },
                { key: 'net', header: 'Net value', align: 'right', render: (r) => formatINR(r.netAmount) },
                { key: 'req', header: 'Requested', render: (r) => formatDate(r.requestedDeliveryDate) },
                { key: 'status', header: 'Status', render: (r) => <Status value={r.status} /> },
              ]} />
          )}
          {tab === 'deliveries' && (
            <DataTable<DlRow> caption="Deliveries" rows={list.data?.items as DlRow[] | undefined} loading={list.loading} error={list.error} onRetry={list.reload} rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/sales/deliveries/${r.id}`)} emptyTitle="No deliveries" paging={list.data && { page: L.page, pageSize: list.data.pageSize, total: list.data.total, onPage: L.setPage }}
              columns={[
                { key: 'no', header: 'Delivery', render: (r) => <Link to={`/sales/deliveries/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.number}</Link> },
                { key: 'so', header: 'Sales order', render: (r) => r.salesOrderNumber },
                { key: 'cust', header: 'Customer', render: (r) => r.customerName },
                { key: 'items', header: 'Items', render: (r) => r.itemsSummary },
                { key: 'plant', header: 'Plant', render: (r) => r.plantCode },
                { key: 'inv', header: 'Invoice', render: (r) => r.invoiceId ? <Link to={`/sales/invoices/${r.invoiceId}`} onClick={(e) => e.stopPropagation()}>{r.invoiceNumber}</Link> : '—' },
                { key: 'status', header: 'Status', render: (r) => <Status value={r.status} /> },
              ]} />
          )}
          {tab === 'invoices' && (
            <DataTable<InvRow> caption="Invoices" rows={list.data?.items as InvRow[] | undefined} loading={list.loading} error={list.error} onRetry={list.reload} rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/sales/invoices/${r.id}`)} emptyTitle="No invoices" paging={list.data && { page: L.page, pageSize: list.data.pageSize, total: list.data.total, onPage: L.setPage }}
              columns={[
                { key: 'no', header: 'Invoice', render: (r) => <Link to={`/sales/invoices/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.number}</Link> },
                { key: 'cust', header: 'Customer', render: (r) => r.customerName },
                { key: 'ref', header: 'Delivery / order', render: (r) => `${r.deliveryNumber} / ${r.salesOrderNumber}` },
                { key: 'net', header: 'Net', align: 'right', render: (r) => formatINR(r.netAmount) },
                { key: 'tax', header: 'GST', align: 'right', render: (r) => formatINR(r.taxAmount) },
                { key: 'tot', header: 'Total', align: 'right', render: (r) => <strong>{formatINR(r.totalAmount)}</strong> },
                { key: 'date', header: 'Posted', render: (r) => formatDateTime(r.createdAt) },
              ]} />
          )}
        </section>
      </div>
      <SalesOrderDialog open={L.values.new === '1'} onClose={() => L.set({ new: '' })} onDone={(r) => navigate(`/sales/orders/${r.id}`, { state: { message: r.message } })} />
    </>
  );
}

function SalesOrderDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (r: TxResult) => void }) {
  const act = useAction();
  const [key, resetKey] = useIdempotencyKey();
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [plantId, setPlantId] = useState<number | null>(null);
  const [date, setDate] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [errors, setErrors] = useState<(string | null)[]>([]);
  const [touched, setTouched] = useState(false);
  const resetError = act.setError;
  useEffect(() => { if (open) { setTouched(false); setErrors([]); resetError(null); setLines([emptyLine()]); } }, [open, resetError]);
  const submit = async () => {
    setTouched(true);
    const v = toApiLines(lines);
    setErrors(v.errors);
    if (!customerId || !plantId || !v.valid) return;
    const r = await act.run(() => post<TxResult>('/sales-orders', { customerId, plantId, requestedDeliveryDate: date || null, items: v.items }, key));
    if (r) { resetKey(); onDone(r); }
  };
  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Create Sales Order" busy={act.pending}
      footer={<><Button variant="emph" busy={act.pending} onClick={() => void submit()}>Create sales order</Button><Button variant="transparent" onClick={onClose}>Cancel</Button></>}>
      {act.error && <MessageStrip type="error">{act.error}</MessageStrip>}
      <div className="form-grid">
        <CompanySelect type="Customer" label="Customer" required value={customerId} onChange={setCustomerId} error={touched && !customerId ? 'Select a customer.' : null} />
        <PlantSelect label="Delivering plant" required value={plantId} onChange={setPlantId} placeholder="— Select plant —" error={touched && !plantId ? 'Select a plant.' : null} />
        <TextField label="Requested delivery date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <h3 className="card-title" style={{ margin: '16px 0 8px' }}>Items</h3>
      <LineItems lines={lines} onChange={setLines} priceField="listPrice" priceHint="Blank = list price" errors={errors} />
      <p className="muted small" style={{ marginTop: 8 }}>Stock is checked at goods issue. If the order is not covered by stock and incoming supply, you will be told the shortage so it can be planned.</p>
    </Dialog>
  );
}
