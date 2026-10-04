"use client";

import { useEffect, useState } from "react";
import { HiArrowDown, HiOutlineArrowDownTray } from "react-icons/hi2";
import ParticlesContainer from "../ParticlesContainer";
import ProjectsBtn from "../ProjectsBtn";
import Counter from "../Counter";
import Avatar from "../Avatar";
import { personalInfo, skillsData } from "../../data/personalInfo";
import { projectsData as localProjectsData } from "../../data/projects";
import { getProjects, getSkills } from "../../lib/supabase/queries";
import { mapProjectRows } from "../../lib/supabase/transform";
import { useCmsData } from "../../lib/supabase/useCmsData";
import { assetPath } from "../../utils/assetPath";

const quickSkills = ["React.js", "Next.js", "Tailwind CSS", "Supabase", "AI / LLM APIs"];

const localSkillNames = Object.values(skillsData).flat();
const fetchProjects = () => getProjects().then(mapProjectRows);
const fetchSkillNames = () => getSkills().then((rows) => (rows || []).map((r) => r.name));

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
    <section
      id="home"
      aria-labelledby="hero-title"
      className="relative w-full min-h-[100svh] overflow-hidden bg-[#060a14]"
    >
      {/* Ambient glows — radial gradients instead of huge filter blurs
          (same look, no expensive blur pass on every repaint) */}
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
        <div className="absolute -top-72 -left-72 w-[1000px] h-[1000px] rounded-full bg-[radial-gradient(circle,rgba(109,40,217,0.22)_0%,transparent_60%)]" />
        <div className="absolute -bottom-56 -right-56 w-[860px] h-[860px] rounded-full bg-[radial-gradient(circle,rgba(2,132,199,0.16)_0%,transparent_60%)]" />
        <div className="absolute top-1/3 left-1/4 w-[560px] h-[560px] rounded-full bg-[radial-gradient(circle,rgba(79,70,229,0.10)_0%,transparent_60%)]" />
      </div>

      {/* Grid texture */}
      <div
        aria-hidden
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
      <div className="relative z-10 min-h-[100svh] max-w-[1280px] mx-auto px-6 sm:px-8 xl:px-16 pt-28 pb-32 xl:py-24 flex items-center">
        <div className="w-full grid grid-cols-1 xl:grid-cols-[1fr_480px] gap-12 items-center">

          {/* LEFT */}
          {/* Entrance is pure CSS (.hero-stagger in globals.css): it starts with
              the first paint instead of waiting for hydration. */}
          <div className="hero-stagger flex flex-col justify-center">
            {/* Eyebrow */}
            <div className="flex items-center gap-3 mb-6">
              <div className="h-px w-8 bg-gradient-to-r from-violet-500 to-sky-400" />
              <span
                className="text-[11px] uppercase tracking-[0.25em] text-violet-400 font-semibold"
                style={{ fontFamily: "var(--font-inter), sans-serif" }}
              >
                Portfolio{year ? ` · ${year}` : ""}
              </span>
            </div>

            {/* Greeting */}
            <p
                            className="text-white/55 text-sm mb-2 tracking-wide"
              style={{ fontFamily: "var(--font-inter), sans-serif" }}
            >
              Hello, I&apos;m
            </p>

            {/* Name — controlled size */}
            <h1
              id="hero-title"
                            className="font-black tracking-tight text-white leading-[1.0] mb-4"
              style={{
                fontFamily: "var(--font-syne), sans-serif",
                fontSize: "clamp(2.4rem, 4.8vw, 3.8rem)",
              }}
            >
              {personalInfo.name}
            </h1>

            {/* Role badge */}
            <div className="flex mb-5">
              <span
                className="inline-flex items-center gap-2 px-4 py-[7px] rounded-full text-[13px] font-medium
                           bg-violet-600/20 border border-violet-500/35 text-violet-300"
                style={{ fontFamily: "var(--font-inter), sans-serif" }}
              >
                <span className="w-[7px] h-[7px] rounded-full bg-violet-400 animate-pulse flex-shrink-0" />
                {personalInfo.role}
              </span>
            </div>

            {/* Bio */}
            <p
                            className="text-white/55 text-[0.9rem] leading-[1.75] max-w-[500px] mb-6"
              style={{ fontFamily: "var(--font-inter), sans-serif" }}
            >
              Building production-ready web applications, business platforms, and
              AI-powered solutions at{" "}
              <span className="text-white/80 font-medium">{personalInfo.company}</span>{" "}
              with modern technologies like React, Next.js &amp; Tailwind CSS.
            </p>

            {/* Skills (decorative tags, not controls) */}
            <ul className="flex flex-wrap gap-2 mb-7" aria-label="Core stack">
              {quickSkills.map((skill, i) => (
                <li
                  key={skill}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                  className="px-3.5 py-1 text-[12px] font-semibold rounded-full border transition-[colors,transform] duration-200 hover:scale-[1.06] cursor-default"
                  style={{
                    fontFamily: "var(--font-inter), sans-serif",
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
                </li>
              ))}
            </ul>

            {/* Primary / secondary CTAs */}
            <div className="flex flex-wrap items-center gap-3 mb-8">
              <a
                href="#contact"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white
                           bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500
                           shadow-[0_6px_24px_rgba(124,58,237,0.35)] transition-colors"
                style={{ fontFamily: "var(--font-inter), sans-serif" }}
              >
                Get in touch
              </a>
              <a
                href={assetPath(personalInfo.resumePath || "/Abhishek_MERN_Resume.pdf")}
                download
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold
                           text-white/80 border border-white/15 hover:border-violet-400/60 hover:text-white transition-colors"
                style={{ fontFamily: "var(--font-inter), sans-serif" }}
              >
                <HiOutlineArrowDownTray aria-hidden /> Résumé
              </a>
            </div>

            {/* Stats */}
            <div className="flex flex-wrap items-center gap-x-8 gap-y-6">
              {[
                { label: "Projects", value: projectsData.length, suffix: "+" },
                { label: "Technologies", value: technologyCount, suffix: "+" },
                { label: "Industry Projects", value: industryCount, suffix: "" },
              ].map(({ label, value, suffix }, i) => (
                <div key={label} className="flex flex-col">
                  <span
                    className="text-[2rem] font-black text-white leading-none"
                    style={{ fontFamily: "var(--font-syne), sans-serif" }}
                  >
                    <Counter to={value} suffix={suffix} />
                  </span>
                  <span
                    className="text-white/55 text-[10px] uppercase tracking-[0.18em] mt-1"
                    style={{ fontFamily: "var(--font-inter), sans-serif" }}
                  >
                    {label}
                  </span>
                </div>
              ))}

              {/* vertical divider */}
              <div className="hidden sm:block h-10 w-px bg-white/10 mx-2" aria-hidden />

              {/* CTA */}
              <ProjectsBtn />
            </div>
          </div>

          {/* RIGHT — Avatar */}
          <div
            className="hero-slide-in hidden xl:flex relative items-end justify-center h-full"
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

            {/* Floating avatar */}
            <div className="hero-float relative w-full max-w-[460px]">
              <Avatar priority />
            </div>
          </div>

        </div>
      </div>

      {/* Scroll cue — a real link to the next section */}
      <a
        href="#about"
        className="hidden xl:flex absolute bottom-6 left-1/2 -translate-x-1/2 flex-col items-center gap-1 z-20
                   text-white/35 hover:text-white/70 transition-colors"
      >
        <span
          className="text-[9px] uppercase tracking-[0.22em]"
          style={{ fontFamily: "var(--font-inter), sans-serif" }}
        >
          Scroll
        </span>
        <HiArrowDown className="motion-safe:animate-bounce" aria-hidden />
      </a>
    </section>
  );
}