export const dynamic = "force-static";

import AdminGuard from "../../../components/admin/AdminGuard";
import AdminShell from "../../../components/admin/AdminShell";
import ProjectsAdmin from "../../../components/admin/ProjectsAdmin";

export const metadata = { title: "Admin · Projects", robots: { index: false, follow: false } };

export default function AdminProjectsPage() {
  return (
    <AdminGuard>
      <AdminShell>
        <ProjectsAdmin />
      </AdminShell>
    </AdminGuard>
  );
}
