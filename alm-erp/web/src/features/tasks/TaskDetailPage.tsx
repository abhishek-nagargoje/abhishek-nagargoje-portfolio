import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { Comments, History } from '../../components/common/Comments';
import { MessageStrip } from '../../components/common/MessageStrip';
import { Priority, SampleFlag, Status } from '../../components/common/Status';
import { ErrorState, LoadingState } from '../../components/common/States';
import { useToast } from '../../components/common/Toast';
import { PageHeader } from '../../components/layout/PageHeader';
import { useAction, useApi } from '../../hooks/useApi';
import { patch } from '../../services/api';
import type { Task } from '../../types';
import { formatDate, formatDateTime } from '../../utils/format';
import { TASK_NEXT } from '../../utils/status';
import { TaskDialog } from './TaskDialog';

export function TaskDetailPage() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const toast = useToast();
  const { data: t, error, loading, reload } = useApi<Task>(`/tasks/${id}`);
  const [editing, setEditing] = useState(false);
  const act = useAction();

  if (loading && !t) return <LoadingState />;
  if (error && !t) return <div className="page-content"><ErrorState error={error} onRetry={reload} /></div>;
  if (!t) return null;
  const canStatus = can('task.edit') || t.assigneeId === user?.id;

  const setStatus = async (status: string) => {
    if (await act.run(() => patch(`/tasks/${t.id}`, { status }))) { toast(`${t.code}: ${status}`); reload(); }
  };

  return (
    <>
      <PageHeader crumbs={[{ to: '/tasks', label: 'Tasks' }]} docTitle={t.code}
        title={<>{t.code} · {t.title} <Status value={t.status} inverted /> <SampleFlag show={t.isSample} /></>}
        actions={can('task.edit') && <Button icon={<Pencil size={16} />} onClick={() => setEditing(true)}>Edit</Button>}>
        <dl className="object-attrs">
          <div><dt>Priority</dt><dd><Priority value={t.priority} /></dd></div>
          <div><dt>Owner</dt><dd>{t.assigneeName ?? 'Unassigned'}</dd></div>
          <div><dt>Due</dt><dd>{formatDate(t.dueDate)}</dd></div>
          <div><dt>Requirement</dt><dd>{t.requirementId ? <Link to={`/requirements/${t.requirementId}`}>{t.requirementCode} {t.requirementTitle}</Link> : '—'}</dd></div>
          <div><dt>Created</dt><dd>{t.createdByName} · {formatDate(t.createdAt)}</dd></div>
          {t.completedAt && <div><dt>Completed</dt><dd>{formatDateTime(t.completedAt)}</dd></div>}
        </dl>
      </PageHeader>
      <div className="page-content">
        {act.error && <MessageStrip type="error" onClose={() => act.setError(null)}>{act.error}</MessageStrip>}
        <div className="card-grid">
          <Card title="Status">
            <div className="row">
              {(TASK_NEXT[t.status] ?? []).map((s) => (
                <Button key={s} variant={s === 'Done' ? 'positive' : s === 'Blocked' ? 'negative' : 'default'} disabled={!canStatus || act.pending} onClick={() => void setStatus(s)}>{s === 'Done' ? 'Complete' : `Set to ${s}`}</Button>
              ))}
            </div>
            {!canStatus && <p className="muted small" style={{ marginTop: 8 }}>Only the owner or users with task editing rights can change the status.</p>}
          </Card>
          <Card title="Description" className="span-2"><p className="prewrap">{t.description || <span className="muted">No description.</span>}</p></Card>
          <Comments entityType="task" entityId={t.id} />
          <History items={t.history} />
        </div>
      </div>
      <TaskDialog open={editing} existing={t} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />
    </>
  );
}
