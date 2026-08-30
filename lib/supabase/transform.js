// Normalizes raw Supabase rows into the same shapes the existing (Phase A) UI
// components already render, so component JSX doesn't need to change — only
// where the data comes from.

export function mapProjectRow(row) {
  return {
    id: row.slug,
    title: row.title,
    company: row.company,
    tier: row.tier,
    category: row.category,
    role: row.role,
    status: row.status,
    shortDescription: row.short_description,
    description: row.description,
    techStack: row.tech_stack || [],
    features: row.features || [],
    achievement: row.achievement || undefined,
    featured: row.featured,
    thumbnail: row.thumbnail_url || null,
    links: { live: row.live_url || null, github: row.github_url || null },
  };
}

export function mapProjectRows(rows) {
  return (rows || []).map(mapProjectRow);
}

function formatYearRange(start, end, isCurrent) {
  if (!start) return isCurrent ? "Present" : "";
  if (isCurrent) return `${start} – Present`;
  if (end) return `${start} – ${end}`;
  return `${start}`;
}

export function mapExperienceRow(row) {
  const years = formatYearRange(row.start_year, row.end_year, row.is_current);
  return {
    title: row.role,
    company: row.company,
    years,
    stage: `${row.company} — ${years}`,
    description: row.description,
    current: row.is_current,
  };
}

export function mapExperienceRows(rows) {
  return (rows || []).map(mapExperienceRow);
}

export function mapEducationRow(row) {
  const stage = formatYearRange(row.start_year, row.end_year, row.status === "in_progress" && !row.end_year);
  const description = [row.institution, row.field].filter(Boolean).join(", ");
  return { title: row.degree, stage, description };
}

export function mapEducationRows(rows) {
  return (rows || []).map(mapEducationRow);
}

// category -> curated { Icon, } lookup lives in the component (icons can't be
// stored in the database); this just groups the raw name/category rows.
export function groupSkillsByCategory(rows) {
  const groups = {};
  for (const row of rows || []) {
    if (!groups[row.category]) groups[row.category] = [];
    groups[row.category].push(row.name);
  }
  return groups;
}

export function mapProfileRow(row) {
  if (!row) return null;
  return {
    name: row.name,
    role: row.role,
    tagline: row.tagline,
    aboutSummary: row.about_summary,
    location: row.location,
    email: row.email,
    company: row.company,
    github: row.github_url,
    linkedin: row.linkedin_url,
    resumePath: row.resume_url,
    avatarUrl: row.avatar_url,
  };
}
