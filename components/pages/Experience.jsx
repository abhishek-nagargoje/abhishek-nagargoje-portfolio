"use client";
import { motion } from "framer-motion";
import {
  HiOutlineBriefcase,
  HiOutlineCodeBracket,
  HiOutlineCircleStack,
  HiOutlineSparkles,
  HiOutlineArrowUpRight,
} from "react-icons/hi2";
import { personalInfo } from "../../data/personalInfo";
import { projectsData as localProjectsData } from "../../data/projects";
import { getExperiences, getProjects } from "../../lib/supabase/queries";
import { mapExperienceRows, mapProjectRows } from "../../lib/supabase/transform";
import { useCmsData } from "../../lib/supabase/useCmsData";

const fetchExperiences = () => getExperiences().then(mapExperienceRows);
const fetchIndustryProjects = () =>
  getProjects()
    .then(mapProjectRows)
    .then((rows) => rows.filter((p) => p.tier === "industry"));

const GridBackground = () => (
  <div
    aria-hidden
    className="pointer-events-none fixed inset-0 z-0"
    style={{
      backgroundImage: `
        linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)
      `,
      backgroundSize: "72px 72px",
    }}
  />
);

const AmbientGlow = () => (
  <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
    <div style={{
      position: "absolute", top: "-15%", right: "-8%",
      width: "560px", height: "560px", borderRadius: "50%",
      background: "radial-gradient(circle, rgba(52,211,153,0.12) 0%, transparent 70%)",
      filter: "blur(50px)",
    }} />
    <div style={{
      position: "absolute", bottom: "5%", left: "-6%",
      width: "460px", height: "460px", borderRadius: "50%",
      background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)",
      filter: "blur(60px)",
    }} />
  </div>
);

const responsibilityGroups = [
  {
    icon: HiOutlineCodeBracket,
    title: "Full-Stack & Frontend Development",
    items: [
      "Full-stack web application development",
      "Production business website development",
      "Frontend architecture with React.js & Next.js",
      "Responsive, performance-focused UI development",
    ],
  },
  {
    icon: HiOutlineCircleStack,
    title: "Backend, Data & Deployment",
    items: [
      "Backend & API integration",
      "Database integration with Supabase",
      "Authentication flows",
      "Deployment on Vercel",
    ],
  },
  {
    icon: HiOutlineSparkles,
    title: "AI & Automation",
    items: [
      "AI agent development",
      "AI-powered workflows",
      "LLM / AI API integration",
    ],
  },
];

const localRoles = [
  {
    title: "Full-Stack Developer & AI Agent Developer",
    company: "Kargar Business Services",
    years: "2026 – Present",
    current: true,
    description:
      "Building production web applications and business websites, integrating backend services and databases, and developing AI-powered workflows and agent integrations for real clients.",
  },
  {
    title: "Developer Intern",
    company: "Kargar Business Services",
    years: "2026",
    current: false,
    description:
      "Completed a development internship that led directly to the full-time Full-Stack Developer & AI Agent Developer role above.",
  },
];

const localIndustryProjects = localProjectsData.filter((p) => p.tier === "industry");

