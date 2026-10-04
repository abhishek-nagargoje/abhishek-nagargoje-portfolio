/** @type {import('tailwindcss').Config} */

const repo = "abhishek-nagargoje-portfolio";
// Must match next.config.js: the GitHub Pages subpath applies only to
// production builds that are NOT on Vercel (Vercel serves from the root).
const isGithubPagesBuild = process.env.NODE_ENV === "production" && !process.env.VERCEL;
const base = isGithubPagesBuild ? `/${repo}` : "";

module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      padding: {
        DEFAULT: "15px",
      },
    },
    screens: {
      sm: "640px",
      md: "768px",
      lg: "960px",
      xl: "1200px",
    },
    extend: {
      colors: {
        primary: "#131424",
        secondary: "#393A47",
        accent: "#F13024",
      },
      backgroundImage: {
        explosion: `url("${base}/bg-explosion.png")`,
        circles:   `url("${base}/bg-circles.png")`,
        circleStar:`url("${base}/circle-star.svg")`,
        site:      `url("${base}/site-bg.svg")`,
      },
      animation: {
        "spin-slow": "spin 6s linear infinite",
      },
      fontFamily: {
        syne: ["var(--font-syne)", "sans-serif"],
        inter: ["var(--font-inter)", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  container: {
    padding: {
      DEFAULT: "15px",
    },
  },
  plugins: [require("tailwind-scrollbar")],
};