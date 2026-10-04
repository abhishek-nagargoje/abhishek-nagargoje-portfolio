// Absolute site URL (always with a trailing slash so relative paths resolve
// *inside* the GitHub Pages subpath instead of replacing it).
// On Vercel, VERCEL_PROJECT_PRODUCTION_URL is the stable production domain
// (set automatically at build time — no protocol prefix). Falls back to the
// GitHub Pages URL for that deploy target.
export const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/`
  : "https://n-abhishek-s.github.io/abhishek-nagargoje-portfolio/";
