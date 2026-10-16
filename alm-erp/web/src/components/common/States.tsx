import { AlertTriangle, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';

export function LoadingState({ label = 'Loading…', inline }: { label?: string; inline?: boolean }) {
  return (
    <div className={`state ${inline ? 'inline' : ''}`} role="status" aria-live="polite">
      <span className="spinner" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, children, inline }: { title: string; children?: ReactNode; inline?: boolean }) {
  return (
    <div className={`state ${inline ? 'inline' : ''}`}>
      <Inbox size={inline ? 24 : 40} aria-hidden />
      <strong>{title}</strong>
      {children && <div>{children}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, inline }: { error: { message: string } | string; onRetry?: () => void; inline?: boolean }) {
  return (
    <div className={`state ${inline ? 'inline' : ''}`} role="alert">
      <AlertTriangle size={inline ? 24 : 40} aria-hidden style={{ color: 'var(--c-negative)' }} />
      <span>{typeof error === 'string' ? error : error.message}</span>
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}
