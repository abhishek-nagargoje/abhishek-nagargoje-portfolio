import { AlertTriangle, CheckCircle2, Info, XCircle, X } from 'lucide-react';
import type { ReactNode } from 'react';

const ICON = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };

export function MessageStrip({ type, children, onClose }: { type: keyof typeof ICON; children: ReactNode; onClose?: () => void }) {
  const Icon = ICON[type];
  return (
    <div className={`msg msg-${type}`} role={type === 'error' ? 'alert' : 'status'}>
      <Icon size={16} aria-hidden />
      <div>{children}</div>
      {onClose && (
        <button className="msg-close" onClick={onClose} aria-label="Dismiss message"><X size={14} /></button>
      )}
    </div>
  );
}
