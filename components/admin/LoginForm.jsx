"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, isAdmin, getSession, requestPasswordReset } from "../../lib/supabase/auth";
import { Card, Field, Input, Button, Banner } from "./ui";

const isNetworkError = (err) =>
  !err?.status || err?.name === "AuthRetryableFetchError";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("login"); // login | forgot
  const [notice, setNotice] = useState("");

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
      // Unreachable Auth API (offline, or the Supabase project is paused)
      // gets a distinct message: supabase-js reports it as
      // AuthRetryableFetchError with status 0, which previously fell through
      // to "Invalid email or password" and looked like a wrong password.
      if (isNetworkError(err)) {
        setError("Can't reach the authentication server. Check your connection — if this persists, the Supabase project may be paused.");
      } else if (err?.status === 429) {
        setError("Too many attempts. Wait a few minutes and try again.");
      } else {
        setError("Invalid email or password.");
      }
      setLoading(false);
    }
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await requestPasswordReset(email);
    } catch (err) {
      // Rate-limit / network errors are the only ones worth surfacing; never
      // reveal whether the address belongs to an account.
      if (isNetworkError(err)) {
        setError("Can't reach the authentication server. Check your connection — if this persists, the Supabase project may be paused.");
        setLoading(false);
        return;
      }
      if (err?.status === 429) {
        setError("Too many reset requests. Wait a few minutes and try again.");
        setLoading(false);
        return;
      }
    }
    setNotice("If that email belongs to an admin account, a reset link is on its way. It expires after one use.");
    setLoading(false);
  };

  const switchMode = (next) => {
    setMode(next);
    setError("");
    setNotice("");
    setPassword("");
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
        <h1 className="text-lg font-semibold mb-1">{mode === "login" ? "Admin Login" : "Reset password"}</h1>
        <p className="text-xs text-white/40 mb-5">
          {mode === "login"
            ? "Sign in to manage portfolio content."
            : "Enter the admin email and we'll send a one-time reset link."}
        </p>
        <Banner type="error">{error}</Banner>
        <Banner type="success">{notice}</Banner>
        {mode === "login" ? (
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
            <button
              type="button"
              onClick={() => switchMode("forgot")}
              className="text-xs text-white/50 hover:text-white/80 underline-offset-4 hover:underline self-center"
            >
              Forgot password?
            </button>
          </form>
        ) : (
          <form onSubmit={handleForgot} className="flex flex-col gap-4">
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
              />
            </Field>
            <Button type="submit" disabled={loading}>
              {loading ? "Sending…" : "Send reset link"}
            </Button>
            <button
              type="button"
              onClick={() => switchMode("login")}
              className="text-xs text-white/50 hover:text-white/80 underline-offset-4 hover:underline self-center"
            >
              Back to sign in
            </button>
          </form>
        )}
      </Card>
    </div>
  );
}
