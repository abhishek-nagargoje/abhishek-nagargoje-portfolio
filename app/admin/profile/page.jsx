export const dynamic = "force-static";

import AdminGuard from "../../../components/admin/AdminGuard";
import AdminShell from "../../../components/admin/AdminShell";
import ProfileAdmin from "../../../components/admin/ProfileAdmin";

export const metadata = { title: "Admin · Profile", robots: { index: false, follow: false } };

export default function AdminProfilePage() {
  return (
    <AdminGuard>
      <AdminShell>
        <ProfileAdmin />
      </AdminShell>
    </AdminGuard>
  );
}
