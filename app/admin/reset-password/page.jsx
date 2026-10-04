export const dynamic = "force-static";

import ResetPasswordForm from "../../../components/admin/ResetPasswordForm";

export const metadata = { title: "Reset Admin Password", robots: { index: false, follow: false } };

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
