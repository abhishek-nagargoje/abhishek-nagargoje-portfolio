import { CheckSquare } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Priority, Status } from '../../components/common/Status';
import { ErrorState, LoadingState } from '../../components/common/States';
import { Tabs } from '../../components/common/Tabs';
import { NAV, type NavItem } from '../../components/layout/nav';
import { useApi, useDocumentTitle } from '../../hooks/useApi';
import { formatDateTime, formatINR, formatINRCompact, formatNumber } from '../../utils/format';

interface Home {
  todos: { kind: string; id: number; code: string; title: string; priority: string; status: string; updatedAt: string; link: string }[];
  approvals: { id: number; number: number; netAmount: string; createdAt: string; createdByName: string; vendorName: string }[];
  tiles: {
    unreadNotifications: number; openPos: number; pendingApproval: number; openSos: number; stockUnits: number; openDefects: number;
    openRequirements: number; openIncidents: number; billedRevenue: string;
  };
}

type Kpi = { value: string; unit?: string; tone?: 'negative' | 'positive' };

function Tile({ item, kpi }: { item: NavItem; kpi?: Kpi }) {
  return (
    <Link to={item.to} className="tile" aria-label={`${item.label}${kpi ? `: ${kpi.value} ${kpi.unit ?? ''}` : ''}`}>
      <span className="tile-title">{item.label}</span>
      <span className="tile-sub">{item.description}</span>
      <span className="tile-foot">
        <item.icon className="tile-icon" aria-hidden strokeWidth={1.4} />
        {kpi && <span className="text-right"><span className={`tile-kpi ${kpi.tone ?? ''} ${kpi.value.length > 6 ? 'long' : ''}`}>{kpi.value}</span>{kpi.unit && <span className="tile-unit"> {kpi.unit}</span>}</span>}
      </span>
    </Link>
  );
}

export function LaunchpadPage() {
  useDocumentTitle('Home');
  const { user, can } = useAuth();
  const [tab, setTab] = useState('home');
  const { data, error, loading, reload } = useApi<Home>('/dashboard/home');
  const groups = NAV.filter((g) => g.id !== 'home').map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || can(i.permission)) })).filter((g) => g.items.length);
  const t = data?.tiles;
  const kpis: Record<string, Kpi | undefined> = t ? {
    '/requirements': { value: formatNumber(t.openRequirements), unit: 'open' },
    '/defects': { value: formatNumber(t.openDefects), unit: 'open', tone: t.openDefects ? 'negative' : 'positive' },
    '/procurement': { value: formatNumber(t.pendingApproval), unit: 'to approve', tone: t.pendingApproval ? 'negative' : undefined },
    '/sales': { value: formatNumber(t.openSos), unit: 'open orders' },
    '/inventory': { value: formatNumber(t.stockUnits), unit: 'units' },
    '/monitoring': { value: formatNumber(t.openIncidents), unit: 'alerts', tone: t.openIncidents ? 'negative' : 'positive' },
    '/documents': undefined,
  } : {};

  const allItems = groups.flatMap((g) => g.items);
  const tabs = [{ id: 'home', label: 'My Home' }, ...groups.map((g) => ({ id: g.id, label: g.label }))];
  const groupItems = groups.find((g) => g.id === tab)?.items ?? [];

  return (
    <div className="launchpad">
      <h1 className="sr-only">Launchpad</h1>
      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Launchpad sections" className="lp-tabs" tabClass="lp-tab" />
      <div className="lp-content" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {loading && !data && <LoadingState />}
        {error && <div className="card"><ErrorState error={error} onRetry={reload} /></div>}
        {data && tab === 'home' && (
          <>
            <h2 className="lp-section-title">To Dos <small>Welcome, {user?.fullName} · {data.todos.length + data.approvals.length} open · {data.tiles.unreadNotifications} unread notifications</small></h2>
            <div className="tile-grid">
              {data.approvals.map((a) => (
                <Link key={`po-${a.id}`} to={`/procurement/purchase-orders/${a.id}`} className="tile todo-tile">
                  <span className="tile-title">Approve Purchase Order {a.number}</span>
                  <span><Priority value="High" /></span>
                  <span className="tile-sub">{a.vendorName} · {formatINR(a.netAmount)} net</span>
                  <span className="tile-sub">Created by {a.createdByName} · {formatDateTime(a.createdAt)}</span>
                </Link>
              ))}
              {data.todos.map((x) => (
                <Link key={`${x.kind}-${x.id}`} to={x.link} className="tile todo-tile">
                  <span className="tile-title">{x.code} · {x.title}</span>
                  <span className="row"><Priority value={x.priority} /><Status value={x.status} /></span>
                  <span className="tile-sub" style={{ textTransform: 'capitalize' }}>{x.kind} · updated {formatDateTime(x.updatedAt)}</span>
                </Link>
              ))}
              {!data.todos.length && !data.approvals.length && (
                <div className="todo-empty row"><CheckSquare size={18} aria-hidden /> Nothing is assigned to you right now.</div>
              )}
            </div>
            <h2 className="lp-section-title">Insights</h2>
            <div className="tile-grid">
              {allItems.filter((i) => kpis[i.to]).map((i) => <Tile key={i.to} item={i} kpi={kpis[i.to]} />)}
              <Link to="/sales" className="tile">
                <span className="tile-title">Billed Revenue</span>
                <span className="tile-sub">Posted invoices incl. GST</span>
                <span className="tile-foot"><span /><span className="tile-kpi positive">{formatINRCompact(data.tiles.billedRevenue)}</span></span>
              </Link>
            </div>
            {groups.map((g) => (
              <section key={g.id}>
                <h2 className="lp-section-title">{g.label}</h2>
                <div className="tile-grid">{g.items.map((i) => <Tile key={i.to} item={i} />)}</div>
              </section>
            ))}
          </>
        )}
        {data && tab !== 'home' && (
          <div className="tile-grid" style={{ marginTop: 16 }}>
            {groupItems.map((i) => <Tile key={i.to} item={i} kpi={kpis[i.to]} />)}
          </div>
        )}
      </div>
    </div>
  );
}
