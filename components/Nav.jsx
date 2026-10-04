"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  HiHome,
  HiUser,
  HiBriefcase,
  HiViewColumns,
  HiAcademicCap,
  HiEnvelope,
} from "react-icons/hi2";

// Each entry is a section on the single scrolling homepage. The standalone
// routes (/about, /projects, …) still exist for direct links; from any page
// these links lead to the matching homepage section.
export const navData = [
  { name: "home", id: "home", Icon: HiHome },
  { name: "about", id: "about", Icon: HiUser },
  { name: "experience", id: "experience", Icon: HiBriefcase },
  { name: "projects", id: "projects", Icon: HiViewColumns },
  { name: "achievements", id: "achievements", Icon: HiAcademicCap },
  { name: "contact", id: "contact", Icon: HiEnvelope },
];

// Scroll-spy: whichever section crosses the middle band of the viewport.
function useActiveSection(enabled) {
  const [active, setActive] = useState("home");
  useEffect(() => {
    if (!enabled) return;
    const els = navData.map((n) => document.getElementById(n.id)).filter(Boolean);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [enabled]);
  return active;
}

// On the homepage a native in-page anchor (instant, smooth via CSS
// scroll-behavior). From other routes, a router link to the homepage section.
export const SectionLink = ({ onHome, id, ...props }) =>
  onHome ? <a href={`#${id}`} {...props} /> : <Link href={`/#${id}`} {...props} />;

const Nav = () => {
  const pathname = usePathname();
  const onHome = pathname === "/";
  const spied = useActiveSection(onHome);
  const routeSection = pathname.replace(/^\/|\/$/g, "");
  const active = onHome ? spied : routeSection;

  return (
    <nav
      aria-label="Sections"
      className="flex flex-col items-center xl:justify-center gap-y-4 fixed h-max bottom-0 mt-auto xl:right-[2%] z-50 top-0 w-full xl:w-16 xl:max-w-md xl:h-screen pointer-events-none"
    >
      <ul className="pointer-events-auto flex w-full xl:flex-col items-center justify-between xl:justify-center gap-y-10 px-4 md:px-40 xl:px-0 h-[72px] xl:h-max xl:py-8 bg-[#0d0f1c]/85 xl:bg-white/10 backdrop-blur-sm text-2xl xl:text-xl xl:rounded-full border-t border-white/10 xl:border-0">
        {navData.map((link) => {
          const isActive = active === link.id;
          return (
            <li key={link.id}>
              <SectionLink
                onHome={onHome}
                id={link.id}
                aria-label={link.name}
                aria-current={isActive ? "true" : undefined}
                className={`${
                  isActive ? "text-accent" : "text-white"
                } relative flex items-center justify-center w-11 h-11 group hover:text-accent transition-colors duration-300 capitalize`}
              >
                {/* tooltip (desktop) */}
                <span
                  aria-hidden
                  className="absolute pr-14 right-0 hidden xl:group-hover:flex xl:group-focus-visible:flex"
                >
                  <span className="bg-white relative flex text-primary items-center p-[6px] rounded-[3px]">
                    <span className="text-[12px] leading-none font-semibold capitalize">{link.name}</span>
                    <span className="border-solid border-l-white border-l-8 border-y-transparent border-y-[6px] border-r-0 absolute -right-2" />
                  </span>
                </span>
                <link.Icon aria-hidden />
              </SectionLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default Nav;
