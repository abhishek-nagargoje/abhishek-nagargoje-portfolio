"use client";
import { useEffect, useRef } from "react";
import { motion, useMotionValue, useTransform, animate, useInView } from "framer-motion";

// Counts up once when it scrolls into view. Server HTML renders the final
// value (no "0+" flash for crawlers / no-JS); reduced-motion skips the tween.
const Counter = ({ to, suffix = "" }) => {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  const count = useMotionValue(to);
  const rounded = useTransform(count, (v) => Math.round(v) + suffix);
  useEffect(() => {
    if (!inView) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      count.set(to);
      return;
    }
    count.set(0);
    const c = animate(count, to, { duration: 1.6, ease: "easeOut" });
    return c.stop;
  }, [inView, to, count]);
  return <motion.span ref={ref}>{rounded}</motion.span>;
};

export default Counter;
