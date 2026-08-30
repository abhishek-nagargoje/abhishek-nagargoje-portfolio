"use client";
import { useEffect, useState } from "react";
import { listAll, createRow, updateRow, deleteRow, isSlugTaken } from "../../lib/supabase/admin";
import { uploadProjectImage, validateImageFile, deleteProjectImageByUrl } from "../../lib/supabase/storage";
import { Card, Field, Input, TextArea, Select, Checkbox, Button, Banner, EmptyState } from "./ui";

const TIERS = ["industry", "current", "personal"];
const STATUSES = ["Completed / Production", "Currently Building", "Live", "Archived"];

const emptyForm = {
  id: null,
  slug: "",
  title: "",
  company: "",
  tier: "industry",
  category: "",
  role: "",
  status: "Completed / Production",
  short_description: "",
  description: "",
  tech_stack: "",
  features: "",
  live_url: "",
  github_url: "",
  thumbnail_url: "",
  achievement: "",
  featured: false,
  sort_order: 0,
  is_published: true,
};

function isValidUrl(value) {
  if (!value) return true; // empty is allowed
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function toFormState(row) {
  return {
    ...emptyForm,
    ...row,
    tech_stack: (row.tech_stack || []).join(", "),
    features: (row.features || []).join(", "),
    company: row.company || "",
    category: row.category || "",
    role: row.role || "",
    short_description: row.short_description || "",
    description: row.description || "",
    live_url: row.live_url || "",
    github_url: row.github_url || "",
    thumbnail_url: row.thumbnail_url || "",
    achievement: row.achievement || "",
  };
}

export default function ProjectsAdmin() {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null); // null = list view, object = editing/creating
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("all");

  const load = async () => {
    try {
      const data = await listAll("projects");
      setRows(data);
    } catch (err) {
      setError(err.message || "Could not load projects.");
      setRows([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const startCreate = () => {
    setForm({ ...emptyForm });
    setError("");
    setSuccess("");
  };

  const startEdit = (row) => {
    setForm(toFormState(row));
    setError("");
    setSuccess("");
  };

  const cancel = () => setForm(null);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setUploading(true);
    setError("");
    try {
      const url = await uploadProjectImage(form.slug || "project", file);
      setForm((f) => ({ ...f, thumbnail_url: url }));
    } catch (err) {
      setError(err.message || "Image upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");

    const slug = form.slug.trim().toLowerCase();
    if (!form.title.trim()) return setError("Title is required.");
    if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      return setError("Slug is required and must be lowercase letters, numbers, and hyphens only.");
    }
    if (!form.status) return setError("Status is required.");
    if (!isValidUrl(form.live_url)) return setError("Live URL is not a valid URL.");
    if (!isValidUrl(form.github_url)) return setError("GitHub URL is not a valid URL.");

    const taken = await isSlugTaken(slug, form.id);
    if (taken) return setError("This slug is already used by another project.");

    const payload = {
      slug,
      title: form.title.trim(),
      company: form.company.trim() || null,
      tier: form.tier,
      category: form.category.trim() || null,
      role: form.role.trim() || null,
      status: form.status,
      short_description: form.short_description.trim() || null,
      description: form.description.trim() || null,
      tech_stack: form.tech_stack.split(",").map((s) => s.trim()).filter(Boolean),
      features: form.features.split(",").map((s) => s.trim()).filter(Boolean),
      live_url: form.live_url.trim() || null,
      github_url: form.github_url.trim() || null,
      thumbnail_url: form.thumbnail_url.trim() || null,
      achievement: form.achievement.trim() || null,
      featured: form.featured,
      sort_order: Number(form.sort_order) || 0,
      is_published: form.is_published,
    };

    setSaving(true);
    try {
      if (form.id) {
        await updateRow("projects", form.id, payload);
        setSuccess("Project updated.");
      } else {
        await createRow("projects", payload);
        setSuccess("Project created.");
      }
      await load();
      setForm(null);
    } catch (err) {
      setError(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      const row = rows.find((r) => r.id === id);
      await deleteRow("projects", id);
      if (row?.thumbnail_url) await deleteProjectImageByUrl(row.thumbnail_url);
      setConfirmDeleteId(null);
      await load();
    } catch (err) {
      setError(err.message || "Delete failed.");
    }
  };

  if (form) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">{form.id ? "Edit Project" : "New Project"}</h1>
        <Banner type="error">{error}</Banner>
        <form onSubmit={handleSave} className="flex flex-col gap-4 max-w-2xl">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Title">
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </Field>
            <Field label="Slug">
              <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Tier">
              <Select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
                {TIERS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field label="Sort Order">
              <Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Company">
              <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            </Field>
            <Field label="Category">
              <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </Field>
          </div>
          <Field label="Role">
            <Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
          </Field>
          <Field label="Short Description">
            <TextArea value={form.short_description} onChange={(e) => setForm({ ...form, short_description: e.target.value })} />
          </Field>
          <Field label="Description">
            <TextArea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Tech Stack (comma-separated — leave blank if unverified)">
            <Input value={form.tech_stack} onChange={(e) => setForm({ ...form, tech_stack: e.target.value })} />
          </Field>
          <Field label="Features (comma-separated)">
            <Input value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Live URL">
              <Input value={form.live_url} onChange={(e) => setForm({ ...form, live_url: e.target.value })} placeholder="Leave blank if not live" />
            </Field>
            <Field label="GitHub URL">
              <Input value={form.github_url} onChange={(e) => setForm({ ...form, github_url: e.target.value })} placeholder="Leave blank if no public repo" />
            </Field>
          </div>
          <Field label="Achievement badge (optional)">
            <Input value={form.achievement} onChange={(e) => setForm({ ...form, achievement: e.target.value })} />
          </Field>
          <Field label="Project Thumbnail">
            <div className="flex flex-col gap-2">
              {form.thumbnail_url ? (
                <div className="flex items-center gap-3">
                  <img
                    src={form.thumbnail_url}
                    alt="Current thumbnail preview"
                    className="w-28 h-20 object-cover rounded-lg"
                    style={{ border: "1px solid rgba(255,255,255,0.12)" }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setForm((f) => ({ ...f, thumbnail_url: "" }))}
                  >
                    Remove image
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-white/30">No image — the designed fallback will be used.</p>
              )}
              <Input value={form.thumbnail_url} onChange={(e) => setForm({ ...form, thumbnail_url: e.target.value })} placeholder="Or paste an image URL directly" />
              <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={handleFileChange} disabled={uploading} className="text-xs text-white/50" />
              {uploading && <p className="text-xs text-white/40">Uploading…</p>}
            </div>
          </Field>
          <div className="flex gap-6">
            <Checkbox label="Featured" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} />
            <Checkbox label="Published" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} />
          </div>
          <div className="flex gap-3 mt-2">
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            <Button type="button" variant="ghost" onClick={cancel}>Cancel</Button>
          </div>
        </form>
      </div>
    );
  }

  const filteredRows = (rows || []).filter((row) => {
    const matchesTier = tierFilter === "all" || row.tier === tierFilter;
    const matchesSearch =
      !search.trim() || row.title.toLowerCase().includes(search.trim().toLowerCase()) || row.slug.includes(search.trim().toLowerCase());
    return matchesTier && matchesSearch;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Projects</h1>
        <Button onClick={startCreate}>+ New Project</Button>
      </div>
      <Banner type="success">{success}</Banner>
      <Banner type="error">{error}</Banner>

      {rows !== null && rows.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-4">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title or slug…"
            style={{ maxWidth: "260px" }}
          />
          <Select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} style={{ maxWidth: "180px" }}>
            <option value="all">All tiers</option>
            {TIERS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </div>
      )}

      {rows === null ? (
        <p className="text-sm text-white/30">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState>No projects yet.</EmptyState>
      ) : filteredRows.length === 0 ? (
        <EmptyState>No projects match your search.</EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredRows.map((row) => (
            <Card key={row.id} className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-semibold">
                  {row.title} <span className="text-xs text-white/30">({row.tier})</span>
                  {row.featured && <span className="ml-2 text-xs text-indigo-300">featured</span>}
                  {!row.is_published && <span className="ml-2 text-xs text-amber-400">unpublished</span>}
                </p>
                <p className="text-xs text-white/40">{row.status} · /{row.slug}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => startEdit(row)}>Edit</Button>
                {confirmDeleteId === row.id ? (
                  <>
                    <Button variant="danger" onClick={() => handleDelete(row.id)}>Confirm delete</Button>
                    <Button variant="ghost" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
                  </>
                ) : (
                  <Button variant="danger" onClick={() => setConfirmDeleteId(row.id)}>Delete</Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
