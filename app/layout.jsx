import Layout from "../components/Layout";
import { personalInfo } from "../data/personalInfo";
import "../styles/globals.css";

// On Vercel, VERCEL_PROJECT_PRODUCTION_URL is the stable production domain
// (set automatically at build time — no protocol prefix). Falls back to the
// GitHub Pages URL for that deploy target.
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "https://n-abhishek-s.github.io/abhishek-nagargoje-portfolio";

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${personalInfo.name} | Full-Stack Developer & AI Agent Developer`,
    template: `%s | ${personalInfo.name}`,
  },
  description:
    "Portfolio of Abhishek Nagargoje, Full-Stack Developer & AI Agent Developer at Kargar Business Services — building production-ready web applications, business platforms, and AI-powered solutions with React, Next.js, and modern technologies.",
  keywords: [
    "Abhishek Nagargoje",
    "Full-Stack Developer",
    "AI Agent Developer",
    "Kargar Business Services",
    "React Developer",
    "Next.js Developer",
  ],
  authors: [{ name: personalInfo.name, url: personalInfo.github }],
  openGraph: {
    type: "website",
    url: siteUrl,
    title: `${personalInfo.name} | Full-Stack Developer & AI Agent Developer`,
    description:
      "Building production-ready web applications, business platforms, and AI-powered solutions with React, Next.js, and modern technologies.",
    siteName: personalInfo.name,
    images: [{ url: "/avatar.png" }],
  },
  twitter: {
    card: "summary",
    title: `${personalInfo.name} | Full-Stack Developer & AI Agent Developer`,
    description:
      "Building production-ready web applications, business platforms, and AI-powered solutions with React, Next.js, and modern technologies.",
    images: ["/avatar.png"],
  },
};

const personJsonLd = {
  "@context": "https://schema.org",
  "@type": "Person",
  name: personalInfo.name,
  jobTitle: personalInfo.role,
  url: siteUrl,
  worksFor: {
    "@type": "Organization",
    name: personalInfo.company,
  },
  sameAs: [personalInfo.github, personalInfo.linkedin],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }}
        />
        <Layout>{children}</Layout>
      </body>
    </html>
  );
}
