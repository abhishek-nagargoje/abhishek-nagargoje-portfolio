import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../../hooks/useApi';

export function PageHeader({ title, subtitle, actions, crumbs, children, after, docTitle }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: { to: string; label: string }[]; children?: ReactNode;
  after?: ReactNode; docTitle?: string;
}) {
  useDocumentTitle(docTitle ?? (typeof title === 'string' ? title : ''));
  return (
    <div className="page-header">
      <div className="page-header-inner">
        {crumbs && crumbs.length > 0 && (
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => <span key={c.to}><Link to={c.to}>{c.label}</Link>{i < crumbs.length - 1 ? ' /' : ''}</span>)}
          </nav>
        )}
        <div className="page-title-row">
          <div>
            <h1 className="page-title">{title}</h1>
            {subtitle && <div className="page-subtitle">{subtitle}</div>}
          </div>
          {actions && <div className="page-actions">{actions}</div>}
        </div>
        {children}
      </div>
      {after}
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="filter-bar" role="group" aria-label="Filters">{children}</div>;
}
