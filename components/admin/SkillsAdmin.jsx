"use client";
import { useEffect, useState } from "react";
import { listAll, createRow, updateRow, deleteRow, isSkillDuplicate } from "../../lib/supabase/admin";
import { Card, Field, Input, Select, Checkbox, Button, Banner, EmptyState } from "./ui";

const CATEGORIES = ["frontend", "backend", "database", "ai_automation", "tools"];
const emptyForm = { id: null, category: "frontend", name: "", sort_order: 0, is_visible: true };

export default function SkillsAdmin() {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState("all");

  const load = async () => {
    try {
      setRows(await listAll("skills", "category"));
    } catch (err) {
      setError(err.message || "Could not load skills.");
      setRows([]);
    }
  };
  useEffect(() => { load(); }, []);

  const startCreate = () => {
    setForm({ ...emptyForm });
    setError("");
    setSuccess("");
  };

  const startEdit = (row) => {
    setForm({ ...row });
    setError("");
    setSuccess("");
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");

    const name = form.name.trim().replace(/\s+/g, " ");
    if (!name) return setError("Skill name is required.");
    if (!CATEGORIES.includes(form.category)) return setError("Category must be one of the existing controlled categories.");

    const duplicate = await isSkillDuplicate(form.category, name, form.id);
    if (duplicate) return setError("This skill already exists in that category.");

    const payload = {
      category: form.category,
      name,
      sort_order: Number(form.sort_order) || 0,
      is_visible: form.is_visible,
    };

    setSaving(true);
    try {
      if (form.id) {
        await updateRow("skills", form.id, payload);
        setSuccess("Skill updated.");
      } else {
        await createRow("skills", payload);
        setSuccess("Skill created.");
      }
      await load();
      setForm(null);
    } catch (err) {
      setError(err.message?.includes("duplicate") ? "This skill already exists in that category." : err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteRow("skills", id);
      setConfirmDeleteId(null);
      setSuccess("Skill deleted.");
      await load();
    } catch (err) {
      setError(err.message || "Delete failed.");
    }
  };

  if (form) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">{form.id ? "Edit Skill" : "New Skill"}</h1>
        <Banner type="error">{error}</Banner>
        <form onSubmit={handleSave} className="flex flex-col gap-4 max-w-md">
          <Field label="Category">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Sort Order"><Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} /></Field>
          <Checkbox label="Visible" checked={form.is_visible} onChange={(e) => setForm({ ...form, is_visible: e.target.checked })} />
          <div className="flex gap-3 mt-2">
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            <Button type="button" variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
          </div>
        </form>
      </div>
    );
  }

  const filteredRows = (rows || []).filter(
    (row) => categoryFilter === "all" || row.category === categoryFilter
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Skills</h1>
        <Button onClick={startCreate}>+ New Skill</Button>
      </div>
      <Banner type="success">{success}</Banner>
      <Banner type="error">{error}</Banner>

      {rows !== null && rows.length > 0 && (
        <div className="mb-4">
          <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ maxWidth: "220px" }}>
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
      )}

      {rows === null ? (
        <p className="text-sm text-white/30">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState>No skills yet.</EmptyState>
      ) : filteredRows.length === 0 ? (
        <EmptyState>No skills in this category.</EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredRows.map((row) => (
            <Card key={row.id} className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-semibold">
                  {row.name}
                  {!row.is_visible && <span className="ml-2 text-xs text-amber-400">hidden</span>}
                </p>
                <p className="text-xs text-white/40">{row.category} · sort {row.sort_order}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => startEdit(row)}>Edit</Button>
                {confirmDeleteId === row.id ? (
                  <>
                    <Button variant="danger" onClick={() => handleDelete(row.id)}>Confirm delete</Button>
                    <Button variant="ghost" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
                  </>
                ) : <Button variant="danger" onClick={() => setConfirmDeleteId(row.id)}>Delete</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
