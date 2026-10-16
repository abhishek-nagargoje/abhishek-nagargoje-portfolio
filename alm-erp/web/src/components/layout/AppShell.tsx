import { Bell, LogOut, Menu, Search, UserCog } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useApi, useDebounced } from '../../hooks/useApi';
import { api, post, qs } from '../../services/api';
import { initials, timeAgo } from '../../utils/format';
import { NAV, navItemFor } from './nav';

const NAV_KEY = 'alm.nav.expanded';

function readPref(): boolean {
  try { return localStorage.getItem(NAV_KEY) === '1'; } catch { return false; }
}

export function AppShell() {
  const { user, can } = useAuth();
  const location = useLocation();
  const [expanded, setExpanded] = useState(readPref);
  const current = navItemFor(location.pathname);

  const toggle = () => {
    setExpanded((e) => {
      try { localStorage.setItem(NAV_KEY, e ? '0' : '1'); } catch { /* preference only */ }
      return !e;
    });
  };
  // On phones the navigation is an overlay: close it after navigating.
  useEffect(() => {
    if (window.matchMedia('(max-width: 600px)').matches) setExpanded(false);
  }, [location.pathname]);

  return (
    <div className="app">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="shell-header">
        <button className="shell-btn" onClick={toggle} aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'} aria-expanded={expanded} aria-controls="side-nav">
          <Menu size={20} />
        </button>
        <Link to="/" className="shell-brand" aria-label="Meridian ALM home">
          <span className="shell-logo" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 32 32"><path d="M5 25V7h4.2l6.8 9.5L22.8 7H27v18h-4.4V14.4L16 23.5l-6.6-9.1V25z" fill="#fff" /></svg>
          </span>
          <span className="shell-product">Meridian ALM</span>
        </Link>
        <span className="shell-title" aria-hidden>{current && current.to !== '/' ? `· ${current.label}` : ''}</span>
        <span className="spacer" />
        <GlobalSearch />
        <NotificationBell />
        <UserMenu name={user!.fullName} email={user!.email} roles={user!.roles.map((r) => r.name)} />
      </header>
      <div className="app-body">
        <nav id="side-nav" className={`side-nav ${expanded ? 'expanded' : ''}`} aria-label="Applications">
          {NAV.map((g) => {
            const items = g.items.filter((i) => !i.permission || can(i.permission));
            if (!items.length) return null;
            return (
              <div key={g.id}>
                <div className="nav-group-label" aria-hidden={!expanded}>{g.label}</div>
                <ul>
                  {items.map((i) => (
                    <li key={i.to}>
                      <NavLink to={i.to} end={i.to === '/'} title={i.label}
                        className={() => `nav-item ${current?.to === i.to ? 'active' : ''}`} aria-current={current?.to === i.to ? 'page' : undefined}>
                        <i.icon aria-hidden strokeWidth={1.6} />
                        <span className="nav-label">{i.label}</span>
                        {!expanded && <span className="sr-only">{i.label}</span>}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <main id="main" className="app-main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return { open, setOpen, ref };
}

interface Notif { id: number; message: string; link: string | null; isRead: boolean; createdAt: string; actorName: string | null }

function NotificationBell() {
  const { open, setOpen, ref } = usePopover();
  const navigate = useNavigate();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  const list = useApi<{ items: Notif[]; unread: number }>(open ? '/notifications?pageSize=15' : null);

  const refreshCount = useCallback(() => {
    api<{ unread: number }>('/notifications/unread-count').then((r) => setUnread(r.unread)).catch(() => undefined);
  }, []);
  // Poll lightly; also refresh after each navigation (most actions navigate or reload).
  useEffect(() => { refreshCount(); }, [refreshCount, location.pathname]);
  useEffect(() => {
    const t = setInterval(refreshCount, 60_000);
    return () => clearInterval(t);
  }, [refreshCount]);
  useEffect(() => { if (list.data) setUnread(list.data.unread); }, [list.data]);

  const openItem = async (n: Notif) => {
    if (!n.isRead) await post(`/notifications/${n.id}/read`).catch(() => undefined);
    setOpen(false);
    refreshCount();
    if (n.link) navigate(n.link);
  };
  const markAll = async () => {
    await post('/notifications/read-all').catch(() => undefined);
    list.reload();
    refreshCount();
  };

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="shell-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} aria-haspopup="dialog"
        onClick={() => setOpen(!open)}>
        <Bell size={18} />
        {unread > 0 && <span className="count-badge" aria-hidden>{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Notifications">
          <div className="popover-header">
            <strong>Notifications</strong>
            <span className="spacer" />
            <button className="btn btn-sm btn-transparent" onClick={markAll} disabled={!unread}>Mark all read</button>
          </div>
          <div className="notif-list">
            {list.loading && !list.data && <div className="state inline"><span className="spinner" /></div>}
            {list.error && <div className="state inline">{list.error.message}</div>}
            {list.data?.items.length === 0 && <div className="state inline">No notifications.</div>}
            {list.data?.items.map((n) => (
              <button key={n.id} className={`notif ${n.isRead ? '' : 'unread'}`} onClick={() => void openItem(n)}>
                {n.message}
                <small>{n.actorName ? `${n.actorName} · ` : ''}{timeAgo(n.createdAt)}</small>
              </button>
            ))}
          </div>
          <div className="popover-header" style={{ borderBottom: 0, borderTop: '1px solid var(--c-divider)' }}>
            <Link to="/notifications" onClick={() => setOpen(false)}>View all notifications</Link>
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu({ name, email, roles }: { name: string; email: string; roles: string[] }) {
  const { open, setOpen, ref } = usePopover();
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="shell-avatar" aria-label={`User menu for ${name}`} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        {initials(name)}
      </button>
      {open && (
        <div className="popover" style={{ minWidth: 260 }}>
          <div className="popover-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <strong>{name}</strong>
            <span className="muted small">{email}</span>
            <span className="muted small">{roles.join(', ')}</span>
          </div>
          <ul className="menu" role="menu">
            <li role="none"><button role="menuitem" onClick={() => { setOpen(false); navigate('/account'); }}><UserCog size={16} />Account settings</button></li>
            <li role="none"><button role="menuitem" onClick={() => { setOpen(false); void logout().then(() => navigate('/login')); }}><LogOut size={16} />Sign out</button></li>
          </ul>
        </div>
      )}
    </div>
  );
}

interface SearchHit { kind: string; id: number; ref: string; label: string; link: string }

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const { open, setOpen, ref } = usePopover();
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const dq = useDebounced(q.trim(), 250);
  const { data, loading } = useApi<{ items: SearchHit[] }>(open && dq.length >= 2 ? `/search${qs({ q: dq })}` : null);
  const hits = data?.items ?? [];
  const go = (h: SearchHit) => { setOpen(false); setQ(''); setMobileOpen(false); navigate(h.link); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === 'Enter' && hits[active]) { e.preventDefault(); go(hits[active]); }
  };
  return (
    <>
      <button className="shell-btn search-toggle" aria-label="Search" onClick={() => setMobileOpen(true)}><Search size={18} /></button>
      <div className={`shell-search ${mobileOpen ? 'open' : ''}`} ref={ref} role="search">
        <input aria-label="Search requirements, tasks, documents, materials and companies" placeholder="Search" value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
          onBlur={() => { if (!q) setMobileOpen(false); }} />
        <Search size={16} aria-hidden />
        {open && dq.length >= 2 && (
          <div className="popover search-results" role="listbox" aria-label="Search results">
            {loading && !hits.length && <div className="state inline"><span className="spinner" /></div>}
            {!loading && !hits.length && <div className="state inline">No results for “{dq}”.</div>}
            {hits.map((h, i) => (
              <a key={`${h.kind}-${h.id}`} href={h.link} role="option" aria-selected={i === active} className={i === active ? 'active' : ''}
                onClick={(e) => { e.preventDefault(); go(h); }}>
                <span className="kind">{h.kind}</span><span><strong>{h.ref}</strong> {h.label}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
