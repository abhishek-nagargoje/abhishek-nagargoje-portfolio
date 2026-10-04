"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useMemo, useState, useCallback } from "react";
import Counter from "../Counter";
import { FaJs, FaReact, FaJava, FaGitAlt } from "react-icons/fa";
import {
  SiNextdotjs,
  SiTailwindcss,
  SiAppwrite,
  SiReactrouter,
  SiGreensock,
  SiSupabase,
  SiOpenai,
  SiNodedotjs,
  SiPostgresql,
  SiVercel,
  SiPostman,
} from "react-icons/si";
import {
  HiOutlineSparkles,
  HiOutlineDownload,
  HiOutlineAcademicCap,
  HiOutlineBriefcase,
  HiOutlineLightBulb,
  HiOutlineCode,
} from "react-icons/hi";

import Avatar from "../Avatar";
import Circles from "../Circles";
import { assetPath } from "../../utils/assetPath";
import { fadeIn } from "../../variants";
import { personalInfo, skillsData } from "../../data/personalInfo";
import { projectsData as localProjectsData } from "../../data/projects";
import { getProjects, getExperiences, getSkills, getEducation } from "../../lib/supabase/queries";
import {
  mapProjectRows,
  mapExperienceRows,
  mapEducationRows,
  groupSkillsByCategory,
} from "../../lib/supabase/transform";
import { useCmsData } from "../../lib/supabase/useCmsData";

const fetchProjects = () => getProjects().then(mapProjectRows);
const fetchExperiences = () => getExperiences().then(mapExperienceRows);
const fetchSkillGroups = () => getSkills().then(groupSkillsByCategory);
const fetchEducation = () => getEducation().then(mapEducationRows);

const localSkillGroups = skillsData; // { frontend: [...], backend: [...], ... } — already grouped

const CATEGORY_LABELS = {
  frontend: "Frontend Development",
  backend: "Backend & APIs",
  database: "Database & Backend Services",
  ai_automation: "AI & Automation",
  tools: "Tools",
};
const CATEGORY_ORDER = ["frontend", "backend", "database", "ai_automation", "tools"];

const ICON_BY_SKILL_NAME = {
  "React.js": FaReact,
  "Next.js": SiNextdotjs,
  "JavaScript (ES6+)": FaJs,
  "Tailwind CSS": SiTailwindcss,
  "React Router DOM": SiReactrouter,
  "React Router": SiReactrouter,
  "GSAP Animations": SiGreensock,
  "Supabase": SiSupabase,
  "Appwrite": SiAppwrite,
  "OpenAI API": SiOpenai,
  "Node.js fundamentals": SiNodedotjs,
  "PostgreSQL": SiPostgresql,
  "Git & GitHub": FaGitAlt,
  "Java Fundamentals": FaJava,
  "Vercel": SiVercel,
  "Postman": SiPostman,
};

function buildSkillInfoGroups(skillsByCategory) {
  return CATEGORY_ORDER.filter((cat) => (skillsByCategory[cat] || []).length > 0).map((cat) => ({
    title: CATEGORY_LABELS[cat],
    icons: (skillsByCategory[cat] || []).map((label) => ({
      Icon: ICON_BY_SKILL_NAME[label] || HiOutlineCode,
      label,
    })),
  }));
}

/* ─────────────────────────────────────────────────────────────
   TAB METADATA — static (icons/colours can't live in the database).
   The "info" arrays are CMS-driven at render time; this local copy
   is only the fallback used if Supabase is unreachable.
───────────────────────────────────────────────────────────── */
const TAB_META = [
  { title: "skills", icon: HiOutlineCode, accent: "#818cf8", glow: "rgba(99,102,241,0.20)" },
  { title: "experience", icon: HiOutlineBriefcase, accent: "#34d399", glow: "rgba(52,211,153,0.18)" },
  { title: "education", icon: HiOutlineAcademicCap, accent: "#f472b6", glow: "rgba(244,114,182,0.18)" },
  { title: "goals", icon: HiOutlineLightBulb, accent: "#fbbf24", glow: "rgba(251,191,36,0.18)" },
];

const localSkillsInfo = buildSkillInfoGroups(localSkillGroups);

