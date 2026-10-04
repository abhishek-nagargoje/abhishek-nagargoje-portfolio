"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  HiOutlineTrophy,
  HiOutlineBookOpen,
  HiOutlineCalendar,
  HiOutlineArrowTopRightOnSquare,
  HiOutlineSparkles,
  HiOutlineXMark,
} from "react-icons/hi2";

// ─── Real Data ────────────────────────────────────────────────────────────────
const achievementCategories = [
  { id: "competitions", label: "Competitions", icon: "trophy" },
  { id: "workshops", label: "Workshops & Certs", icon: "book" },
];

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

const achievementsData = {
  competitions: [
    {
      id: 1,
      title: "District Level Aavishkar 2025",
      level: "District Level — 1st Position 🥇",
      description:
        "Secured First position at the District Level Aavishkar 2025 held at Vaidyanath College Parali (V.), organised by Swatantrayaveer Sawarkar Mahavidyalaya, Beed on 18th September 2025.",
      status: "1st Place",
      year: "2025",
      project: "AI Shopping Assistant",
      proof: `${BASE}/Dis_Level.webp`,
      proofLabel: "View Certificate",
    },
    {
      id: 2,
      title: "University Level Aavishkar 2025",
      level: "University Level — 3rd Position 🥉",
      description:
        "Awarded Third position at the University Level Aavishkar 2025 organised by Dr. Babasaheb Ambedkar Marathwada University, Chhatrapati Sambhajinagar on 3rd & 4th October 2025.",
      status: "3rd Place",
      year: "2025",
      project: "AI Shopping Assistant",
      proof: `${BASE}/Region_level.webp`,
      medal: `${BASE}/Medil.webp`,
      proofLabel: "View Certificate",
    },
    {
      id: 3,
      title: "State Level Aavishkar 2025-26",
      level: "State Level — Participant",
      description:
        "Presented 'AI-Driven Commerce & Smart Health Platform' (UG Level) at the 18th Maharashtra State Inter-University Research Convention at VNMKV, Parbhani — January 28–31, 2026.",
      status: "Participant",
      year: "2026",
      project: "AI-Driven Commerce & Smart Health Platform",
      proof: `${BASE}/state_level.webp`,
      proofLabel: "View Certificate",
    },
  ],
  workshops: [
    {
      id: 4,
      title: "AI Tools & ChatGPT Workshop",
      category: "be10x — Verified",
      description:
        "Certified to create AI presentations in under 5 min, analyse data with AI in under 30 min, and code & debug using AI in under 10 min.",
      status: "Completed",
      year: "Feb 2026",
      issuer: "be10x",
      proof: `${BASE}/Benx10_Certificate.webp`,
      proofLabel: "View Certificate",
    },
    {
      id: 5,
      title: "PowerBI Workshop",
      category: "OfficeMaster — Verified",
      description:
        "Certified on successful completion of the PowerBI Workshop. Can create AI-powered interactive dashboards in PowerBI in under 30 minutes.",
      status: "Completed",
      year: "Feb 2026",
      issuer: "OfficeMaster",
      proof: `${BASE}/PowerBi_Certificate.webp`,
      proofLabel: "View Certificate",
    },
    {
      id: 6,
      title: "Excel Using AI Workshop",
      category: "OfficeMaster — Verified",
      description:
        "Skilled in 200+ Excel formulas with AI, dashboard creation in under 2 minutes, and Macros/VBA using AI.",
      status: "Completed",
      year: "Feb 2026",
      issuer: "OfficeMaster",
      proof: `${BASE}/Excel_Certificate.webp`,
      proofLabel: "View Certificate",
    },
  ],
};
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_THEME = {
  competitions: {
    iconBg: "rgba(245,158,11,0.12)",
    iconColor: "#fbbf24",
    glow: "rgba(245,158,11,0.25)",
  },
  workshops: {
    iconBg: "rgba(34,197,94,0.12)",
    iconColor: "#4ade80",
    glow: "rgba(34,197,94,0.25)",
  },
};

