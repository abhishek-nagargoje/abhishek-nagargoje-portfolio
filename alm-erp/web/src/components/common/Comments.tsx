import { useState } from 'react';
import { useAction, useApi } from '../../hooks/useApi';
import { post } from '../../services/api';
import type { CommentEntry, HistoryEntry } from '../../types';
import { formatDateTime } from '../../utils/format';
import { Button } from './Button';
import { Card } from './Card';
import { Field } from './Field';
import { ErrorState, LoadingState } from './States';

export function Comments({ entityType, entityId }: { entityType: 'requirement' | 'task' | 'test_case' | 'defect'; entityId: number }) {
  const { data, error, loading, reload } = useApi<{ items: CommentEntry[] }>(`/comments?entityType=${entityType}&entityId=${entityId}`);
  const [body, setBody] = useState('');
  const act = useAction();
  const submit = async () => {
    if (!body.trim()) return;
    const ok = await act.run(() => post('/comments', { entityType, entityId, body: body.trim() }));
    if (ok) { setBody(''); reload(); }
  };
  return (
    <Card title="Comments" count={data ? data.items.length : undefined}>
      {loading && !data && <LoadingState inline />}
      {error && <ErrorState error={error} onRetry={reload} inline />}
      {data?.items.length === 0 && <p className="muted">No comments yet.</p>}
      {data?.items.map((c) => (
        <div key={c.id} className="comment">
          <span className="who">{c.authorName}</span> <span className="muted small">{formatDateTime(c.createdAt)}</span>
          <div>{c.body}</div>
        </div>
      ))}
      <form className="stack" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Add a comment" error={act.error}>
          {(p) => <textarea {...p} className="textarea" rows={2} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />}
        </Field>
        <div><Button type="submit" variant="emph" busy={act.pending} disabled={!body.trim()}>Post comment</Button></div>
      </form>
    </Card>
  );
}

export function History({ items, title = 'History' }: { items: HistoryEntry[]; title?: string }) {
  return (
    <Card title={title} count={items.length}>
      {items.length === 0 ? <p className="muted">No history yet.</p> : (
        <ul className="timeline">
          {items.map((h) => <li key={h.id}>{h.summary}<small>{h.actorName ?? 'System'} · {formatDateTime(h.createdAt)}</small></li>)}
        </ul>
      )}
    </Card>
  );
}
