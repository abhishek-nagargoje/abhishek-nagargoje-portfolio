/** @type {import('next').NextConfig} */

const repo = "abhishek-nagargoje-portfolio";
// `next build` always sets NODE_ENV=production, on Vercel too — so that alone
// can't distinguish a GitHub Pages subpath build from a Vercel root-domain build.
// Vercel sets its own VERCEL env var during build; only apply the GH Pages
// basePath when we're NOT building on Vercel.
const isGithubPagesBuild = process.env.NODE_ENV === "production" && !process.env.VERCEL;

const nextConfig = {
  output: "export",
  basePath: isGithubPagesBuild ? `/${repo}` : "",
  assetPrefix: isGithubPagesBuild ? `/${repo}/` : "",
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  env: {
    NEXT_PUBLIC_BASE_PATH: isGithubPagesBuild ? `/${repo}` : "",
  },
};

module.exports = nextConfig;