const localExperienceInfo = [
  {
    title: "Full-Stack Developer & AI Agent Developer",
    stage: "Kargar Business Services — 2026 – Present",
    description:
      "Building production web applications and business websites, integrating backend services and databases, and developing AI-powered workflows and agent integrations for real clients.",
  },
  {
    title: "Developer Intern",
    stage: "Kargar Business Services — 2026",
    description:
      "Completed a development internship at Kargar Business Services, which led to a full-time offer for the Full-Stack Developer & AI Agent Developer role above.",
  },
];

const localEducationInfo = [
  {
    title: "Bachelor of Computer Applications (BCA)",
    stage: "2023 – 2026",
    description: `${personalInfo.education.college}, ${personalInfo.education.university}`,
  },
];

// Not CMS-managed — forward-looking goals stay hand-authored, same as Phase A.
const goalsInfo = [
  {
    title: "Deepen AI Agent Development",
    stage: "Current Focus",
    description:
      "Expanding on AI agent workflows and LLM integrations while shipping production platforms like Skill Guru and other business systems.",
  },
  {
    title: "Higher Education – MCA",
    stage: "2026 Plan",
    description:
      "Planning to pursue MCA through the Maharashtra MCA CET to deepen knowledge in computer science and software development.",
  },
];

// Always shown alongside the CMS-backed education entries — self-learning isn't a
// formal enrollment, so it isn't modeled as an `education` table row.
const selfLearningEntry = {
  title: "Technical Self-Learning",
  stage: "Ongoing",
  description:
    "Focused on advanced React/Next.js development, AI agent integrations, and modern web technologies alongside professional work.",
};

function buildStats(projectsData, skillCount) {
  return [
    { value: projectsData.length, suffix: "+", label: "Projects Built" },
    { value: skillCount, suffix: "+", label: "Technologies" },
    {
      value: projectsData.filter((p) => p.tier === "industry").length,
      suffix: "",
      label: "Industry Projects",
    },
    { value: 2026, suffix: "", label: "Graduation" },
  ];
}

/* ─────────────────────────────────────────────────────────────
   STAT CARD
───────────────────────────────────────────────────────────── */
const StatCard = ({ value, suffix, label, delay }) => (
  <motion.div
    variants={fadeIn("up", delay)}
    initial="hidden"
    whileInView="show"
    viewport={{ once: true, amount: 0.15 }}
    className="relative group flex flex-col items-center justify-center p-5 rounded-2xl
               border border-white/10 bg-white/[0.03]
               hover:border-accent/40 hover:bg-white/[0.06]
               transition-all duration-500 overflow-hidden"
  >
    <div
      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity
                    duration-500 bg-gradient-radial from-accent/10 via-transparent
                    to-transparent pointer-events-none"
    />
    <div className="text-3xl font-black text-accent tabular-nums">
      <Counter to={value} />
      <span className="text-xl">{suffix}</span>
    </div>
    <div className="mt-1 text-[11px] uppercase tracking-[0.15em] text-white/50 font-medium text-center">
      {label}
    </div>
  </motion.div>
);

/* ─────────────────────────────────────────────────────────────
   SKILL CHIP
───────────────────────────────────────────────────────────── */
const SkillChip = ({ Icon, label, accent }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <motion.div
      whileHover={{ scale: 1.15, y: -2 }}
      className="flex flex-col items-center gap-1.5 cursor-default"
      title={label}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-all duration-300"
        style={{
          background: hovered ? `${accent}18` : "rgba(255,255,255,0.05)",
          border: hovered
            ? `1px solid ${accent}55`
            : "1px solid rgba(255,255,255,0.10)",
          boxShadow: hovered ? `0 0 16px ${accent}40` : "none",
        }}
      >
        <Icon
          style={{
            color: hovered ? accent : "rgba(255,255,255,0.70)",
            transition: "color .25s",
          }}
        />
      </div>
      <span
        className="text-[9px] uppercase tracking-wider transition-colors duration-300"
        style={{
          color: hovered ? "rgba(255,255,255,.75)" : "rgba(255,255,255,.55)",
        }}
      >
        {label}
      </span>
    </motion.div>
  );
};

