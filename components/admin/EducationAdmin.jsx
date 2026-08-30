"use client";
import { useEffect, useState } from "react";
import { listAll, createRow, updateRow, deleteRow } from "../../lib/supabase/admin";
import { Card, Field, Input, TextArea, Select, Checkbox, Button, Banner, EmptyState } from "./ui";

const STATUSES = ["in_progress", "completed"];
const emptyForm = {
  id: null, institution: "", degree: "", field: "", start_year: "", end_year: "",
  status: "in_progress", description: "", sort_order: 0, is_visible: true,
};

const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

function isValidYear(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= MIN_YEAR && n <= MAX_YEAR;
}

export default function EducationAdmin() {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const load = async () => {
    try {
      setRows(await listAll("education"));
    } catch (err) {
      setError(err.message || "Could not load education entries.");
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
    if (!form.institution.trim() || !form.degree.trim()) return setError("Institution and degree are required.");

    if (form.start_year && !isValidYear(form.start_year)) {
      return setError(`Start year must be a valid year between ${MIN_YEAR} and ${MAX_YEAR}.`);
    }
    if (form.end_year) {
      if (!isValidYear(form.end_year)) {
        return setError(`End year must be a valid year between ${MIN_YEAR} and ${MAX_YEAR}.`);
      }
      if (form.start_year && Number(form.end_year) < Number(form.start_year)) {
        return setError("End year can't be earlier than start year.");
      }
    }

    const payload = {
      institution: form.institution.trim(),
      degree: form.degree.trim(),
      field: form.field.trim() || null,
      start_year: form.start_year ? Number(form.start_year) : null,
      end_year: form.end_year ? Number(form.end_year) : null,
      status: form.status,
      description: form.description.trim() || null,
      sort_order: Number(form.sort_order) || 0,
      is_visible: form.is_visible,
    };

    setSaving(true);
    try {
      if (form.id) {
        await updateRow("education", form.id, payload);
        setSuccess("Education updated.");
      } else {
        await createRow("education", payload);
        setSuccess("Education created.");
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
      await deleteRow("education", id);
      setConfirmDeleteId(null);
      setSuccess("Education deleted.");
      await load();
    } catch (err) {
      setError(err.message || "Delete failed.");
    }
  };

  if (form) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">{form.id ? "Edit Education" : "New Education"}</h1>
        <Banner type="error">{error}</Banner>
        <form onSubmit={handleSave} className="flex flex-col gap-4 max-w-xl">
          <Field label="Institution"><Input value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Degree"><Input value={form.degree} onChange={(e) => setForm({ ...form, degree: e.target.value })} /></Field>
            <Field label="Field of Study"><Input value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Start Year"><Input type="number" value={form.start_year} onChange={(e) => setForm({ ...form, start_year: e.target.value })} /></Field>
            <Field label="End Year"><Input type="number" value={form.end_year} onChange={(e) => setForm({ ...form, end_year: e.target.value })} /></Field>
            <Field label="Status">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Description"><TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Education</h1>
        <Button onClick={startCreate}>+ New Education</Button>
      </div>
      <Banner type="success">{success}</Banner>
      <Banner type="error">{error}</Banner>
      {rows === null ? <p className="text-sm text-white/30">Loading…</p> : rows.length === 0 ? (
        <EmptyState>No education entries yet.</EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <Card key={row.id} className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-semibold">
                  {row.degree}
                  {!row.is_visible && <span className="ml-2 text-xs text-amber-400">hidden</span>}
                </p>
                <p className="text-xs text-white/40">
                  {row.institution} · {row.status} · {row.start_year || "—"}
                  {row.end_year ? ` – ${row.end_year}` : ""} · sort {row.sort_order}
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
