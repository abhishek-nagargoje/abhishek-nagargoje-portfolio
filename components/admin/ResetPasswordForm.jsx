"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase/client";
import { getSession, isAdmin, signOut, updatePasswordAndRevokeOtherSessions } from "../../lib/supabase/auth";
import { Card, Field, Input, Button, Banner } from "./ui";

// supabase-js consumes and strips the recovery hash asynchronously during
// client init, so capture it synchronously at module load (same tick the
// client is created) to know this visit really came from an emailed link.
const initialHash = typeof window !== "undefined" ? window.location.hash : "";
const hashParams = new URLSearchParams(initialHash.replace(/^#/, ""));
const ARRIVED_VIA_RECOVERY_LINK = hashParams.get("type") === "recovery";
const LINK_ERROR = hashParams.get("error_description");

const MIN_LENGTH = 12;

export default function ResetPasswordForm() {
  const router = useRouter();
  const [status, setStatus] = useState("checking"); // checking | ready | invalid | done
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let recoveryEvent = false;

    const sub = supabase?.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        recoveryEvent = true;
        if (!cancelled) setStatus("ready");
      }
    });

    (async () => {
      const session = await getSession();
      if (cancelled) return;
      // Only offer the form to a session that was just created from a
      // recovery link — an ordinary signed-in session doesn't get to set a
      // password from here.
      if (session && (ARRIVED_VIA_RECOVERY_LINK || recoveryEvent)) setStatus("ready");
      else setStatus("invalid");
    })();

    return () => {
      cancelled = true;
      sub?.data?.subscription?.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      await updatePasswordAndRevokeOtherSessions(password);
      setPassword("");
      setConfirm("");
      // Recovery links can be issued for any account; only go to the
      // dashboard if this account is actually an admin.
      if (await isAdmin()) {
        setStatus("done");
        setTimeout(() => router.replace("/admin"), 1500);
      } else {
        await signOut();
        setStatus("done");
      }
    } catch (err) {
      // Supabase returns specific, safe messages here (weak password,
      // same as old password, reauthentication required).
      setError(err?.message || "Could not update password.");
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#080b14", color: "#f1f5f9" }}>
      <Card className="w-full max-w-sm">
        <h1 className="text-lg font-semibold mb-1">Set a new password</h1>

        {status === "checking" && <p className="text-sm text-white/40 mt-3">Verifying reset link…</p>}

        {status === "invalid" && (
          <>
            <Banner type="error">
              {LINK_ERROR || "This reset link is invalid, expired, or was already used."}
            </Banner>
            <Link href="/admin/login" className="text-sm text-indigo-300 hover:underline">
              Request a new link
            </Link>
          </>
        )}

        {status === "done" && (
          <Banner type="success">Password updated. Other sessions were signed out.</Banner>
        )}

        {status === "ready" && (
          <>
            <p className="text-xs text-white/40 mb-5">
              At least {MIN_LENGTH} characters. All other signed-in sessions will be logged out.
            </p>
            <Banner type="error">{error}</Banner>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Field label="New password">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={MIN_LENGTH}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Confirm password">
                <Input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={MIN_LENGTH}
                  autoComplete="new-password"
                />
              </Field>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Update password"}
              </Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
