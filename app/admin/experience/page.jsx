export const dynamic = "force-static";

import AdminGuard from "../../../components/admin/AdminGuard";
import AdminShell from "../../../components/admin/AdminShell";
import ExperienceAdmin from "../../../components/admin/ExperienceAdmin";

export const metadata = { title: "Admin · Experience", robots: { index: false, follow: false } };

export default function AdminExperiencePage() {
  return (
    <AdminGuard>
      <AdminShell>
        <ExperienceAdmin />
      </AdminShell>
    </AdminGuard>
  );
}
