import { supabase } from "./client";

export async function signIn(email, password) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthStateChange(callback) {
  if (!supabase) return { data: { subscription: { unsubscribe() {} } } };
  return supabase.auth.onAuthStateChange((_event, session) => callback(session));
}

// Supabase Auth's built-in recovery flow: emails a single-use link to the
// account owner. The response is identical whether or not the email exists,
// so this can't be used to enumerate accounts — and it never changes anything
// on its own; only the holder of the emailed link can set a new password.
// The redirect URL must be listed under Supabase → Auth → URL Configuration.
export async function requestPasswordReset(email) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const redirectTo = `${window.location.origin}${basePath}/admin/reset-password/`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

// Sets a new password for the currently signed-in (recovery) session, then
// revokes every *other* session/refresh token for this user so anything that
// was signed in with the old password is logged out.
export async function updatePasswordAndRevokeOtherSessions(password) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  const { error: revokeError } = await supabase.auth.signOut({ scope: "others" });
  if (revokeError) throw revokeError;
}

// Asks the database whether the current session belongs to an authorized admin.
// This is the actual authorization check — never inferred from the session alone.
export async function isAdmin() {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("am_i_admin");
  if (error) return false;
  return Boolean(data);
}