/* ─────────────────────────────────────────────────────────────
   TAB BUTTON
───────────────────────────────────────────────────────────── */
const TabBtn = ({ item, index, active, onClick, onKeyDown }) => {
  const TabIcon = item.icon;
  return (
    <motion.button
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      type="button"
      role="tab"
      id={`about-tab-${index}`}
      aria-selected={active}
      aria-controls="about-tabpanel"
      tabIndex={active ? 0 : -1}
      onKeyDown={onKeyDown}
      className="relative flex items-center gap-2 px-4 py-2 rounded-full text-xs
                 font-semibold uppercase tracking-widest transition-all duration-300
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      style={{
        background: active ? `${item.accent}22` : "rgba(255,255,255,0.05)",
        color: active ? item.accent : "rgba(255,255,255,0.50)",
        border: active
          ? `1px solid ${item.accent}50`
          : "1px solid rgba(255,255,255,0.10)",
        boxShadow: active ? `0 4px 20px ${item.glow}` : "none",
        transform: active ? "translateY(-1px)" : "none",
      }}
    >
      <TabIcon className="text-sm" />
      {item.title}
    </motion.button>
  );
};

/* ─────────────────────────────────────────────────────────────
   INFO ENTRY
───────────────────────────────────────────────────────────── */
const InfoEntry = ({ item, index: i, total, accent }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: i * 0.08, duration: 0.3 }}
      className="group relative"
    >
      <div
        className="flex gap-4 p-4 rounded-xl transition-all duration-300"
        style={{
          background: hovered ? "rgba(255,255,255,0.04)" : "transparent",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="flex flex-col items-center pt-1 shrink-0">
          <div
            className="w-2 h-2 rounded-full transition-all duration-300"
            style={{
              background: hovered ? accent : `${accent}55`,
              boxShadow: hovered ? `0 0 8px ${accent}` : "none",
            }}
          />
          {i < total - 1 && (
            <div className="w-px flex-1 mt-2 bg-gradient-to-b from-white/10 to-transparent" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h3
            className="font-semibold text-sm leading-snug mb-1 transition-colors duration-300"
            style={{ color: hovered ? accent : "#f1f5f9" }}
          >
            {item.title}
          </h3>

          {item.stage && (
            <span
              className="inline-block text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full mb-2"
              style={{
                fontFamily: "var(--font-mono), monospace",
                background: `${accent}15`,
                color: accent,
                border: `1px solid ${accent}30`,
              }}
            >
              {item.stage}
            </span>
          )}

          {item.description && (
            <p className="text-white/50 text-xs leading-relaxed">
              {item.description}
            </p>
          )}

          {item.icons && (
            <div className="flex flex-wrap gap-4 mt-4">
              {item.icons.map(({ Icon, label }) => (
                <SkillChip
                  key={label}
                  Icon={Icon}
                  label={label}
                  accent={accent}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {i < total - 1 && (
        <div className="ml-6 h-px bg-gradient-to-r from-white/5 via-white/10 to-transparent" />
      )}
    </motion.div>
  );
};

/* ─────────────────────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────────────────────── */
const About = ({ embedded = false }) => {
  const Heading = embedded ? motion.h2 : motion.h1;
  const [index, setIndex] = useState(0);

  const { data: projectsData } = useCmsData(fetchProjects, localProjectsData);
  const { data: skillGroups } = useCmsData(fetchSkillGroups, localSkillGroups);
  const { data: experienceInfo } = useCmsData(fetchExperiences, localExperienceInfo);
  const { data: educationRows } = useCmsData(fetchEducation, localEducationInfo);

  const skillsInfo = useMemo(() => buildSkillInfoGroups(skillGroups), [skillGroups]);
  const educationInfo = useMemo(() => [...educationRows, selfLearningEntry], [educationRows]);
  const skillCount = useMemo(() => Object.values(skillGroups).flat().length, [skillGroups]);
  const stats = useMemo(() => buildStats(projectsData, skillCount), [projectsData, skillCount]);

  const aboutData = useMemo(
    () => [
      { ...TAB_META[0], info: skillsInfo },
      { ...TAB_META[1], info: experienceInfo },
      { ...TAB_META[2], info: educationInfo },
      { ...TAB_META[3], info: goalsInfo },
    ],
    [skillsInfo, experienceInfo, educationInfo]
  );

  const currentTab = useMemo(() => aboutData[index], [index, aboutData]);
  const handleTabClick = useCallback((i) => setIndex(i), []);

  return (
    <>
      <section
        id="about"
        aria-labelledby="about-title"
        className={`relative bg-site bg-cover bg-center text-center xl:text-left overflow-hidden ${
          embedded ? "py-20 xl:py-28" : "min-h-screen py-28 xl:py-32"
        }`}
      >
        {/* Ambient blobs — radial gradients (no filter blur) */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
          <div className="absolute -top-40 left-[10%] w-[800px] h-[800px] rounded-full bg-[radial-gradient(circle,rgba(241,48,36,0.06)_0%,transparent_60%)]" />
          <div className="absolute -bottom-40 right-[10%] w-[700px] h-[700px] rounded-full bg-[radial-gradient(circle,rgba(168,85,247,0.06)_0%,transparent_60%)]" />
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                          w-[800px] h-[800px] bg-gradient-radial from-accent/[0.03] to-transparent rounded-full"
          />
        </div>

        <Circles />

        {/* Avatar — standalone page only; on the single-page home the hero
            already shows it, and here it sat on top of the bio/stats. */}
        {!embedded && (
        <motion.div
          variants={fadeIn("right", 0.2)}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.15 }}
          exit="hidden"
          className="hidden xl:flex absolute bottom-0 left-0 w-[380px] h-[520px] pointer-events-none"
          style={{
            maskImage:
              "linear-gradient(to right, black 50%, transparent 100%), linear-gradient(to top, black 60%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to right, black 50%, transparent 100%), linear-gradient(to top, black 60%, transparent 100%)",
            maskComposite: "intersect",
            WebkitMaskComposite: "source-in",
            opacity: 0.55,
          }}
        >
          <Avatar />
        </motion.div>
        )}

        <div className="container mx-auto px-4 xl:px-8 h-full">
          <div className="flex flex-col xl:flex-row gap-12 xl:gap-16 items-start">
            {/* ══ LEFT COLUMN ══ */}
            <div className="flex-1 flex flex-col justify-center z-10 max-w-xl mx-auto xl:mx-0">
              {/* Badge */}
              <motion.div
                variants={fadeIn("down", 0.1)}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.15 }}
                className="inline-flex items-center gap-2 mb-6 px-4 py-1.5 rounded-full
                           border border-accent/30 bg-accent/5 text-accent
                           text-xs font-mono uppercase tracking-widest w-fit mx-auto xl:mx-0"
              >
                <HiOutlineSparkles className="text-sm" />
                About Me
              </motion.div>

              {/* Heading */}
              <Heading
                id="about-title"
                variants={fadeIn("right", 0.2)}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.15 }}
                exit="hidden"
                className="text-4xl xl:text-5xl font-black leading-[1.1] mb-6 tracking-tight"
              >
                Building{" "}
                <span className="relative inline-block">
                  <span className="text-accent">modern</span>
                  <motion.span
                    className="absolute -bottom-1 left-0 h-[3px] bg-gradient-to-r from-accent to-cyan-400 rounded-full"
                    initial={{ width: 0 }}
                    whileInView={{ width: "100%" }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.8, duration: 0.6, ease: "easeOut" }}
                  />
                </span>{" "}
                web apps
                <br />
                <span
                  className="text-3xl xl:text-4xl font-black"
                  style={{
                    WebkitTextStroke: "1px rgba(255,255,255,0.22)",
                    color: "transparent",
                  }}
                >
                  with React & JavaScript
                </span>
                <span className="text-accent">.</span>
              </Heading>

              {/* ── BIO — updated text only, structure identical ── */}
              <motion.p
                variants={fadeIn("right", 0.4)}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.15 }}
                className="text-white/60 text-base leading-relaxed mb-10 max-w-[480px] mx-auto xl:mx-0"
              >
                I am a{" "}
                <span className="text-white/90 font-medium">
                  Full-Stack Developer &amp; AI Agent Developer
                </span>{" "}
                at{" "}
                <span className="text-white/90 font-medium">
                  Kargar Business Services
                </span>
                , where I build production business websites, integrate
                backend services, and develop AI-powered workflows. Currently
                building{" "}
                <span className="text-accent font-medium">Skill Guru</span>,
                an EdTech platform, alongside other business systems.
              </motion.p>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
                {stats.map((s, i) => (
                  <StatCard key={s.label} {...s} delay={0.3 + i * 0.08} />
                ))}
              </div>

              {/* Download CTA */}
              <motion.a
                href={assetPath("/Abhishek_MERN_Resume.pdf")}
                download="Abhishek_MERN_Resume.pdf"
                variants={fadeIn("up", 0.7)}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.15 }}
                whileHover={{ scale: 1.03, y: -2 }}
                whileTap={{ scale: 0.97 }}
                className="group relative flex items-center justify-center gap-3
                           w-full xl:w-auto xl:px-10 py-4 rounded-2xl
                           font-bold text-primary text-sm uppercase tracking-widest
                           overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <span className="absolute inset-0 bg-gradient-to-r from-accent via-accent to-cyan-400" />
                <span className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-accent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-12" />
                <HiOutlineDownload className="relative text-lg" />
                <span className="relative">Download Resume</span>
              </motion.a>
            </div>

            {/* ══ RIGHT COLUMN ══ */}
            <motion.div
              variants={fadeIn("left", 0.3)}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.15 }}
              exit="hidden"
              className="flex flex-col w-full xl:w-[48%] z-10"
            >
              {/* Tab Bar */}
              <div
                className="flex flex-wrap gap-2 mb-6"
                role="tablist"
                aria-label="About sections"
              >
                {aboutData.map((item, i) => (
                  <TabBtn
                    key={item.title}
                    item={item}
                    index={i}
                    active={index === i}
                    onClick={() => handleTabClick(i)}
                    onKeyDown={(e) => {
                      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                      e.preventDefault();
                      const next = (i + (e.key === "ArrowRight" ? 1 : -1) + aboutData.length) % aboutData.length;
                      handleTabClick(next);
                      document.getElementById(`about-tab-${next}`)?.focus();
                    }}
                  />
                ))}
              </div>

              {/* Panel */}
              <div
                className="relative rounded-2xl overflow-hidden min-h-[420px]"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: `1px solid ${currentTab.accent}28`,
                  boxShadow: `0 0 40px ${currentTab.glow}`,
                  transition: "border-color .4s ease, box-shadow .4s ease",
                }}
              >
                {/* Coloured top accent line */}
                <div
                  className="absolute top-0 left-0 right-0 h-[2px]"
                  style={{
                    background: `linear-gradient(90deg, transparent, ${currentTab.accent}85, transparent)`,
                    transition: "background .4s ease",
                  }}
                />

                {/* Panel header */}
                <div className="flex items-center gap-2 px-6 pt-5 pb-4 border-b border-white/[0.06]">
                  {(() => {
                    const Icon = currentTab.icon;
                    return (
                      <Icon
                        style={{
                          color: currentTab.accent,
                          transition: "color .3s",
                        }}
                        className="text-base"
                      />
                    );
                  })()}
                  <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/40">
                    {currentTab.title}
                  </span>
                  <span className="ml-auto text-[10px] font-mono text-white/20">
                    {currentTab.info.length} entries
                  </span>
                </div>

                {/* Scrollable entries */}
                <div
                  className="overflow-y-auto max-h-[400px] px-4 py-4
                                scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10"
                >
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={currentTab.title}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -16 }}
                      transition={{ duration: 0.25, ease: "easeOut" }}
                      role="tabpanel"
                      id="about-tabpanel"
                      aria-labelledby={`about-tab-${index}`}
                      className="space-y-1"
                    >
                      {currentTab.info.map((item, i) => (
                        <InfoEntry
                          key={`${currentTab.title}-${i}`}
                          item={item}
                          index={i}
                          total={currentTab.info.length}
                          accent={currentTab.accent}
                        />
                      ))}
                    </motion.div>
                  </AnimatePresence>
                </div>

                {/* Bottom fade */}
                <div
                  className="absolute bottom-0 left-0 right-0 h-8
                                bg-gradient-to-t from-black/20 to-transparent pointer-events-none"
                />
              </div>

              {/* Footer hint */}
              <motion.p
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.4 }}
                className="mt-3 text-center text-[10px] font-mono text-white/20 uppercase tracking-widest"
              >
                Scroll to explore · Click tabs to navigate
              </motion.p>
            </motion.div>
          </div>
        </div>
      </section>
    </>
  );
};

export default About;
