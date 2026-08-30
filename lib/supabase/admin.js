import { supabase } from "./client";

// Generic CRUD helpers shared by every admin screen. RLS on each table enforces
// that only an authorized admin session can actually insert/update/delete —
// these helpers do not implement authorization themselves.

function requireClient() {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured (missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY). No request was sent."
    );
  }
  return supabase;
}

// Maps raw Postgres/PostgREST errors to messages an admin can actually act on,
// instead of a generic "Save failed." — never swallows the underlying error.
export function describeSupabaseError(error, context = "") {
  if (!error) return "Unknown error.";
  const prefix = context ? `${context}: ` : "";
  switch (error.code) {
    case "42501":
      return `${prefix}permission denied — you may not be signed in as an authorized admin.`;
    case "23505":
      return `${prefix}a record with this value already exists (unique constraint).`;
    case "23502":
      return `${prefix}a required field is missing (not-null constraint).`;
    case "23514":
      return `${prefix}invalid value for a restricted field (check constraint) — e.g. tier/status/category.`;
    default:
      if (!error.code && /fetch|network/i.test(error.message || "")) {
        return `${prefix}network error — could not reach Supabase. Check your connection and try again.`;
      }
      return `${prefix}${error.message || "unknown Supabase error."}`;
  }
}

export async function listAll(table, orderBy = "sort_order") {
  const client = requireClient();
  const { data, error } = await client
    .from(table)
    .select("*")
    .order(orderBy, { ascending: true });
  if (error) throw new Error(describeSupabaseError(error, `Could not load ${table}`));
  return data;
}

export async function createRow(table, values) {
  const client = requireClient();
  const { data, error } = await client.from(table).insert(values).select().single();
  if (error) throw new Error(describeSupabaseError(error, `Could not create ${singularize(table)}`));
  return data;
}

export async function updateRow(table, id, values) {
  const client = requireClient();
  const { data, error } = await client
    .from(table)
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(describeSupabaseError(error, `Could not update ${singularize(table)}`));
  return data;
}

export async function deleteRow(table, id) {
  const client = requireClient();
  const { error } = await client.from(table).delete().eq("id", id);
  if (error) throw new Error(describeSupabaseError(error, `Could not delete ${singularize(table)}`));
}

export async function isSlugTaken(slug, excludeId) {
  const client = requireClient();
  let query = client.from("projects").select("id").eq("slug", slug);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query;
  if (error) throw new Error(describeSupabaseError(error, "Could not verify slug"));
  return data.length > 0;
}

export async function isSkillDuplicate(category, name, excludeId) {
  const client = requireClient();
  let query = client.from("skills").select("id").eq("category", category).ilike("name", name);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query;
  if (error) throw new Error(describeSupabaseError(error, "Could not verify skill"));
  return data.length > 0;
}

function singularize(table) {
  return table.endsWith("s") ? table.slice(0, -1) : table;
}
