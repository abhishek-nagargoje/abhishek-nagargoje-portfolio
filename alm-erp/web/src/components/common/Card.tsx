import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function Card({ title, subtitle, count, actions, to, children, className, bodyClass, headingLevel = 2 }: {
  title: ReactNode; subtitle?: ReactNode; count?: ReactNode; actions?: ReactNode; to?: string; children: ReactNode;
  className?: string; bodyClass?: string; headingLevel?: 2 | 3;
}) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className={`card ${className ?? ''}`}>
      <header className="card-header">
        <div>
          <H className="card-title">{to ? <Link to={to} style={{ color: 'inherit' }}>{title}</Link> : title}</H>
          {subtitle && <div className="card-subtitle">{subtitle}</div>}
        </div>
        {count !== undefined && <span className="card-count">{count}</span>}
        {actions && <div className="card-actions">{actions}</div>}
      </header>
      <div className={`card-body ${bodyClass ?? ''}`}>{children}</div>
    </section>
  );
}
