// Public, read-only queries. RLS restricts these to published/visible rows only —
// no filtering logic needs to be duplicated here.
//
// Deliberately NOT using supabase-js: these are plain GETs against the same
// PostgREST endpoint with the same publishable key, so behaviour and RLS are
// identical, but public visitors don't download the ~240KB auth/realtime
// client. (The admin area still uses supabase-js via ./client.js.)
//
// Each table is fetched at most once per page load: the homepage renders
// several sections that need the same rows (e.g. projects), and they all
// share one in-flight request.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const cache = new Map();

function rest(path) {
  if (!url || !key) return Promise.resolve(null);
  if (!cache.has(path)) {
    const request = fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    }).then((res) => {
      if (!res.ok) throw new Error(`Supabase ${res.status} for ${path}`);
      return res.json();
    });
    // Don't cache failures — a later caller may retry.
    request.catch(() => cache.delete(path));
    cache.set(path, request);
  }
  return cache.get(path);
}

export async function getProfile() {
  const rows = await rest("profile?select=*&limit=1");
  return rows?.[0] ?? null;
}

export function getExperiences() {
  return rest("experiences?select=*&order=sort_order.asc");
}

export function getSkills() {
  return rest("skills?select=*&order=sort_order.asc");
}

export function getEducation() {
  return rest("education?select=*&order=sort_order.asc");
}

export function getProjects() {
  return rest("projects?select=*&order=sort_order.asc");
}
