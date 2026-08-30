"use client";

import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect, useState } from "react";
import ParticlesContainer from "../ParticlesContainer";
import ProjectsBtn from "../ProjectsBtn";
import Avatar from "../Avatar";
import { personalInfo, skillsData } from "../../data/personalInfo";
import { projectsData as localProjectsData } from "../../data/projects";
import { getProjects, getSkills } from "../../lib/supabase/queries";
import { mapProjectRows } from "../../lib/supabase/transform";
import { useCmsData } from "../../lib/supabase/useCmsData";

const quickSkills = ["React.js", "Next.js", "Tailwind CSS", "Supabase", "AI / LLM APIs"];

const localSkillNames = Object.values(skillsData).flat();
const fetchProjects = () => getProjects().then(mapProjectRows);
const fetchSkillNames = () => getSkills().then((rows) => (rows || []).map((r) => r.name));

const Counter = ({ to, suffix = "" }) => {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) => Math.round(v) + suffix);
  useEffect(() => {
    const c = animate(count, to, { duration: 2, ease: "easeOut" });
    return c.stop;
  }, [to]);
  return <motion.span>{rounded}</motion.span>;
};

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};

const slideIn = {
  hidden: { opacity: 0, x: 50 },
  show: { opacity: 1, x: 0, transition: { duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.3 } },
};

