"use client";
import { motion } from "framer-motion";

// Three-layer purple wipe between pages. Animates only `scaleX` (compositor-
// only) — the previous version animated `width`, forcing layout every frame —
// and finishes in ~0.6s instead of ~1.2s.
const layers = [
  { color: "#2e2257", z: "z-30", delay: 0 },
  { color: "#3b2d71", z: "z-20", delay: 0.08 },
  { color: "#4b3792", z: "z-10", delay: 0.16 },
];

const Transition = () => (
  <>
    {layers.map(({ color, z, delay }) => (
      <motion.div
        key={color}
        aria-hidden
        className={`fixed inset-0 ${z} pointer-events-none origin-left`}
        style={{ background: color }}
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ delay, duration: 0.45, ease: [0.65, 0, 0.35, 1] }}
      />
    ))}
  </>
);

export default Transition;
