"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase/client";
import { getSession } from "../../lib/supabase/auth";
import { Card, Banner } from "./ui";

const SECTIONS = [
  { label: "Projects", path: "/admin/projects" },
  { label: "Experience", path: "/admin/experience" },
  { label: "Skills", path: "/admin/skills" },
  { label: "Education", path: "/admin/education" },
  { label: "Profile", path: "/admin/profile" },
];

export default function Dashboard() {
  const [counts, setCounts] = useState(null);
  const [email, setEmail] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (!supabase) {
        setError("Supabase is not configured (missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).");
        return;
      }
      try {
        const [projects, experiences, skills, education, session] = await Promise.all([
          supabase.from("projects").select("tier, is_published"),
          supabase.from("experiences").select("id"),
          supabase.from("skills").select("id"),
          supabase.from("education").select("id"),
          getSession(),
        ]);

        const firstError = projects.error || experiences.error || skills.error || education.error;
        if (firstError) throw firstError;

        const projectRows = projects.data || [];
        setCounts({
          totalProjects: projectRows.length,
          publishedProjects: projectRows.filter((p) => p.is_published).length,
          currentProjects: projectRows.filter((p) => p.tier === "current").length,
          experiences: (experiences.data || []).length,
          skills: (skills.data || []).length,
          education: (education.data || []).length,
        });
        setEmail(session?.user?.email || null);
      } catch (err) {
        setError(err.message || "Could not load dashboard data.");
      }
    }
    load();
  }, []);

  const tiles = counts
    ? [
        { label: "Total Projects", value: counts.totalProjects },
        { label: "Published Projects", value: counts.publishedProjects },
        { label: "Currently Building", value: counts.currentProjects },
        { label: "Experience Entries", value: counts.experiences },
        { label: "Skills", value: counts.skills },
        { label: "Education Entries", value: counts.education },
      ]
    : [];

  return (
    <div>
      <div className="flex items-start justify-between mb-1 gap-4 flex-wrap">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        {email && (
          <span
            className="text-xs px-3 py-1.5 rounded-full"
            style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)", color: "#6ee7b7" }}
          >
            Signed in as {email}
          </span>
        )}
      </div>
      <p className="text-sm text-white/40 mb-6">CMS content overview — not analytics.</p>

      <Banner type="error">{error}</Banner>

      {!counts ? (
        error ? null : <p className="text-sm text-white/30">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-10">
          {tiles.map((t) => (
            <Card key={t.label}>
              <p className="text-3xl font-black">{t.value}</p>
              <p className="text-xs text-white/40 mt-1">{t.label}</p>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs uppercase tracking-widest text-white/30 mb-3">Manage Content</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {SECTIONS.map((s) => (
          <Link key={s.path} href={s.path}>
            <Card className="hover:border-white/20 transition-colors">
              <p className="text-sm font-medium">{s.label}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
