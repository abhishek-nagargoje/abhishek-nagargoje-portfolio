"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Socials from "./Socials";
import { personalInfo } from "../data/personalInfo";

export default function Header() {
  const [scrolled, setScrolled] = useState(false);
  const router = useRouter();

  // Hidden entry point to the admin area — intentionally not in the public
  // nav. This is UX only, not a security boundary: every admin read/write is
  // independently gated by Supabase Auth + RLS regardless of how someone
  // reaches the /admin route.
  const handleLogoDoubleClick = (e) => {
    e.preventDefault();
    router.push("/admin/login");
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.header
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled
          ? "bg-[#050810]/80 backdrop-blur-xl border-b border-white/[0.06] shadow-[0_4px_30px_rgba(0,0,0,0.4)]"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-[1280px] mx-auto px-6 sm:px-10 xl:px-16">
        <div className="flex items-center justify-between h-[72px]">
          <Link href="/" onDoubleClick={handleLogoDoubleClick} className="group flex items-center gap-1 relative">
            <motion.span
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center gap-0.5 text-[1.35rem] font-black tracking-tight"
              style={{ fontFamily: "'Syne', sans-serif" }}
            >
              <span className="text-violet-400 transition-colors duration-200 group-hover:text-violet-300">
                {"<"}
              </span>
              <span className="text-white transition-colors duration-200 group-hover:text-white/90">
                {personalInfo.firstName}
              </span>
              <span className="text-violet-400 transition-colors duration-200 group-hover:text-violet-300">
                {"/>"}
              </span>
            </motion.span>
            <span className="absolute -bottom-1 left-0 w-0 h-px bg-gradient-to-r from-violet-500 to-sky-400 transition-all duration-300 group-hover:w-full rounded-full" />
          </Link>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3, duration: 0.6, ease: "easeOut" }}
          >
            <Socials />
          </motion.div>
        </div>
      </div>

      <div className={`absolute bottom-0 left-0 right-0 h-px transition-opacity duration-500 ${
        scrolled ? "opacity-0" : "opacity-100"
      } bg-gradient-to-r from-transparent via-violet-500/30 to-transparent`} />
    </motion.header>
  );
}