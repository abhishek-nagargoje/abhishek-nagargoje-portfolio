"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, isAdmin, getSession } from "../../lib/supabase/auth";
import { Card, Field, Input, Button, Banner } from "./ui";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState("");

  // Already-authenticated behavior: skip the form entirely if a valid admin
  // session already exists (e.g. user navigates back to /login manually).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await getSession();
      if (!session) {
        if (!cancelled) setCheckingSession(false);
        return;
      }
      const admin = await isAdmin();
      if (cancelled) return;
      if (admin) router.replace("/admin");
      else setCheckingSession(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await signIn(email, password);
      const admin = await isAdmin();
      if (!admin) {
        setError("This account is signed in but is not authorized as an admin.");
        setLoading(false);
        return;
      }
      router.replace("/admin");
    } catch (err) {
      // Deliberately generic — never reveal whether the email exists or the
      // password was wrong, and never surface raw Supabase error internals.
      // Network failures (no `status` from the Auth API) get a distinct message.
      if (err?.status === undefined) {
        setError("Network error — check your connection and try again.");
      } else {
        setError("Invalid email or password.");
      }
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#080b14", color: "#f1f5f9" }}>
        <p className="text-sm text-white/40">Checking session…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#080b14", color: "#f1f5f9" }}>
      <Card className="w-full max-w-sm">
        <h1 className="text-lg font-semibold mb-1">Admin Login</h1>
        <p className="text-xs text-white/40 mb-5">Sign in to manage portfolio content.</p>
        <Banner type="error">{error}</Banner>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </Field>
          <Button type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