const STATUS_CONFIG = {
  "1st Place": { bg: "rgba(251,191,36,0.18)", text: "#fbbf24", dot: "#f59e0b" },
  "3rd Place": { bg: "rgba(180,160,60,0.15)", text: "#d4aa30", dot: "#b5922a" },
  Completed: { bg: "rgba(34,197,94,0.1)", text: "#4ade80", dot: "#22c55e" },
  Participant: { bg: "rgba(99,102,241,0.1)", text: "#a5b4fc", dot: "#6366f1" },
};

const GridBackground = () => (
  <div
    aria-hidden
    className="pointer-events-none absolute inset-0 z-0"
    style={{
      backgroundImage: `linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px)`,
      backgroundSize: "72px 72px",
    }}
  />
);

const AmbientGlow = ({ type }) => {
  const cols = {
    competitions: ["rgba(245,158,11,0.1)", "rgba(99,102,241,0.07)"],
    workshops: ["rgba(34,197,94,0.09)", "rgba(99,102,241,0.06)"],
  };
  const [c1, c2] = cols[type] || cols.competitions;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    >
      <div
        style={{
          position: "absolute",
          top: "-15%",
          right: "-8%",
          width: "560px",
          height: "560px",
          borderRadius: "50%",
          background: `radial-gradient(circle,${c1} 0%,transparent 70%)`,
          transition: "background 0.6s",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "5%",
          left: "-6%",
          width: "480px",
          height: "480px",
          borderRadius: "50%",
          background: `radial-gradient(circle,${c2} 0%,transparent 70%)`,
          transition: "background 0.6s",
        }}
      />
    </div>
  );
};

const StatusPill = ({ status }) => {
  const c = STATUS_CONFIG[status] || STATUS_CONFIG["Participant"];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
      style={{ background: c.bg, color: c.text }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: c.dot, boxShadow: `0 0 6px ${c.dot}` }}
      />
      {status}
    </span>
  );
};

// ── Certificate Lightbox ──────────────────────────────────────────────────────
const CertLightbox = ({ src, title, onClose }) => {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      // Close is the dialog's only focusable control: keep focus on it.
      if (e.key === "Tab") e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
  <motion.div
    role="dialog"
    aria-modal="true"
    aria-label={title}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-10"
    style={{ background: "rgba(0,0,0,0.92)" }}
    onClick={onClose}
  >
    <motion.div
      initial={{ scale: 0.88, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.88, opacity: 0 }}
      transition={{ duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="relative max-w-4xl w-full"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-4">
        <p
          className="text-sm font-medium"
          style={{ color: "rgba(255,255,255,0.6)" }}
        >
          {title}
        </p>
        <button
          type="button"
          autoFocus
          onClick={onClose}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-all duration-200"
          style={{
            background: "rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.6)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.15)";
            e.currentTarget.style.color = "#fff";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            e.currentTarget.style.color = "rgba(255,255,255,0.6)";
          }}
        >
          <HiOutlineXMark style={{ fontSize: "1rem" }} /> Close
        </button>
      </div>
      <img
        loading="lazy"
        decoding="async"
        src={src}
        alt={title}
        className="w-full rounded-2xl object-contain"
        style={{
          maxHeight: "80vh",
          border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.8)",
        }}
      />
    </motion.div>
  </motion.div>
);
};

