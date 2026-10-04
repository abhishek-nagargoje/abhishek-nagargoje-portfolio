"use client";
import { MotionConfig } from "framer-motion";

// Honour the OS "reduce motion" setting for every framer-motion animation:
// transforms are skipped, opacity fades are kept.
export default function MotionProvider({ children }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
