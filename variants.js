// Shared entrance animation. Short, small offsets and a decelerating curve:
// content settles quickly instead of drifting in over 1.4s from 80px away.
export const fadeIn = (direction, delay) => {
  return {
    hidden: {
      y: direction === "up" ? 32 : direction === "down" ? -32 : 0,
      opacity: 0,
      x: direction === "left" ? 32 : direction === "right" ? -32 : 0,
    },
    show: {
      y: 0,
      x: 0,
      opacity: 1,
      transition: {
        type: "tween",
        duration: 0.7,
        delay: delay * 0.6,
        ease: [0.22, 1, 0.36, 1],
      },
    },
  };
};