// ── Achievement Card with Certificate Photo ───────────────────────────────────
const AchievementCard = ({ achievement, type, index, onViewProof }) => {
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const theme = TYPE_THEME[type] || TYPE_THEME.workshops;

  return (
    <motion.article
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{
        duration: 0.45,
        delay: index * 0.07,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative flex flex-col rounded-2xl overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg,rgba(255,255,255,0.055) 0%,rgba(255,255,255,0.018) 100%)",
        border: hovered
          ? `1px solid ${theme.iconColor}66`
          : "1px solid rgba(255,255,255,0.08)",
        boxShadow: hovered
          ? `0 0 40px ${theme.glow},0 20px 60px rgba(0,0,0,0.5)`
          : "0 4px 24px rgba(0,0,0,0.2)",
        transition: "border-color 0.3s ease,box-shadow 0.3s ease",
      }}
    >
      {/* ── Certificate Image Preview ──
          Mouse shortcut only; the keyboard/AT path is the buttons below. */}
      <div
        aria-hidden="true"
        className="relative overflow-hidden"
        style={{
          height: "200px",
          background: "rgba(0,0,0,0.3)",
          cursor: achievement.proof ? "pointer" : "default",
        }}
        onClick={() =>
          achievement.proof &&
          !imgError &&
          onViewProof(achievement.proof, achievement.title)
        }
      >
        {achievement.proof && !imgError ? (
          <>
            <img
              loading="lazy"
              decoding="async"
              src={achievement.proof}
              alt={achievement.title}
              onError={() => setImgError(true)}
              className="w-full h-full"
              style={{
                objectFit: "cover",
                objectPosition: "top center",
                transition: "transform 0.5s ease, filter 0.4s ease",
                transform: hovered ? "scale(1.06)" : "scale(1)",
                filter: hovered ? "brightness(0.55)" : "brightness(0.8)",
              }}
            />
            {/* Bottom gradient */}
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(to bottom,rgba(0,0,0,0.05) 0%,rgba(0,0,0,0.6) 100%)",
              }}
            />

            {/* Hover overlay */}
            <AnimatePresence>
              {hovered && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-2"
                >
                  <div
                    className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold"
                    style={{
                      background: `${theme.iconColor}cc`,
                      color: "#fff",
                    }}
                  >
                    <HiOutlineArrowTopRightOnSquare /> View Full
                  </div>
                  {achievement.medal && (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewProof(
                          achievement.medal,
                          "Medal — " + achievement.title,
                        );
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
                      style={{
                        background: "rgba(245,158,11,0.85)",
                        color: "#fff",
                      }}
                    >
                      🏅 View Medal
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Floating badges */}
            <div className="absolute top-3 right-3">
              <StatusPill status={achievement.status} />
            </div>
            <div
              className="absolute top-3 left-3 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
              style={{
                background: "rgba(0,0,0,0.6)",
                color: "rgba(255,255,255,0.7)",
                border: "1px solid rgba(255,255,255,0.1)",
                fontFamily: "var(--font-mono), monospace",
              }}
            >
              <HiOutlineCalendar style={{ color: theme.iconColor }} />
              {achievement.year}
            </div>
          </>
        ) : (
          <div
            className="w-full h-full flex flex-col items-center justify-center gap-3"
            style={{
              background: `linear-gradient(135deg,${theme.iconBg},rgba(0,0,0,0.2))`,
            }}
          >
            {type === "competitions" ? (
              <HiOutlineTrophy
                style={{
                  fontSize: "3rem",
                  color: theme.iconColor,
                  opacity: 0.3,
                }}
              />
            ) : (
              <HiOutlineBookOpen
                style={{
                  fontSize: "3rem",
                  color: theme.iconColor,
                  opacity: 0.3,
                }}
              />
            )}
            <span
              className="text-xs"
              style={{ color: "rgba(255,255,255,0.25)" }}
            >
              Image unavailable
            </span>
          </div>
        )}
      </div>

      {/* Accent line */}
      <div
        className="h-px w-full"
        style={{
          background: hovered
            ? `linear-gradient(90deg,transparent,${theme.iconColor}88,transparent)`
            : "transparent",
          transition: "background 0.4s ease",
        }}
      />

      {/* ── Body ── */}
      <div className="p-5 flex flex-col flex-1 gap-3">
        <div className="flex items-start gap-3">
          <div
            className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center mt-0.5"
            style={{
              background: theme.iconBg,
              border: `1px solid ${theme.iconColor}30`,
              boxShadow: hovered ? `0 0 14px ${theme.glow}` : "none",
              transition: "box-shadow 0.3s",
            }}
          >
            {type === "competitions" ? (
              <HiOutlineTrophy
                style={{ color: theme.iconColor, fontSize: "1rem" }}
              />
            ) : (
              <HiOutlineBookOpen
                style={{ color: theme.iconColor, fontSize: "1rem" }}
              />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3
              className="text-sm font-semibold leading-snug transition-colors duration-200"
              style={{ color: hovered ? theme.iconColor : "#f1f5f9" }}
            >
              {achievement.title}
            </h3>
            {(achievement.level || achievement.category) && (
              <p
                className="text-xs mt-0.5"
                style={{ color: "rgba(255,255,255,0.4)" }}
              >
                {achievement.level || achievement.category}
              </p>
            )}
          </div>
        </div>

        <p
          className="text-xs leading-relaxed"
          style={{ color: "rgba(255,255,255,0.45)" }}
        >
          {achievement.description}
        </p>

        {(achievement.project || achievement.issuer) && (
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
            style={{
              background: `${theme.iconColor}0f`,
              border: `1px solid ${theme.iconColor}22`,
            }}
          >
            <span style={{ color: "rgba(255,255,255,0.35)" }}>
              {achievement.project ? "Project —" : "Issued by —"}
            </span>
            <span
              style={{
                color: theme.iconColor,
                fontFamily: "var(--font-mono), monospace",
                fontSize: "0.7rem",
              }}
            >
              {achievement.project || achievement.issuer}
            </span>
          </div>
        )}

        {achievement.proof && (
          <button
            type="button"
            onClick={() => onViewProof(achievement.proof, achievement.title)}
            className="mt-auto flex items-center justify-center gap-2 w-full py-2 rounded-xl text-xs font-medium transition-all duration-200"
            style={{
              background: hovered
                ? `${theme.iconColor}22`
                : "rgba(255,255,255,0.04)",
              color: hovered ? theme.iconColor : "rgba(255,255,255,0.4)",
              border: `1px solid ${hovered ? theme.iconColor + "44" : "rgba(255,255,255,0.08)"}`,
            }}
          >
            <HiOutlineArrowTopRightOnSquare />
            {achievement.proofLabel || "View Certificate"}
          </button>
        )}

        {achievement.medal && (
          <button
            type="button"
            onClick={() => onViewProof(achievement.medal, "Medal — " + achievement.title)}
            className="flex items-center justify-center gap-2 w-full py-2 rounded-xl text-xs font-medium transition-colors duration-200"
            style={{
              background: "rgba(245,158,11,0.08)",
              color: "#fbbf24",
              border: "1px solid rgba(245,158,11,0.25)",
            }}
          >
            🏅 View Medal
          </button>
        )}
      </div>
    </motion.article>
  );
};

