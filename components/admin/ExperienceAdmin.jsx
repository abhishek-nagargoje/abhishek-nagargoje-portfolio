"use client";
import { useEffect, useState } from "react";
import { listAll, createRow, updateRow, deleteRow } from "../../lib/supabase/admin";
import { Card, Field, Input, TextArea, Checkbox, Button, Banner, EmptyState } from "./ui";

const emptyForm = {
  id: null,
  company: "",
  role: "",
  employment_type: "",
  start_year: "",
  end_year: "",
  is_current: false,
  description: "",
  responsibilities: "",
  sort_order: 0,
  is_published: true,
};

const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

function isValidYear(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= MIN_YEAR && n <= MAX_YEAR;
}

function toFormState(row) {
  return { ...emptyForm, ...row, responsibilities: (row.responsibilities || []).join(", ") };
}

export default function ExperienceAdmin() {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const load = async () => {
    try {
      setRows(await listAll("experiences"));
    } catch (err) {
      setError(err.message || "Could not load experience entries.");
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
    setForm(toFormState(row));
    setError("");
    setSuccess("");
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.company.trim() || !form.role.trim()) return setError("Company and role are required.");
    if (!form.start_year) return setError("Start year is required.");
    if (!isValidYear(form.start_year)) return setError(`Start year must be a valid year between ${MIN_YEAR} and ${MAX_YEAR}.`);
    if (form.is_current && form.end_year) {
      return setError("A current role can't also have an end year — clear one of them.");
    }
    if (!form.is_current && form.end_year) {
      if (!isValidYear(form.end_year)) return setError(`End year must be a valid year between ${MIN_YEAR} and ${MAX_YEAR}.`);
      if (Number(form.end_year) < Number(form.start_year)) return setError("End year can't be earlier than start year.");
    }

    const payload = {
      company: form.company.trim(),
      role: form.role.trim(),
      employment_type: form.employment_type.trim() || null,
      start_year: Number(form.start_year),
      end_year: form.is_current ? null : form.end_year ? Number(form.end_year) : null,
      is_current: form.is_current,
      description: form.description.trim() || null,
      responsibilities: form.responsibilities.split(",").map((s) => s.trim()).filter(Boolean),
      sort_order: Number(form.sort_order) || 0,
      is_published: form.is_published,
    };

    setSaving(true);
    try {
      if (form.id) {
        await updateRow("experiences", form.id, payload);
        setSuccess("Experience updated.");
      } else {
        await createRow("experiences", payload);
        setSuccess("Experience created.");
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
      await deleteRow("experiences", id);
      setConfirmDeleteId(null);
      setSuccess("Experience deleted.");
      await load();
    } catch (err) {
      setError(err.message || "Delete failed.");
    }
  };

  if (form) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">{form.id ? "Edit Experience" : "New Experience"}</h1>
        <Banner type="error">{error}</Banner>
        <form onSubmit={handleSave} className="flex flex-col gap-4 max-w-xl">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Company"><Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></Field>
            <Field label="Role"><Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></Field>
          </div>
          <Field label="Employment Type"><Input value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value })} placeholder="full_time / internship" /></Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Start Year"><Input type="number" value={form.start_year} onChange={(e) => setForm({ ...form, start_year: e.target.value })} required /></Field>
            <Field label="End Year"><Input type="number" value={form.end_year} disabled={form.is_current} onChange={(e) => setForm({ ...form, end_year: e.target.value })} /></Field>
            <Field label="Sort Order"><Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} /></Field>
          </div>
          <Checkbox
            label="This is my current role"
            checked={form.is_current}
            onChange={(e) => setForm({ ...form, is_current: e.target.checked, end_year: e.target.checked ? "" : form.end_year })}
          />
          <Field label="Description"><TextArea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Responsibilities (comma-separated)"><Input value={form.responsibilities} onChange={(e) => setForm({ ...form, responsibilities: e.target.value })} /></Field>
          <Checkbox label="Published" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} />
          <div className="flex gap-3 mt-2">
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            <Button type="button" variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Experience</h1>
        <Button onClick={startCreate}>+ New Experience</Button>
      </div>
      <Banner type="success">{success}</Banner>
      <Banner type="error">{error}</Banner>
      {rows === null ? <p className="text-sm text-white/30">Loading…</p> : rows.length === 0 ? (
        <EmptyState>No experience entries yet.</EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <Card key={row.id} className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-semibold">
                  {row.role} <span className="text-xs text-white/30">— {row.company}</span>
                  {row.is_current && <span className="ml-2 text-xs text-emerald-400">current</span>}
                  {!row.is_published && <span className="ml-2 text-xs text-amber-400">unpublished</span>}
                </p>
                <p className="text-xs text-white/40">
                  {row.start_year}{row.is_current ? " – Present" : row.end_year ? ` – ${row.end_year}` : ""} · sort {row.sort_order}
                </p>
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
