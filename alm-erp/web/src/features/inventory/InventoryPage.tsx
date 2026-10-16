import { ArrowLeftRight, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { BarList, Donut } from '../../components/charts/Charts';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { DataTable } from '../../components/common/DataTable';
import { Dialog } from '../../components/common/Dialog';
import { SelectField, TextAreaField, TextField } from '../../components/common/Field';
import { MessageStrip } from '../../components/common/MessageStrip';
import { MaterialPicker, PlantSelect, usePlants } from '../../components/common/Pickers';
import { Tabs } from '../../components/common/Tabs';
import { FilterBar, PageHeader } from '../../components/layout/PageHeader';
import { useAction, useApi, useDebounced, useIdempotencyKey } from '../../hooks/useApi';
import { useListParams } from '../../hooks/useListParams';
import { post, qs } from '../../services/api';
import type { Material, Page, TxResult } from '../../types';
import { formatDateTime, formatINR, formatINRCompact, formatNumber } from '../../utils/format';

interface StockRow { id: number; code: string; description: string; category: string; costPrice: string; listPrice: string; byPlant: Record<string, number>; total: number; onHand: number; incoming: number; demand: number; atp: number }
interface Movement { id: number; quantity: number; movementType: string; referenceNumber: string | null; reason: string; createdAt: string; materialId: number; materialCode: string; plantCode: string; createdByName: string | null }

const MOVE_LABEL: Record<string, string> = {
  INITIAL: 'Opening stock', GOODS_RECEIPT: 'Goods receipt', GOODS_ISSUE: 'Goods issue', TRANSFER_OUT: 'Transfer out', TRANSFER_IN: 'Transfer in', ADJUSTMENT: 'Adjustment',
};

export function InventoryPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const plants = usePlants();
  const L = useListParams(['tab', 'q', 'category', 'plantId', 'type'] as const, { tab: 'stock' });
  const [q, setQ] = useState(L.values.q);
  const dq = useDebounced(q, 300);
  const plantId = L.values.plantId || (plants?.[0] ? String(plants[0].id) : '');
  const plant = plants?.find((p) => String(p.id) === plantId);
  const categories = useApi<{ items: string[] }>('/materials/categories');
  const summary = useApi<{ byCategory: { category: string; units: number; value: string }[]; byPlant: { code: string; name: string; units: number; value: string }[] }>('/inventory/summary');
  const stock = useApi<Page<StockRow>>(L.values.tab === 'stock' && plantId ? `/inventory/stock${qs({ q: dq, category: L.values.category, plantId, page: L.page, pageSize: 25 })}` : null);
  const moves = useApi<Page<Movement>>(L.values.tab === 'movements' ? `/inventory/movements${qs({ plantId: L.values.plantId, type: L.values.type, page: L.page, pageSize: 25 })}` : null);
  const [dialog, setDialog] = useState<'transfer' | 'adjust' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const done = (r: TxResult) => { setDialog(null); setMsg(r.message); stock.reload(); moves.reload(); summary.reload(); };

  return (
    <>
      <PageHeader title="Inventory" subtitle="Stock by plant, availability to promise and movement history"
        actions={<>
          {can('inventory.adjust') && <Button icon={<SlidersHorizontal size={16} />} onClick={() => setDialog('adjust')}>Stock Adjustment</Button>}
          {can('inventory.transfer') && <Button variant="emph" icon={<ArrowLeftRight size={16} />} onClick={() => setDialog('transfer')}>Stock Transfer</Button>}
        </>}
        after={<Tabs label="Inventory views" value={L.values.tab} onChange={(t) => L.set({ tab: t })} tabs={[{ id: 'stock', label: 'Stock Overview' }, { id: 'movements', label: 'Stock Movements' }]} />}>
        <FilterBar>
          {L.values.tab === 'stock' && <>
            <TextField label="Search" className="wide" placeholder="Material code or description" value={q} onChange={(e) => { setQ(e.target.value); L.set({ q: e.target.value }); }} />
            <SelectField label="Category" value={L.values.category} onChange={(e) => L.set({ category: e.target.value })} options={categories.data?.items ?? []} placeholder="All categories" />
            <PlantSelect label="Working plant (ATP)" value={plantId ? Number(plantId) : null} onChange={(v) => L.set({ plantId: v ? String(v) : '' })} />
          </>}
          {L.values.tab === 'movements' && <>
            <PlantSelect label="Plant" value={L.values.plantId ? Number(L.values.plantId) : null} onChange={(v) => L.set({ plantId: v ? String(v) : '' })} placeholder="All plants" />
            <SelectField label="Movement type" value={L.values.type} onChange={(e) => L.set({ type: e.target.value })} placeholder="All"
              options={Object.entries(MOVE_LABEL).map(([value, label]) => ({ value, label }))} />
          </>}
        </FilterBar>
      </PageHeader>
      <div className="page-content">
        {msg && <MessageStrip type="success" onClose={() => setMsg(null)}>{msg}</MessageStrip>}
        {L.values.tab === 'stock' && (
          <div className="stack">
            <div className="card-grid fixed">
              <Card title="Stock by Category" subtitle="Units, all plants">
                {summary.data && <Donut title="Units by category" data={summary.data.byCategory.map((c) => ({ label: c.category, value: c.units }))} />}
              </Card>
              <Card title="Stock Value by Plant" subtitle="At standard cost">
                {summary.data && <BarList title="Stock value by plant" format={(n) => formatINRCompact(n)} data={summary.data.byPlant.map((p) => ({ label: `${p.code} ${p.name}`, value: Number(p.value), color: 'var(--chart-1)' }))} />}
              </Card>
              <Card title="Plants" bodyClass="flush">
                {summary.data?.byPlant.map((p) => (
                  <button key={p.code} className={`list-row clickable ${plant?.code === p.code ? 'indicator' : ''}`} style={{ width: '100%', border: 0, background: plant?.code === p.code ? 'var(--c-selected)' : 'none', textAlign: 'left', borderLeftColor: 'var(--c-brand)' }}
                    aria-pressed={plant?.code === p.code} onClick={() => L.set({ plantId: String(plants?.find((x) => x.code === p.code)?.id ?? '') })}>
                    <span>{p.code} · {p.name}</span><span className="value small">{formatNumber(p.units)} units</span>
                  </button>
                ))}
              </Card>
            </div>
            <section className="card">
              <header className="card-header"><h2 className="card-title">Stock overview</h2><span className="card-subtitle">ATP at {plant?.code ?? '…'} = on hand + incoming − open demand</span><span className="card-count">{stock.data ? `${formatNumber(stock.data.total)} materials` : ''}</span></header>
              <DataTable caption="Stock by material and plant" rows={stock.data?.items} loading={stock.loading} error={stock.error} onRetry={stock.reload}
                rowKey={(r) => r.id} onRowClick={(r) => navigate(`/inventory/materials/${r.id}`)} emptyTitle="No materials match"
                paging={stock.data && { page: L.page, pageSize: stock.data.pageSize, total: stock.data.total, onPage: L.setPage }}
                columns={[
                  { key: 'code', header: 'Material', render: (r) => <><Link to={`/inventory/materials/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.code}</Link><span className="sub">{r.description}</span></> },
                  ...(plants ?? []).map((p) => ({ key: p.code, header: p.code, align: 'right' as const, render: (r: StockRow) => <span style={{ fontWeight: p.code === plant?.code ? 600 : undefined }}>{formatNumber(r.byPlant[p.code] ?? 0)}</span> })),
                  { key: 'total', header: 'Total', align: 'right', render: (r) => <strong>{formatNumber(r.total)}</strong> },
                  { key: 'inc', header: `Incoming @${plant?.code ?? ''}`, align: 'right', render: (r) => formatNumber(r.incoming) },
                  { key: 'dem', header: `Demand @${plant?.code ?? ''}`, align: 'right', render: (r) => formatNumber(r.demand) },
                  { key: 'atp', header: `ATP @${plant?.code ?? ''}`, align: 'right', render: (r) => <strong style={{ color: r.atp < 0 ? 'var(--c-negative)' : 'var(--c-positive)' }}>{formatNumber(r.atp)}</strong> },
                  { key: 'price', header: 'List price', align: 'right', render: (r) => formatINR(r.listPrice) },
                ]} />
            </section>
          </div>
        )}
        {L.values.tab === 'movements' && (
          <section className="card">
            <header className="card-header"><h2 className="card-title">Stock movements</h2><span className="card-count">{moves.data ? `${formatNumber(moves.data.total)} postings` : ''}</span></header>
            <DataTable caption="Stock movements" rows={moves.data?.items} loading={moves.loading} error={moves.error} onRetry={moves.reload} rowKey={(m) => m.id}
              paging={moves.data && { page: L.page, pageSize: moves.data.pageSize, total: moves.data.total, onPage: L.setPage }} emptyTitle="No movements"
              columns={[
                { key: 'when', header: 'Posted', render: (m) => formatDateTime(m.createdAt) },
                { key: 'mat', header: 'Material', render: (m) => <Link to={`/inventory/materials/${m.materialId}`}>{m.materialCode}</Link> },
                { key: 'plant', header: 'Plant', render: (m) => m.plantCode },
                { key: 'type', header: 'Type', render: (m) => MOVE_LABEL[m.movementType] },
                { key: 'qty', header: 'Quantity', align: 'right', render: (m) => <span style={{ color: m.quantity < 0 ? 'var(--c-negative)' : 'var(--c-positive)' }}>{m.quantity > 0 ? '+' : ''}{formatNumber(m.quantity)}</span> },
                { key: 'ref', header: 'Reference', render: (m) => <>{m.referenceNumber ?? '—'}<span className="sub">{m.reason}</span></> },
                { key: 'by', header: 'Posted by', render: (m) => m.createdByName ?? 'System' },
              ]} />
          </section>
        )}
      </div>
      <TransferDialog open={dialog === 'transfer'} onClose={() => setDialog(null)} onDone={done} />
      <AdjustDialog open={dialog === 'adjust'} onClose={() => setDialog(null)} onDone={done} />
    </>
  );
}

function TransferDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (r: TxResult) => void }) {
  const act = useAction();
  const resetError = act.setError;
  const [key, resetKey] = useIdempotencyKey();
  const [material, setMaterial] = useState<Material | null>(null);
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);
  const avail = useApi<{ onHand: number }>(open && material && from ? `/inventory/availability?plantId=${from}&materialId=${material.id}` : null);
  useEffect(() => { if (open) { setTouched(false); resetError(null); } }, [open, resetError]);
  const qtyOk = /^\d+$/.test(quantity) && Number(quantity) > 0;
  const same = from !== null && from === to;
  const submit = async () => {
    setTouched(true);
    if (!material || !from || !to || same || !qtyOk) return;
    const r = await act.run(() => post<TxResult>('/inventory/transfers', { materialId: material.id, fromPlantId: from, toPlantId: to, quantity: Number(quantity), notes }, key));
    if (r) { resetKey(); setQuantity(''); onDone(r); }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Stock Transfer between Plants" busy={act.pending}
      footer={<><Button variant="emph" busy={act.pending} onClick={() => void submit()}>Post transfer</Button><Button variant="transparent" onClick={onClose}>Cancel</Button></>}>
      {act.error && <MessageStrip type="error">{act.error}</MessageStrip>}
      <div className="form-grid">
        <MaterialPicker label="Material" required className="full" value={material} onChange={setMaterial} error={touched && !material ? 'Select a material.' : null} />
        <PlantSelect label="From plant" required value={from} onChange={setFrom} placeholder="— Select —" error={touched && !from ? 'Select the source plant.' : null} />
        <PlantSelect label="To plant" required value={to} onChange={setTo} placeholder="— Select —" error={touched && !to ? 'Select the target plant.' : same ? 'Source and target must differ.' : null} />
        <TextField label="Quantity" required type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)}
          hint={avail.data ? `${formatNumber(avail.data.onHand)} on hand at the source plant` : undefined}
          error={touched && !qtyOk ? 'Enter a whole quantity greater than 0.' : avail.data && qtyOk && Number(quantity) > avail.data.onHand ? `Only ${avail.data.onHand} available.` : null} />
        <TextAreaField label="Notes" className="full" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Dialog>
  );
}

function AdjustDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (r: TxResult) => void }) {
  const act = useAction();
  const resetError = act.setError;
  const [key, resetKey] = useIdempotencyKey();
  const [material, setMaterial] = useState<Material | null>(null);
  const [plantId, setPlantId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const avail = useApi<{ onHand: number }>(open && material && plantId ? `/inventory/availability?plantId=${plantId}&materialId=${material.id}` : null);
  useEffect(() => { if (open) { setTouched(false); resetError(null); } }, [open, resetError]);
  const qtyOk = /^-?\d+$/.test(quantity) && Number(quantity) !== 0;
  const submit = async () => {
    setTouched(true);
    if (!material || !plantId || !qtyOk || reason.trim().length < 3) return;
    const r = await act.run(() => post<TxResult>('/inventory/adjustments', { materialId: material.id, plantId, quantity: Number(quantity), reason: reason.trim() }, key));
    if (r) { resetKey(); setQuantity(''); setReason(''); onDone(r); }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Stock Adjustment" busy={act.pending}
      footer={<><Button variant="emph" busy={act.pending} onClick={() => void submit()}>Post adjustment</Button><Button variant="transparent" onClick={onClose}>Cancel</Button></>}>
      {act.error && <MessageStrip type="error">{act.error}</MessageStrip>}
      <p className="muted">Use for physical inventory differences, damage or found stock. Every adjustment is recorded with your name and reason.</p>
      <div className="form-grid">
        <MaterialPicker label="Material" required className="full" value={material} onChange={setMaterial} error={touched && !material ? 'Select a material.' : null} />
        <PlantSelect label="Plant" required value={plantId} onChange={setPlantId} placeholder="— Select —" error={touched && !plantId ? 'Select a plant.' : null} />
        <TextField label="Quantity change" required type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)}
          hint={avail.data ? `${formatNumber(avail.data.onHand)} on hand. Use a negative number to reduce stock.` : 'Use a negative number to reduce stock.'}
          error={touched && !qtyOk ? 'Enter a non-zero whole number.' : null} />
        <TextAreaField label="Reason" required className="full" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
          error={touched && reason.trim().length < 3 ? 'A reason is required.' : null} />
      </div>
    </Dialog>
  );
}
