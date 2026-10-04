"use client";
import { useEffect, useState } from "react";
import { HiArrowUp } from "react-icons/hi2";
import Socials from "./Socials";
import { personalInfo } from "../data/personalInfo";

export default function Footer() {
  // Filled in after mount so a long-lived static build never shows a stale
  // year and the server HTML always matches the first client render.
  const [year, setYear] = useState(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setYear(new Date().getFullYear());
  }, []);

  return (
    <footer className="relative border-t border-white/[0.06] bg-[#060a14] pb-[72px] xl:pb-0">
      <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-6 text-sm text-white/45">
        <p style={{ fontFamily: "var(--font-inter), sans-serif" }}>
          © {year ?? ""} {personalInfo.name} · {personalInfo.role}
        </p>
        <div className="flex items-center gap-6">
          <Socials />
          <a
            href="#home"
            className="inline-flex items-center gap-1.5 text-white/50 hover:text-white transition-colors"
            style={{ fontFamily: "var(--font-inter), sans-serif" }}
          >
            <HiArrowUp aria-hidden /> Top
          </a>
        </div>
      </div>
    </footer>
  );
}
