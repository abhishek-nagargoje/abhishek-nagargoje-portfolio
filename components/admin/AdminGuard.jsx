"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession, isAdmin, onAuthStateChange } from "../../lib/supabase/auth";

// The real security boundary is Supabase RLS, not this component — this only
// controls what the admin UI *renders*. Every read/write below is independently
// re-checked by the database regardless of what this guard decides.
export default function AdminGuard({ children }) {
  const router = useRouter();
  const [status, setStatus] = useState("checking"); // checking | unauthenticated | unauthorized | authorized

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const session = await getSession();
      if (!session) {
        if (!cancelled) setStatus("unauthenticated");
        return;
      }
      const admin = await isAdmin();
      if (cancelled) return;
      setStatus(admin ? "authorized" : "unauthorized");
    }

    check();
    const { data: sub } = onAuthStateChange(() => check());
    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/admin/login");
  }, [status, router]);

  if (status === "checking" || status === "unauthenticated") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#080b14", color: "#f1f5f9" }}>
        <p className="text-sm text-white/40">Checking session…</p>
      </div>
    );
  }

  if (status === "unauthorized") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3" style={{ background: "#080b14", color: "#f1f5f9" }}>
        <p className="text-lg font-semibold">Not authorized</p>
        <p className="text-sm text-white/40 max-w-sm text-center">
          You&apos;re signed in, but this account isn&apos;t registered as an admin.
        </p>
      </div>
    );
  }

  return children;
}
