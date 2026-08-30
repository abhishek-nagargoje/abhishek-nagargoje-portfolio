export const dynamic = "force-static";

import LoginForm from "../../../components/admin/LoginForm";

export const metadata = { title: "Admin Login", robots: { index: false, follow: false } };

export default function AdminLoginPage() {
  return <LoginForm />;
}