// ── Aavishkar Spotlight ───────────────────────────────────────────────────────
const AavishkarSpotlight = ({ onViewProof }) => (
  <motion.section
    initial={{ opacity: 0, y: 40 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, amount: 0.15 }}
    transition={{ duration: 0.7, delay: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
    className="mt-24 rounded-3xl overflow-hidden relative"
    style={{
      background:
        "linear-gradient(135deg,rgba(245,158,11,0.1) 0%,rgba(99,102,241,0.08) 55%,rgba(244,114,182,0.06) 100%)",
      border: "1px solid rgba(245,158,11,0.22)",
    }}
  >
    <div
      aria-hidden
      className="absolute top-0 right-0 w-72 h-72 pointer-events-none"
      style={{
        background:
          "radial-gradient(circle at top right,rgba(245,158,11,0.18) 0%,transparent 65%)",
      }}
    />

    <div className="relative z-10 p-10 md:p-14">
      <div className="inline-flex items-center gap-2 mb-6">
        <HiOutlineSparkles style={{ color: "#fbbf24", fontSize: "0.85rem" }} />
        <span
          className="text-xs font-bold uppercase tracking-widest"
          style={{ color: "#fbbf24", letterSpacing: "0.12em" }}
        >
          Featured Achievement
        </span>
      </div>

      <div className="flex flex-col lg:flex-row gap-10 items-start">
        {/* Left: text */}
        <div className="flex-1 min-w-0">
          <h3
            className="text-4xl md:text-5xl font-black leading-none tracking-tight mb-4"
            style={{ color: "#f1f5f9", letterSpacing: "-0.03em" }}
          >
            Aavishkar<span style={{ color: "#fbbf24" }}>.</span>
            <span
              className="block text-2xl md:text-3xl font-semibold mt-1"
              style={{ color: "rgba(255,255,255,0.45)", letterSpacing: "0" }}
            >
              Research Convention
            </span>
          </h3>
          <p
            className="text-base leading-relaxed mb-8 max-w-xl"
            style={{ color: "rgba(255,255,255,0.55)" }}
          >
            From <span style={{ color: "#fbbf24" }}>1st at District Level</span>{" "}
            to <span style={{ color: "#d4aa30" }}>3rd at University Level</span>{" "}
            and representing Dr. BAMU at the{" "}
            <span style={{ color: "#a5b4fc" }}>Maharashtra State Level</span> —
            with <span style={{ color: "#fbbf24" }}>AI Shopping Assistant</span>
            .
          </p>
          <div className="flex flex-wrap gap-3">
            {[
              ["District Level", "1st Position 🥇"],
              ["University Level", "3rd Position 🥉"],
              ["State Level", "Participant 2026"],
              ["University", "Dr. BAMU"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="px-4 py-2.5 rounded-xl"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <p
                  className="text-xs mb-0.5"
                  style={{ color: "rgba(255,255,255,0.35)" }}
                >
                  {label}
                </p>
                <p
                  className="text-sm font-semibold"
                  style={{ color: "#f1f5f9" }}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Right: certificate image thumbnails grid */}
        <div className="shrink-0 flex flex-col gap-3">
          <p
            className="text-xs uppercase tracking-widest mb-1"
            style={{ color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em" }}
          >
            Certificates & Medal
          </p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { src: `${BASE}/Dis_Level.webp`, label: "District Cert 🥇" },
              { src: `${BASE}/Region_level.webp`, label: "University Cert 🥉" },
              { src: `${BASE}/state_level.webp`, label: "State Cert" },
              { src: `${BASE}/Medil.webp`, label: "🏅 Medal" },
            ].map(({ src, label }) => (
              <button
                type="button"
                key={src}
                aria-label={`View ${label.replace(/[^\p{L}\p{N} ]/gu, "").trim()}`}
                className="flex flex-col items-center gap-1.5 cursor-pointer group rounded-xl"
                onClick={() => onViewProof(src, label)}
              >
                <div
                  className="rounded-xl overflow-hidden relative"
                  style={{
                    width: "110px",
                    height: "76px",
                    border: "1px solid rgba(245,158,11,0.25)",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
                  }}
                >
                  <img
                    loading="lazy"
                    decoding="async"
                    src={src}
                    alt={label}
                    className="w-full h-full"
                    style={{
                      objectFit: "cover",
                      objectPosition: "top",
                      transition: "transform 0.35s, filter 0.35s",
                      filter: "brightness(0.8)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "scale(1.1)";
                      e.currentTarget.style.filter = "brightness(1.05)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "scale(1)";
                      e.currentTarget.style.filter = "brightness(0.8)";
                    }}
                  />
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center"
                    style={{ background: "rgba(0,0,0,0.45)" }}
                  >
                    <HiOutlineArrowTopRightOnSquare
                      style={{ color: "#fbbf24", fontSize: "1.1rem" }}
                    />
                  </div>
                </div>
                <span
                  className="text-xs text-center"
                  style={{ color: "rgba(255,255,255,0.35)" }}
                >
                  {label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  </motion.section>
);

// ── Main Page ─────────────────────────────────────────────────────────────────
const Achievements = ({ embedded = false }) => {
  const Title = embedded ? motion.h2 : motion.h1;
  const [activeTab, setActiveTab] = useState("competitions");
  const [lightbox, setLightbox] = useState(null);

  const returnFocusTo = useRef(null);
  const openProof = (src, title) => {
    returnFocusTo.current = document.activeElement;
    setLightbox({ src, title });
  };
  const closeProof = () => {
    setLightbox(null);
    returnFocusTo.current?.focus?.();
  };

  return (
    <>

      <section
        id="achievements"
        aria-labelledby="achievements-title"
        className={`relative font-syne-scope overflow-hidden ${embedded ? "" : "min-h-screen"}`}
        style={{ background: "#080b14", color: "#f1f5f9", "--selection": "rgba(245,158,11,0.3)" }}
      >
        <GridBackground />
        <AmbientGlow type={activeTab} />

        <AnimatePresence>
          {lightbox && (
            <CertLightbox
              src={lightbox.src}
              title={lightbox.title}
              onClose={closeProof}
            />
          )}
        </AnimatePresence>

        <div className={`relative z-10 max-w-6xl mx-auto px-6 ${embedded ? "py-20 md:py-28" : "py-28 md:py-36"}`}>
          {/* Header */}
          <div className="mb-16">
            <motion.p
              initial={{ opacity: 0, x: -16 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ duration: 0.5 }}
              className="text-xs uppercase tracking-widest mb-4"
              style={{ color: "#fbbf24", letterSpacing: "0.14em" }}
            >
              Recognition
            </motion.p>
            <Title
              id="achievements-title"
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{
                duration: 0.6,
                delay: 0.1,
                ease: [0.25, 0.46, 0.45, 0.94],
              }}
              className="text-5xl md:text-7xl font-black tracking-tight leading-none mb-6"
              style={{ letterSpacing: "-0.03em" }}
            >
              Certs &amp;
              <br />
              <span
                style={{
                  WebkitTextStroke: "1px rgba(255,255,255,0.22)",
                  color: "transparent",
                }}
              >
                Achievements
              </span>
              <span style={{ color: "#fbbf24" }}>.</span>
            </Title>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="max-w-lg text-base leading-relaxed"
              style={{ color: "rgba(255,255,255,0.6)" }}
            >
              From district podiums to state conventions — a record of
              competitions and certified workshops.
            </motion.p>
          </div>

          {/* Tabs */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ duration: 0.5, delay: 0.25 }}
            className="flex flex-wrap gap-2 mb-12"
            role="group"
            aria-label="Filter"
          >
            {achievementCategories.map((cat) => {
              const active = activeTab === cat.id;
              const theme = TYPE_THEME[cat.id];
              const Icon =
                cat.icon === "trophy" ? HiOutlineTrophy : HiOutlineBookOpen;
              return (
                <button
                  key={cat.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setActiveTab(cat.id)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-250 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                  style={{
                    background: active
                      ? `${theme.iconColor}22`
                      : "rgba(255,255,255,0.05)",
                    color: active ? theme.iconColor : "rgba(255,255,255,0.5)",
                    border: active
                      ? `1px solid ${theme.iconColor}55`
                      : "1px solid rgba(255,255,255,0.08)",
                    boxShadow: active ? `0 4px 20px ${theme.glow}` : "none",
                    transform: active ? "translateY(-1px)" : "none",
                  }}
                >
                  <Icon style={{ fontSize: "1rem" }} />
                  {cat.label}
                </button>
              );
            })}
          </motion.div>

          {/* Cards Grid */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true, amount: 0.15 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
            >
              {(achievementsData[activeTab] || []).map((item, i) => (
                <AchievementCard
                  key={item.id}
                  achievement={item}
                  type={activeTab}
                  index={i}
                  onViewProof={openProof}
                />
              ))}
            </motion.div>
          </AnimatePresence>

          {/* Spotlight */}
          <AavishkarSpotlight onViewProof={openProof} />

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="mt-10 text-center text-xs"
            style={{ color: "rgba(255,255,255,0.2)" }}
          >
            Click any certificate image to view it full screen.
          </motion.p>
        </div>
      </section>
    </>
  );
};

export default Achievements;
