export const dynamic = "force-static";

import AdminGuard from "../../../components/admin/AdminGuard";
import AdminShell from "../../../components/admin/AdminShell";
import SkillsAdmin from "../../../components/admin/SkillsAdmin";

export const metadata = { title: "Admin · Skills", robots: { index: false, follow: false } };

export default function AdminSkillsPage() {
  return (
    <AdminGuard>
      <AdminShell>
        <SkillsAdmin />
      </AdminShell>
    </AdminGuard>
  );
}
