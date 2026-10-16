import { useEffect, useState } from 'react';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { TextField } from '../../components/common/Field';
import { MessageStrip } from '../../components/common/MessageStrip';
import { ErrorState, LoadingState } from '../../components/common/States';
import { PageHeader } from '../../components/layout/PageHeader';
import { useAction, useApi } from '../../hooks/useApi';
import { put } from '../../services/api';
import { formatDateTime } from '../../utils/format';

interface Setting { key: string; value: unknown; description: string; updatedAt: string; updatedByName: string | null }

const META: Record<string, { label: string; kind: 'money' | 'int' | 'bool' | 'percent' }> = {
  po_approval_threshold: { label: 'PO approval threshold (₹ net)', kind: 'money' },
  gst_rate_bp: { label: 'GST rate (%)', kind: 'percent' },
  allow_self_approval: { label: 'Allow approvers to approve their own purchase orders', kind: 'bool' },
  po_stuck_after_hours: { label: 'Report POs as stuck after (hours)', kind: 'int' },
};

function SettingRow({ s, onSaved }: { s: Setting; onSaved: () => void }) {
  const meta = META[s.key] ?? { label: s.key, kind: 'int' as const };
  const toText = () => (meta.kind === 'percent' ? String(Number(s.value) / 100) : String(s.value));
  const [text, setText] = useState(toText);
  const [flag, setFlag] = useState(Boolean(s.value));
  const act = useAction();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setText(toText()); setFlag(Boolean(s.value)); }, [s.value]);
  const parsed = (): unknown => {
    if (meta.kind === 'bool') return flag;
    if (meta.kind === 'money') return text.trim();
    if (meta.kind === 'percent') return Math.round(Number(text) * 100);
    return Number(text);
  };
  const save = async () => { if (await act.run(() => put(`/admin/settings/${s.key}`, { value: parsed() }))) onSaved(); };
  return (
    <Card title={meta.label} subtitle={s.description}>
      {act.error && <MessageStrip type="error">{act.error}</MessageStrip>}
      <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {meta.kind === 'bool'
          ? <label className="checkbox"><input type="checkbox" checked={flag} onChange={(e) => setFlag(e.target.checked)} /> Enabled</label>
          : <TextField label="Value" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} />}
        <Button type="submit" variant="emph" busy={act.pending}>Save</Button>
      </form>
      <p className="muted small" style={{ marginTop: 8 }}>Last changed {formatDateTime(s.updatedAt)}{s.updatedByName ? ` by ${s.updatedByName}` : ''}. Changes are recorded in the security audit log.</p>
    </Card>
  );
}

export function AdminSettingsPage() {
  const { data, error, loading, reload } = useApi<{ items: Setting[] }>('/admin/settings');
  return (
    <>
      <PageHeader title="Configuration" subtitle="Business rules enforced by the server for every user" />
      <div className="page-content">
        {loading && !data && <LoadingState />}
        {error && <ErrorState error={error} onRetry={reload} />}
        <div className="card-grid fixed">{data?.items.map((s) => <SettingRow key={s.key} s={s} onSaved={reload} />)}</div>
      </div>
    </>
  );
}