const Experience = () => {
  const { data: roles } = useCmsData(fetchExperiences, localRoles);
  const { data: industryProjects } = useCmsData(fetchIndustryProjects, localIndustryProjects);

  return (
    <>
      <style>{`
        * { font-family: 'Syne', sans-serif; box-sizing: border-box; }
        .mono { font-family: 'JetBrains Mono', monospace !important; }
        ::selection { background: rgba(52,211,153,0.3); }
        ::-webkit-scrollbar { width: 6px; background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(52,211,153,0.35); border-radius: 3px; }
      `}</style>

      <div className="relative min-h-screen" style={{ background: "#080b14", color: "#f1f5f9" }}>
        <GridBackground />
        <AmbientGlow />

        <div className="relative z-10 max-w-6xl mx-auto px-6 py-28 md:py-36">
          {/* Header */}
          <div className="mb-16">
            <motion.p
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
              className="text-xs uppercase tracking-widest mb-4"
              style={{ color: "#34d399", letterSpacing: "0.14em" }}
            >
              Career
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="text-5xl md:text-7xl font-black tracking-tight leading-none mb-6"
              style={{ letterSpacing: "-0.03em" }}
            >
              Work
              <br />
              <span style={{ WebkitTextStroke: "1px rgba(255,255,255,0.22)", color: "transparent" }}>
                Experience
              </span>
              <span style={{ color: "#34d399" }}>.</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="max-w-lg text-base leading-relaxed"
              style={{ color: "rgba(255,255,255,0.4)" }}
            >
              From development intern to Full-Stack Developer &amp; AI Agent Developer
              at {personalInfo.company}.
            </motion.p>
          </div>

          {/* Timeline */}
          <div className="flex flex-col gap-6 mb-20">
            {roles.map((role, i) => (
              <motion.div
                key={role.title}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 + i * 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="relative rounded-2xl p-7 md:p-9"
                style={{
                  background: role.current
                    ? "linear-gradient(135deg, rgba(52,211,153,0.1) 0%, rgba(255,255,255,0.02) 100%)"
                    : "linear-gradient(135deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.015) 100%)",
                  border: role.current
                    ? "1px solid rgba(52,211,153,0.3)"
                    : "1px solid rgba(255,255,255,0.08)",
                  backdropFilter: "blur(20px)",
                }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        background: role.current ? "rgba(52,211,153,0.15)" : "rgba(255,255,255,0.06)",
                        border: `1px solid ${role.current ? "rgba(52,211,153,0.35)" : "rgba(255,255,255,0.1)"}`,
                      }}
                    >
                      <HiOutlineBriefcase style={{ color: role.current ? "#34d399" : "rgba(255,255,255,0.5)" }} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold leading-snug" style={{ color: "#f1f5f9" }}>
                        {role.title}
                      </h3>
                      <p className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>
                        {role.company}
                      </p>
                    </div>
                  </div>
                  <span
                    className="text-xs font-mono px-3 py-1.5 rounded-full shrink-0"
                    style={{
                      background: role.current ? "rgba(52,211,153,0.15)" : "rgba(255,255,255,0.06)",
                      color: role.current ? "#6ee7b7" : "rgba(255,255,255,0.5)",
                      border: `1px solid ${role.current ? "rgba(52,211,153,0.3)" : "rgba(255,255,255,0.1)"}`,
                    }}
                  >
                    {role.current ? "Current" : "Previously"} · {role.years}
                  </span>
                </div>
                <p className="text-sm leading-relaxed ml-13 pl-0 md:pl-13" style={{ color: "rgba(255,255,255,0.55)" }}>
                  {role.description}
                </p>
              </motion.div>
            ))}
          </div>

          {/* Responsibility groups */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mb-20"
          >
            <div className="flex items-center gap-3 mb-8">
              <span className="text-xs uppercase tracking-widest" style={{ color: "#34d399", letterSpacing: "0.14em" }}>
                What I Work On
              </span>
              <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.07)" }} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {responsibilityGroups.map((group) => (
                <div
                  key={group.title}
                  className="rounded-2xl p-6"
                  style={{
                    background: "linear-gradient(135deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.015) 100%)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                    style={{ background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.3)" }}
                  >
                    <group.icon style={{ color: "#34d399" }} />
                  </div>
                  <h4 className="text-sm font-semibold mb-3" style={{ color: "#f1f5f9" }}>{group.title}</h4>
                  <ul className="space-y-2">
                    {group.items.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
                        <span className="w-1 h-1 rounded-full mt-1.5 shrink-0" style={{ background: "#34d399" }} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Work delivered */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            <div className="flex items-center gap-3 mb-8">
              <span className="text-xs uppercase tracking-widest" style={{ color: "#34d399", letterSpacing: "0.14em" }}>
                Work Delivered In This Role
              </span>
              <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.07)" }} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {industryProjects.map((project) => (
                <a
                  key={project.id}
                  href={project.links.live}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group flex items-center justify-between gap-3 rounded-xl p-5 transition-all duration-200"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(52,211,153,0.4)"; e.currentTarget.style.background = "rgba(52,211,153,0.05)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                >
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>{project.title}</p>
                    <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>{project.category}</p>
                  </div>
                  <HiOutlineArrowUpRight
                    className="shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    style={{ color: "rgba(255,255,255,0.3)" }}
                  />
                </a>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </>
  );
};

export default Experience;
