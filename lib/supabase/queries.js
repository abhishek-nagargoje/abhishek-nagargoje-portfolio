import { supabase } from "./client";

// Public, read-only queries. RLS restricts these to published/visible rows only —
// no filtering logic needs to be duplicated here.

export async function getProfile() {
  if (!supabase) return null;
  const { data, error } = await supabase.from("profile").select("*").single();
  if (error) throw error;
  return data;
}

export async function getExperiences() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("experiences")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getSkills() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("skills")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getEducation() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("education")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getProjects() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data;
}
