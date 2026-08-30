export const dynamic = "force-static";

import AdminGuard from "../../../components/admin/AdminGuard";
import AdminShell from "../../../components/admin/AdminShell";
import EducationAdmin from "../../../components/admin/EducationAdmin";

export const metadata = { title: "Admin · Education", robots: { index: false, follow: false } };

export default function AdminEducationPage() {
  return (
    <AdminGuard>
      <AdminShell>
        <EducationAdmin />
      </AdminShell>
    </AdminGuard>
  );
}
