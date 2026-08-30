"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "../../lib/supabase/auth";

const NAV = [
  { name: "Dashboard", path: "/admin" },
  { name: "Projects", path: "/admin/projects" },
  { name: "Experience", path: "/admin/experience" },
  { name: "Skills", path: "/admin/skills" },
  { name: "Education", path: "/admin/education" },
  { name: "Profile", path: "/admin/profile" },
];

export default function AdminShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await signOut();
    router.replace("/admin/login");
  };

  return (
    <div className="min-h-screen flex" style={{ background: "#080b14", color: "#f1f5f9" }}>
      <aside
        className="w-56 shrink-0 hidden md:flex flex-col gap-1 p-5"
        style={{ borderRight: "1px solid rgba(255,255,255,0.08)" }}
      >
        <p className="text-xs uppercase tracking-widest text-white/30 mb-4 px-2">Admin</p>
        {NAV.map((item) => {
          const active = pathname === item.path;
          return (
            <Link
              key={item.path}
              href={item.path}
              className="px-3 py-2 rounded-lg text-sm transition-colors"
              style={{
                background: active ? "rgba(99,102,241,0.15)" : "transparent",
                color: active ? "#a5b4fc" : "rgba(255,255,255,0.6)",
              }}
            >
              {item.name}
            </Link>
          );
        })}
        <button
          onClick={handleLogout}
          className="mt-auto px-3 py-2 rounded-lg text-sm text-left"
          style={{ color: "rgba(248,113,113,0.85)" }}
        >
          Log out
        </button>
      </aside>

      <div className="flex-1 min-w-0">
        <header
          className="flex md:hidden items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
        >
          <span className="text-sm font-semibold">Admin</span>
          <button onClick={handleLogout} className="text-xs" style={{ color: "rgba(248,113,113,0.85)" }}>
            Log out
          </button>
        </header>
        <nav className="flex md:hidden gap-2 px-4 py-2 overflow-x-auto" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          {NAV.map((item) => (
            <Link
              key={item.path}
              href={item.path}
              className="px-3 py-1.5 rounded-full text-xs whitespace-nowrap"
              style={{
                background: pathname === item.path ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.05)",
                color: pathname === item.path ? "#a5b4fc" : "rgba(255,255,255,0.6)",
              }}
            >
              {item.name}
            </Link>
          ))}
        </nav>
        <main className="p-5 md:p-8 max-w-5xl">{children}</main>
      </div>
    </div>
  );
}