export default function Home() {
  const [hovered, setHovered] = useState(null);
  const { data: projectsData } = useCmsData(fetchProjects, localProjectsData);
  const { data: skillNames } = useCmsData(fetchSkillNames, localSkillNames);

  // This is a long-lived static export (built once, served for months on
  // GitHub Pages) — reading the year directly during render would diverge
  // between the build-time server HTML and a later client hydration once the
  // calendar rolls over. Deferring to a post-mount effect keeps the first
  // client render identical to the static HTML, so there's nothing to
  // reconcile; suppressHydrationWarning is not needed because no mismatch
  // is ever presented to React.
  const [year, setYear] = useState(null);
  useEffect(() => {
    // Deliberate: initial state (null) matches the static server HTML on
    // every build, so this update never causes a client/server mismatch —
    // it just fills in the real year after mount. See comment above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setYear(new Date().getFullYear());
  }, []);

  const industryCount = projectsData.filter((p) => p.tier === "industry").length;
  const technologyCount = new Set(skillNames).size;

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#060a14]">

      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        html, body { overflow: hidden; height: 100%; margin: 0; }
        ::-webkit-scrollbar { display: none; }
      `}</style>

      {/* Ambient glows */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full bg-violet-700/20 blur-[130px]" />
        <div className="absolute bottom-0 right-0 w-[420px] h-[420px] rounded-full bg-sky-600/15 blur-[110px]" />
        <div className="absolute top-1/2 left-1/3 w-[280px] h-[280px] rounded-full bg-indigo-600/10 blur-[90px]" />
      </div>

      {/* Grid texture */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px)",
          backgroundSize: "72px 72px",
        }}
      />

      {/* Particles */}
      <div className="absolute inset-0 z-[1]">
        <ParticlesContainer />
      </div>

      {/* ── Main content ── */}
      <div className="relative z-10 h-full max-w-[1280px] mx-auto px-8 xl:px-16 flex items-center">
        <div className="w-full grid grid-cols-1 xl:grid-cols-[1fr_480px] gap-12 items-center">

          {/* LEFT */}
          <motion.div
            variants={stagger}
            initial="hidden"
            animate="show"
            className="flex flex-col justify-center"
          >
            {/* Eyebrow */}
            <motion.div variants={fadeUp} className="flex items-center gap-3 mb-6">
              <div className="h-px w-8 bg-gradient-to-r from-violet-500 to-sky-400" />
              <span
                className="text-[11px] uppercase tracking-[0.25em] text-violet-400 font-semibold"
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                Portfolio{year ? ` · ${year}` : ""}
              </span>
            </motion.div>

            {/* Greeting */}
            <motion.p
              variants={fadeUp}
              className="text-white/40 text-sm mb-2 tracking-wide"
              style={{ fontFamily: "'Inter', sans-serif" }}
            >
              Hello, I&apos;m
            </motion.p>

            {/* Name — controlled size */}
            <motion.h1
              variants={fadeUp}
              className="font-black tracking-tight text-white leading-[1.0] mb-4"
              style={{
                fontFamily: "'Syne', sans-serif",
                fontSize: "clamp(2.4rem, 4.8vw, 3.8rem)",
              }}
            >
              {personalInfo.name}
            </motion.h1>

            {/* Role badge */}
            <motion.div variants={fadeUp} className="flex mb-5">
              <span
                className="inline-flex items-center gap-2 px-4 py-[7px] rounded-full text-[13px] font-medium
                           bg-violet-600/20 border border-violet-500/35 text-violet-300"
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                <span className="w-[7px] h-[7px] rounded-full bg-violet-400 animate-pulse flex-shrink-0" />
                {personalInfo.role}
              </span>
            </motion.div>

            {/* Bio */}
            <motion.p
              variants={fadeUp}
              className="text-white/55 text-[0.9rem] leading-[1.75] max-w-[500px] mb-6"
              style={{ fontFamily: "'Inter', sans-serif" }}
            >
              Building production-ready web applications, business platforms, and
              AI-powered solutions at{" "}
              <span className="text-white/80 font-medium">{personalInfo.company}</span>{" "}
              with modern technologies like React, Next.js &amp; Tailwind CSS.
            </motion.p>

            {/* Skills */}
            <motion.div variants={fadeUp} className="flex flex-wrap gap-2 mb-7">
              {quickSkills.map((skill, i) => (
                <motion.button
                  key={skill}
                  onHoverStart={() => setHovered(i)}
                  onHoverEnd={() => setHovered(null)}
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.96 }}
                  className="px-3.5 py-1 text-[12px] font-semibold rounded-full border transition-all duration-200 cursor-default"
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    background:
                      hovered === i
                        ? "linear-gradient(135deg,rgba(139,92,246,.22),rgba(14,165,233,.14))"
                        : "rgba(255,255,255,0.05)",
                    borderColor:
                      hovered === i ? "rgba(139,92,246,.55)" : "rgba(255,255,255,0.1)",
                    color: hovered === i ? "#c4b5fd" : "rgba(255,255,255,0.55)",
                  }}
                >
                  {skill}
                </motion.button>
              ))}
            </motion.div>

            {/* Stats */}
            <motion.div variants={fadeUp} className="flex items-center gap-8 mb-8">
              {[
                { label: "Projects", value: projectsData.length, suffix: "+" },
                { label: "Technologies", value: technologyCount, suffix: "+" },
                { label: "Industry Projects", value: industryCount, suffix: "" },
              ].map(({ label, value, suffix }, i) => (
                <div key={label} className="flex flex-col">
                  <span
                    className="text-[2rem] font-black text-white leading-none"
                    style={{ fontFamily: "'Syne', sans-serif" }}
                  >
                    <Counter to={value} suffix={suffix} />
                  </span>
                  <span
                    className="text-white/35 text-[10px] uppercase tracking-[0.18em] mt-1"
                    style={{ fontFamily: "'Inter', sans-serif" }}
                  >
                    {label}
                  </span>
                </div>
              ))}

              {/* vertical divider */}
              <div className="h-10 w-px bg-white/10 mx-2" />

              {/* CTA */}
              <ProjectsBtn />
            </motion.div>
          </motion.div>

          {/* RIGHT — Avatar */}
          <motion.div
            variants={slideIn}
            initial="hidden"
            animate="show"
            className="hidden xl:flex relative items-end justify-center h-full"
            style={{ minHeight: "560px" }}
          >
            {/* Soft glow behind avatar */}
            <div
              className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[360px] h-[480px] rounded-full"
              style={{
                background:
                  "radial-gradient(ellipse at center bottom, rgba(109,40,217,0.25) 0%, transparent 70%)",
              }}
            />

            {/* Explosion bg */}
            <div
              className="absolute inset-0 bg-explosion bg-cover bg-center bg-no-repeat mix-blend-color-dodge opacity-60"
              aria-hidden
            />

            {/* Floating avatar */}
            <motion.div
              className="relative w-full max-w-[460px]"
              animate={{ y: [0, -10, 0] }}
              transition={{ repeat: Infinity, duration: 5.5, ease: "easeInOut" }}
            >
              <Avatar />
            </motion.div>
          </motion.div>

        </div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 z-20"
        animate={{ opacity: [0.5, 0.1, 0.5] }}
        transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
      >
        <div className="w-px h-8 bg-gradient-to-b from-violet-500/50 to-transparent" />
        <span
          className="text-[9px] uppercase tracking-[0.22em] text-white/25"
          style={{ fontFamily: "'Inter', sans-serif" }}
        >
          Scroll
        </span>
      </motion.div>

    </div>
  );
}