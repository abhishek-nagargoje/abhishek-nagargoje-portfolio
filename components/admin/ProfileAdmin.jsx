"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase/client";
import { describeSupabaseError } from "../../lib/supabase/admin";
import { Field, Input, TextArea, Button, Banner } from "./ui";

const emptyForm = {
  id: 1,
  name: "",
  role: "",
  tagline: "",
  about_summary: "",
  location: "",
  email: "",
  company: "",
  github_url: "",
  linkedin_url: "",
  resume_url: "",
  avatar_url: "",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isSafeUrl(value) {
  if (!value) return true; // empty is allowed
  try {
    const url = new URL(value, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    // Relative paths like "/avatar.png" or "/resume.pdf" are valid and safe.
    return value.startsWith("/") && !value.startsWith("//");
  }
}

export default function ProfileAdmin() {
  const [form, setForm] = useState(null);
  const [exists, setExists] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setError("Supabase is not configured (missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).");
      return;
    }
    supabase
      .from("profile")
      .select("*")
      .maybeSingle()
      .then(({ data, error: fetchError }) => {
        if (fetchError) {
          setError(describeSupabaseError(fetchError, "Could not load profile"));
          return;
        }
        if (data) {
          setForm(data);
          setExists(true);
        } else {
          setForm({ ...emptyForm });
          setExists(false);
        }
      })
      .catch((err) => {
        setError(err.message || "Could not load profile — network error.");
      });
  }, []);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const name = form.name.trim().replace(/\s+/g, " ");
    const role = form.role.trim().replace(/\s+/g, " ");
    if (!name) return setError("Name is required.");
    if (!role) return setError("Role is required.");
    if (form.email && !EMAIL_RE.test(form.email.trim())) return setError("Email is not a valid email address.");

    for (const [label, key] of [
      ["GitHub URL", "github_url"],
      ["LinkedIn URL", "linkedin_url"],
      ["Resume URL", "resume_url"],
      ["Avatar URL", "avatar_url"],
    ]) {
      if (!isSafeUrl(form[key])) return setError(`${label} must be a plain http(s) URL or a site-relative path.`);
    }

    const payload = {
      name,
      role,
      tagline: form.tagline?.trim() || null,
      about_summary: form.about_summary?.trim() || null,
      location: form.location?.trim() || null,
      email: form.email?.trim() || null,
      company: form.company?.trim() || null,
      github_url: form.github_url?.trim() || null,
      linkedin_url: form.linkedin_url?.trim() || null,
      resume_url: form.resume_url?.trim() || null,
      avatar_url: form.avatar_url?.trim() || null,
    };

    setSaving(true);
    try {
      if (exists) {
        const { error } = await supabase
          .from("profile")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", 1);
        if (error) throw error;
        setSuccess("Profile updated.");
      } else {
        const { error } = await supabase.from("profile").insert({ id: 1, ...payload });
        if (error) throw error;
        setSuccess("Profile created.");
        setExists(true);
      }
    } catch (err) {
      setError(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  if (!form) {
    return error ? (
      <Banner type="error">{error}</Banner>
    ) : (
      <p className="text-sm text-white/30">Loading…</p>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Profile</h1>
      <p className="text-sm text-white/40 mb-6">
        {exists ? "Editing the single site-wide profile record." : "No profile exists yet — create the initial record."}
      </p>
      <Banner type="success">{success}</Banner>
      <Banner type="error">{error}</Banner>
      <form onSubmit={handleSave} className="flex flex-col gap-4 max-w-xl">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name"><Input value={form.name || ""} onChange={set("name")} /></Field>
          <Field label="Role"><Input value={form.role || ""} onChange={set("role")} /></Field>
        </div>
        <Field label="Tagline"><Input value={form.tagline || ""} onChange={set("tagline")} /></Field>
        <Field label="About Summary"><TextArea rows={4} value={form.about_summary || ""} onChange={set("about_summary")} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Location"><Input value={form.location || ""} onChange={set("location")} /></Field>
          <Field label="Email"><Input type="email" value={form.email || ""} onChange={set("email")} /></Field>
        </div>
        <Field label="Company"><Input value={form.company || ""} onChange={set("company")} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="GitHub URL"><Input value={form.github_url || ""} onChange={set("github_url")} /></Field>
          <Field label="LinkedIn URL"><Input value={form.linkedin_url || ""} onChange={set("linkedin_url")} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Resume URL"><Input value={form.resume_url || ""} onChange={set("resume_url")} /></Field>
          <Field label="Avatar URL"><Input value={form.avatar_url || ""} onChange={set("avatar_url")} /></Field>
        </div>
        <div>
          <Button type="submit" disabled={saving}>{saving ? "Saving…" : exists ? "Save" : "Create Profile"}</Button>
        </div>
      </form>
    </div>
  );
}
