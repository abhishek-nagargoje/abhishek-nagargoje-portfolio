export const dynamic = "force-static";

import AdminGuard from "../../components/admin/AdminGuard";
import AdminShell from "../../components/admin/AdminShell";
import Dashboard from "../../components/admin/Dashboard";

export const metadata = { title: "Admin Dashboard", robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <AdminGuard>
      <AdminShell>
        <Dashboard />
      </AdminShell>
    </AdminGuard>
  );
}
