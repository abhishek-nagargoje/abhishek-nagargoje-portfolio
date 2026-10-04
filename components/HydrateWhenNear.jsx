"use client";
import { use, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// Defers hydrating a below-the-fold section until it is about to scroll into
// view. The server-rendered HTML is fully present the whole time (SEO, no-JS,
// anchors all work); React simply doesn't run that section's JS until needed.
//
// Mechanism: while the *initial* hydration is in progress, this component
// suspends on a promise that resolves when the section's element nears the
// viewport. React keeps a suspended boundary's server HTML in place and
// retries hydration once the promise resolves. After the first client-side
// navigation, deferral is switched off (and anything still waiting is
// released), so later visits to "/" render normally.

// Deferral only makes sense when the document the browser loaded *is* the
// server-rendered homepage. Landing on another route and navigating to "/"
// is a plain client render, so it never defers.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const loadedOnHome =
  typeof window !== "undefined" &&
  window.location.pathname.replace(basePath, "").replace(/\/+$/, "") === "";

let initialHydrationDone = !loadedOnHome;
const pending = new Map();
const resolvers = new Set();

function releaseAll() {
  initialHydrationDone = true;
  resolvers.forEach((r) => r());
  resolvers.clear();
}

function whenNear(id) {
  if (!pending.has(id)) {
    pending.set(
      id,
      new Promise((resolve) => {
        resolvers.add(resolve);
        const el = document.getElementById(id);
        if (!el || !("IntersectionObserver" in window)) return resolve();
        const io = new IntersectionObserver(
          (entries) => {
            if (entries.some((e) => e.isIntersecting)) {
              io.disconnect();
              resolve();
            }
          },
          { rootMargin: "600px 0px" }
        );
        io.observe(el);
      })
    );
  }
  return pending.get(id);
}

export default function HydrateWhenNear({ id, children }) {
  if (typeof window !== "undefined" && !initialHydrationDone) {
    use(whenNear(id));
  }
  return children;
}

// Rendered once in the site layout: the first route change ends the
// initial-load phase.
export function HydrationMarker() {
  const pathname = usePathname();
  const first = useRef(pathname);
  useEffect(() => {
    if (pathname !== first.current) releaseAll();
  }, [pathname]);
  return null;
}
