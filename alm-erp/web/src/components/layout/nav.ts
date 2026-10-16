import {
  Activity, Bug, Building2, CalendarClock, ChevronsRight, ClipboardCheck, ClipboardList, Files, Gauge, LayoutGrid, ListChecks,
  Package, Server, Settings, ShieldCheck, ShoppingCart, Truck, Users, type LucideIcon,
} from 'lucide-react';

export interface NavItem { to: string; label: string; icon: LucideIcon; permission?: string; description: string }
export interface NavGroup { id: string; label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { id: 'home', label: 'Home', items: [
    { to: '/', label: 'Launchpad', icon: LayoutGrid, description: 'To-dos and apps' },
    { to: '/overview', label: 'Overview', icon: Gauge, description: 'Project cards' },
  ] },
  { id: 'impl', label: 'Implementation', items: [
    { to: '/processes', label: 'Business Processes', icon: ChevronsRight, description: 'Source to Pay · Plan to Produce · Lead to Cash' },
    { to: '/requirements', label: 'Requirements', icon: ClipboardList, description: 'Fit-to-standard and sign-off' },
    { to: '/tasks', label: 'Tasks', icon: ListChecks, description: 'Project work items' },
    { to: '/tests', label: 'Test Management', icon: ClipboardCheck, description: 'Test cases and executions' },
    { to: '/defects', label: 'Defects', icon: Bug, description: 'Issues found in testing' },
    { to: '/deployment', label: 'Landscape & Deployment', icon: Server, description: 'DEV → QA → PROD' },
  ] },
  { id: 'ops', label: 'Operations', items: [
    { to: '/monitoring', label: 'Operations Monitoring', icon: Activity, description: 'KPIs and incidents' },
  ] },
  { id: 'erp', label: 'ERP Transactions', items: [
    { to: '/procurement', label: 'Procurement', icon: ShoppingCart, description: 'Requisitions, orders, receipts' },
    { to: '/inventory', label: 'Inventory', icon: Package, description: 'Stock overview and movements' },
    { to: '/mrp', label: 'Supply Planning (MRP)', icon: CalendarClock, description: 'Shortages and proposals' },
    { to: '/sales', label: 'Sales & Delivery', icon: Truck, description: 'Orders, deliveries, billing' },
    { to: '/documents', label: 'Document Flow', icon: Files, description: 'All ERP documents' },
    { to: '/companies', label: 'Customers & Vendors', icon: Building2, description: 'Company master data' },
  ] },
  { id: 'team', label: 'Team', items: [
    { to: '/team', label: 'Team & Activity', icon: Users, description: 'Workload and activity log' },
  ] },
  { id: 'admin', label: 'Administration', items: [
    { to: '/admin/users', label: 'Users & Roles', icon: ShieldCheck, permission: 'admin.users', description: 'Accounts and permissions' },
    { to: '/admin/settings', label: 'Configuration', icon: Settings, permission: 'admin.settings', description: 'Business rules' },
    { to: '/admin/audit', label: 'Security Audit Log', icon: ShieldCheck, permission: 'admin.audit', description: 'Sign-ins and admin actions' },
  ] },
];

/** Resolve the nav entry for a path (longest matching prefix). */
export function navItemFor(pathname: string): NavItem | undefined {
  const all = NAV.flatMap((g) => g.items);
  return all
    .filter((i) => (i.to === '/' ? pathname === '/' : pathname === i.to || pathname.startsWith(`${i.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0];
}
