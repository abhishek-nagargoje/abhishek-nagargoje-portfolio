import { Play } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { DataTable } from '../../components/common/DataTable';
import { MessageStrip } from '../../components/common/MessageStrip';
import { PlantSelect, usePlants } from '../../components/common/Pickers';
import { Status } from '../../components/common/Status';
import { FilterBar, PageHeader } from '../../components/layout/PageHeader';
import { useAction, useApi } from '../../hooks/useApi';
import { post } from '../../services/api';
import type { TxResult } from '../../types';
import { formatDateTime, formatNumber } from '../../utils/format';

interface Row { materialId: number; materialCode: string; materialDescription: string; demand: number; onHand: number; incoming: number; shortage: number }

export function MrpPage() {
  const { can } = useAuth();
  const plants = usePlants();
  const [plantId, setPlantId] = useState<number | null>(null);
  const [runId, setRunId] = useState(0);
  const pid = plantId ?? plants?.[0]?.id ?? null;
  const run = useApi<{ items: Row[]; runAt: string }>(pid && runId ? `/mrp?plantId=${pid}&run=${runId}` : null);
  const [msg, setMsg] = useState<string | null>(null);
  const act = useAction();
  const convert = async (r: Row) => {
    const res = await act.run(() => post<TxResult>('/mrp/requisitions', { plantId: pid, materialId: r.materialId }, crypto.randomUUID()));
    if (res) { setMsg(res.message); run.reload(); }
  };
  const plantCode = plants?.find((p) => p.id === pid)?.code;
  return (
    <>
      <PageHeader title="Supply Planning (MRP)" subtitle="Net requirements per plant: open sales demand − stock on hand − incoming requisitions and orders"
        actions={<Button variant="emph" icon={<Play size={16} />} disabled={!pid} busy={run.loading} onClick={() => { setMsg(null); setRunId((x) => x + 1); }}>Run MRP</Button>}>
        <FilterBar>
          <PlantSelect label="Plant" value={pid} onChange={(v) => { setPlantId(v); setRunId(0); }} />
        </FilterBar>
      </PageHeader>
      <div className="page-content">
        {msg && <MessageStrip type="success" onClose={() => setMsg(null)}>{msg} <Link to="/procurement?tab=pr">Open requisitions</Link></MessageStrip>}
        {act.error && <MessageStrip type="error" onClose={() => act.setError(null)}>{act.error}</MessageStrip>}
        {!runId && <MessageStrip type="info">Select a plant and choose “Run MRP” to calculate shortages from current sales orders, stock and supply.</MessageStrip>}
        {runId > 0 && (
          <section className="card">
            <header className="card-header"><h2 className="card-title">Planning result {plantCode ? `@ ${plantCode}` : ''}</h2>
              <span className="card-count">{run.data ? `Run at ${formatDateTime(run.data.runAt)}` : ''}</span></header>
            <DataTable caption="MRP result" rows={run.data?.items} loading={run.loading} error={run.error} onRetry={run.reload} rowKey={(r) => r.materialId}
              emptyTitle="No open demand at this plant" emptyText="Create sales orders to generate demand."
              columns={[
                { key: 'm', header: 'Material', render: (r) => <><Link to={`/inventory/materials/${r.materialId}`}>{r.materialCode}</Link><span className="sub">{r.materialDescription}</span></> },
                { key: 'd', header: 'Open demand', align: 'right', render: (r) => formatNumber(r.demand) },
                { key: 's', header: 'On hand', align: 'right', render: (r) => formatNumber(r.onHand) },
                { key: 'i', header: 'Incoming', align: 'right', render: (r) => formatNumber(r.incoming) },
                { key: 'sh', header: 'Shortage', align: 'right', render: (r) => <strong style={{ color: r.shortage ? 'var(--c-negative)' : undefined }}>{formatNumber(r.shortage)}</strong> },
                { key: 'a', header: '', align: 'right', render: (r) => r.shortage > 0
                  ? (can('mrp.run') ? <Button size="sm" busy={act.pending} onClick={() => void convert(r)}>Create PR for {r.shortage}</Button> : <span className="muted small">Planner action</span>)
                  : <Status value="Covered" tone="positive" /> },
              ]} />
          </section>
        )}
      </div>
    </>
  );
}
