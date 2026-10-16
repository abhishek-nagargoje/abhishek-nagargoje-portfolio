import { useParams } from 'react-router-dom';
import { BarList } from '../../components/charts/Charts';
import { Card } from '../../components/common/Card';
import { DataTable } from '../../components/common/DataTable';
import { SampleFlag } from '../../components/common/Status';
import { ErrorState, LoadingState } from '../../components/common/States';
import { PageHeader } from '../../components/layout/PageHeader';
import { useApi } from '../../hooks/useApi';
import { formatDateTime, formatINR, formatNumber } from '../../utils/format';

interface MaterialDetail {
  id: number; code: string; description: string; category: string; uom: string; costPrice: string; listPrice: string; isSample: boolean;
  plants: { plantId: number; plantCode: string; plantName: string; onHand: number; incoming: number; demand: number; atp: number }[];
  movements: { id: number; quantity: number; movementType: string; referenceNumber: string | null; reason: string; createdAt: string; plantCode: string; createdByName: string | null }[];
}

export function MaterialDetailPage() {
  const { id } = useParams();
  const { data: m, error, loading, reload } = useApi<MaterialDetail>(`/materials/${id}`);
  if (loading && !m) return <LoadingState />;
  if (error && !m) return <div className="page-content"><ErrorState error={error} onRetry={reload} /></div>;
  if (!m) return null;
  return (
    <>
      <PageHeader crumbs={[{ to: '/inventory', label: 'Inventory' }]} docTitle={m.code} title={<>{m.code} · {m.description} <SampleFlag show={m.isSample} /></>}>
        <dl className="object-attrs">
          <div><dt>Category</dt><dd>{m.category}</dd></div>
          <div><dt>Unit</dt><dd>{m.uom}</dd></div>
          <div><dt>Standard cost</dt><dd>{formatINR(m.costPrice)}</dd></div>
          <div><dt>List price</dt><dd>{formatINR(m.listPrice)}</dd></div>
          <div><dt>Total stock</dt><dd>{formatNumber(m.plants.reduce((s, p) => s + p.onHand, 0))}</dd></div>
        </dl>
      </PageHeader>
      <div className="page-content">
        <div className="card-grid">
          <section className="card span-2">
            <header className="card-header"><h2 className="card-title">Availability by plant</h2></header>
            <DataTable caption="Availability by plant" rows={m.plants} rowKey={(p) => p.plantId} columns={[
              { key: 'p', header: 'Plant', render: (p) => `${p.plantCode} – ${p.plantName}` },
              { key: 'oh', header: 'On hand', align: 'right', render: (p) => formatNumber(p.onHand) },
              { key: 'in', header: 'Incoming (PR/PO)', align: 'right', render: (p) => formatNumber(p.incoming) },
              { key: 'de', header: 'Open demand (SO)', align: 'right', render: (p) => formatNumber(p.demand) },
              { key: 'atp', header: 'ATP', align: 'right', render: (p) => <strong style={{ color: p.atp < 0 ? 'var(--c-negative)' : 'var(--c-positive)' }}>{formatNumber(p.atp)}</strong> },
            ]} />
          </section>
          <Card title="On hand by plant">
            <BarList title="On hand by plant" data={m.plants.map((p) => ({ label: p.plantCode, value: p.onHand, color: 'var(--chart-1)' }))} />
          </Card>
          <section className="card span-all">
            <header className="card-header"><h2 className="card-title">Recent movements</h2></header>
            <DataTable caption="Recent movements" rows={m.movements} rowKey={(x) => x.id} emptyTitle="No movements" columns={[
              { key: 'when', header: 'Posted', render: (x) => formatDateTime(x.createdAt) },
              { key: 'plant', header: 'Plant', render: (x) => x.plantCode },
              { key: 'qty', header: 'Quantity', align: 'right', render: (x) => <span style={{ color: x.quantity < 0 ? 'var(--c-negative)' : 'var(--c-positive)' }}>{x.quantity > 0 ? '+' : ''}{x.quantity}</span> },
              { key: 'ref', header: 'Reference', render: (x) => <>{x.referenceNumber ?? '—'}<span className="sub">{x.reason}</span></> },
              { key: 'by', header: 'By', render: (x) => x.createdByName ?? 'System' },
            ]} />
          </section>
        </div>
      </div>
    </>
  );
}
