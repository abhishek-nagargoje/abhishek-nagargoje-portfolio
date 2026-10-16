import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { LoadingState } from '../components/common/States';
import { ToastProvider } from '../components/common/Toast';
import { AppShell } from '../components/layout/AppShell';
import { LoginPage } from '../features/auth/LoginPage';

const page = <T extends Record<string, unknown>>(loader: () => Promise<T>, name: keyof T) =>
  lazy(() => loader().then((m) => ({ default: m[name] as React.ComponentType })));

const AccountPage = page(() => import('../features/auth/AccountPage'), 'AccountPage');
const LaunchpadPage = page(() => import('../features/launchpad/LaunchpadPage'), 'LaunchpadPage');
const OverviewPage = page(() => import('../features/dashboard/OverviewPage'), 'OverviewPage');
const ProcessesPage = page(() => import('../features/processes/ProcessesPage'), 'ProcessesPage');
const RequirementsPage = page(() => import('../features/requirements/RequirementsPage'), 'RequirementsPage');
const RequirementDetailPage = page(() => import('../features/requirements/RequirementDetailPage'), 'RequirementDetailPage');
const TasksPage = page(() => import('../features/tasks/TasksPage'), 'TasksPage');
const TaskDetailPage = page(() => import('../features/tasks/TaskDetailPage'), 'TaskDetailPage');
const TestsPage = page(() => import('../features/tests/TestsPage'), 'TestsPage');
const TestDetailPage = page(() => import('../features/tests/TestDetailPage'), 'TestDetailPage');
const DefectsPage = page(() => import('../features/defects/DefectsPage'), 'DefectsPage');
const DefectDetailPage = page(() => import('../features/defects/DefectDetailPage'), 'DefectDetailPage');
const DeploymentPage = page(() => import('../features/deployment/DeploymentPage'), 'DeploymentPage');
const MonitoringPage = page(() => import('../features/monitoring/MonitoringPage'), 'MonitoringPage');
const IncidentDetailPage = page(() => import('../features/monitoring/IncidentDetailPage'), 'IncidentDetailPage');
const ProcurementPage = page(() => import('../features/procurement/ProcurementPage'), 'ProcurementPage');
const PurchaseOrderDetailPage = page(() => import('../features/procurement/PurchaseOrderDetailPage'), 'PurchaseOrderDetailPage');
const InventoryPage = page(() => import('../features/inventory/InventoryPage'), 'InventoryPage');
const MaterialDetailPage = page(() => import('../features/inventory/MaterialDetailPage'), 'MaterialDetailPage');
const MrpPage = page(() => import('../features/mrp/MrpPage'), 'MrpPage');
const SalesPage = page(() => import('../features/sales/SalesPage'), 'SalesPage');
const SalesOrderDetailPage = page(() => import('../features/sales/SalesOrderDetailPage'), 'SalesOrderDetailPage');
const DeliveryDetailPage = page(() => import('../features/sales/DeliveryDetailPage'), 'DeliveryDetailPage');
const InvoiceDetailPage = page(() => import('../features/sales/InvoiceDetailPage'), 'InvoiceDetailPage');
const DocumentsPage = page(() => import('../features/documents/DocumentsPage'), 'DocumentsPage');
const CompaniesPage = page(() => import('../features/companies/CompaniesPage'), 'CompaniesPage');
const CompanyDetailPage = page(() => import('../features/companies/CompanyDetailPage'), 'CompanyDetailPage');
const TeamPage = page(() => import('../features/team/TeamPage'), 'TeamPage');
const NotificationsPage = page(() => import('../features/notifications/NotificationsPage'), 'NotificationsPage');
const AdminUsersPage = page(() => import('../features/admin/AdminUsersPage'), 'AdminUsersPage');
const AdminSettingsPage = page(() => import('../features/admin/AdminSettingsPage'), 'AdminSettingsPage');
const AuditPage = page(() => import('../features/admin/AuditPage'), 'AuditPage');

/** Client-side guard for navigation only; every API call is authorised again by the server. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <LoadingState label="Restoring your session…" />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (user.mustChangePassword && location.pathname !== '/account') return <Navigate to="/account" replace />;
  return <>{children}</>;
}

function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function NotFound() {
  return <div className="page-content"><div className="state"><strong>Page not found</strong><a href="/">Go to the launchpad</a></div></div>;
}

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Suspense fallback={<LoadingState />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<RequireAuth><AppShell /></RequireAuth>}>
                <Route index element={<LaunchpadPage />} />
                <Route path="overview" element={<OverviewPage />} />
                <Route path="account" element={<AccountPage />} />
                <Route path="processes" element={<ProcessesPage />} />
                <Route path="requirements" element={<RequirementsPage />} />
                <Route path="requirements/:id" element={<RequirementDetailPage />} />
                <Route path="tasks" element={<TasksPage />} />
                <Route path="tasks/:id" element={<TaskDetailPage />} />
                <Route path="tests" element={<TestsPage />} />
                <Route path="tests/:id" element={<TestDetailPage />} />
                <Route path="defects" element={<DefectsPage />} />
                <Route path="defects/:id" element={<DefectDetailPage />} />
                <Route path="deployment" element={<DeploymentPage />} />
                <Route path="monitoring" element={<MonitoringPage />} />
                <Route path="monitoring/incidents/:id" element={<IncidentDetailPage />} />
                <Route path="procurement" element={<ProcurementPage />} />
                <Route path="procurement/purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
                <Route path="inventory" element={<InventoryPage />} />
                <Route path="inventory/materials/:id" element={<MaterialDetailPage />} />
                <Route path="mrp" element={<MrpPage />} />
                <Route path="sales" element={<SalesPage />} />
                <Route path="sales/orders/:id" element={<SalesOrderDetailPage />} />
                <Route path="sales/deliveries/:id" element={<DeliveryDetailPage />} />
                <Route path="sales/invoices/:id" element={<InvoiceDetailPage />} />
                <Route path="documents" element={<DocumentsPage />} />
                <Route path="companies" element={<CompaniesPage />} />
                <Route path="companies/:id" element={<CompanyDetailPage />} />
                <Route path="team" element={<TeamPage />} />
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="admin/users" element={<RequirePermission permission="admin.users"><AdminUsersPage /></RequirePermission>} />
                <Route path="admin/settings" element={<RequirePermission permission="admin.settings"><AdminSettingsPage /></RequirePermission>} />
                <Route path="admin/audit" element={<RequirePermission permission="admin.audit"><AuditPage /></RequirePermission>} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
