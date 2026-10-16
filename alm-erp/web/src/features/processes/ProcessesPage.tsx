import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { Status } from '../../components/common/Status';
import { ErrorState, LoadingState } from '../../components/common/States';
import { PageHeader } from '../../components/layout/PageHeader';
import { useApi } from '../../hooks/useApi';
import { formatNumber } from '../../utils/format';
import { RequirementDialog } from '../requirements/RequirementDialog';

interface Step { id: number; seq: number; name: string; recordType: string | null; tracked: boolean; recordCount: number | null }
interface Process { id: number; code: string; name: string; description: string; steps: Step[]; requirements: { id: number; code: string; title: string; status: string }[] }

/** Where each step's records live. */
const STEP_LINK: Record<string, string> = {
  requirement: '/requirements', PR: '/procurement?tab=pr', PO: '/procurement?tab=po', GR: '/procurement?tab=gr', SO: '/sales',
  DL: '/sales?tab=deliveries', GI: '/sales?tab=deliveries&status=Goods%20Issued', INV: '/sales?tab=invoices', MRP: '/mrp',
};

export function ProcessesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi<{ items: Process[] }>('/processes');
  const [newFor, setNewFor] = useState<number | null>(null);
  return (
    <>
      <PageHeader title="Business Processes" subtitle="End-to-end processes, the records that evidence each step, and the requirements that change them" />
      <div className="page-content">
        {loading && !data && <LoadingState />}
        {error && <ErrorState error={error} onRetry={reload} />}
        <div className="stack">
          {data?.items.map((p) => (
            <Card key={p.id} title={p.name} subtitle={p.description}
              actions={can('req.create') && <Button size="sm" icon={<Plus size={14} />} onClick={() => setNewFor(p.id)}>Requirement</Button>}>
              <div className="process-flow" role="list" aria-label={`${p.name} steps`}>
                {p.steps.map((s) => {
                  const inner = (
                    <>
                      <span>{s.name}</span>
                      <span className="step-count">{s.tracked ? formatNumber(s.recordCount) : 'Not tracked in this system'}</span>
                    </>
                  );
                  const cls = `process-step ${!s.tracked ? 'untracked' : s.recordCount ? 'has-records' : ''}`;
                  return s.tracked && s.recordType
                    ? <Link role="listitem" key={s.id} to={STEP_LINK[s.recordType]} className={cls} aria-label={`${s.name}: ${s.recordCount} records`}>{inner}</Link>
                    : <span role="listitem" key={s.id} className={cls}>{inner}</span>;
                })}
              </div>
              <p className="muted small" style={{ marginTop: 8 }}>Counts are the number of stored records for each step across all plants. Steps marked “not tracked” have no integration in this system.</p>
              <h3 className="attr-label" style={{ marginTop: 12 }}>Requirements</h3>
              {p.requirements.length === 0 ? <p className="muted">No requirements yet.</p> : (
                <div className="row">{p.requirements.map((r) => (
                  <Link key={r.id} to={`/requirements/${r.id}`} className="tag" style={{ height: 24 }}>{r.code} · {r.title} · <Status value={r.status} /></Link>
                ))}</div>
              )}
            </Card>
          ))}
        </div>
      </div>
      <RequirementDialog open={newFor !== null} processId={newFor ?? undefined} onClose={() => setNewFor(null)} onSaved={(id) => navigate(`/requirements/${id}`)} />
    </>
  );
}
