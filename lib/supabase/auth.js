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

// Asks the database whether the current session belongs to an authorized admin.
// This is the actual authorization check — never inferred from the session alone.
export async function isAdmin() {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("am_i_admin");
  if (error) return false;
  return Boolean(data);
}
