import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'default' | 'emph' | 'transparent' | 'negative' | 'positive' | 'negative-emph' | 'positive-emph';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'sm';
  icon?: ReactNode;
  busy?: boolean;
  iconOnly?: boolean;
}

const variantClass: Record<Variant, string> = {
  default: '',
  emph: 'btn-emph',
  transparent: 'btn-transparent',
  negative: 'btn-negative',
  positive: 'btn-positive',
  'negative-emph': 'btn-negative btn-emph',
  'positive-emph': 'btn-positive btn-emph',
};

export function Button({ variant = 'default', size = 'md', icon, busy, iconOnly, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  const cls = ['btn', variantClass[variant], size === 'sm' ? 'btn-sm' : '', iconOnly ? 'btn-icon' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="spinner" aria-hidden /> : icon}
      {children}
    </button>
  );
}
