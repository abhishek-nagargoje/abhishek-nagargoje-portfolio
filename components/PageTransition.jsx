"use client";

import { useEffect, useState } from "react";
import Transition from "./Transition";

// Plays the wipe only on client-side navigations between routes. On the
// first page load it never renders, so it can't cover (and delay) the first
// paint the way the old always-on overlay did.
let hasMountedOnce = false;

export default function PageTransition({ children }) {
  const [play] = useState(() => hasMountedOnce);
  useEffect(() => {
    hasMountedOnce = true;
  }, []);

  return (
    <>
      {play && <Transition />}
      {children}
    </>
  );
}
