import { Syne, Inter, JetBrains_Mono } from "next/font/google";
import { personalInfo } from "../data/personalInfo";
import { siteUrl } from "../lib/site";
import "../styles/globals.css";

// Self-hosted at build time by next/font — no render-blocking request to
// Google Fonts, no layout shift from a late font swap (size-adjusted fallback).
// All three are variable fonts, so one file covers every weight in use.
const syne = Syne({ subsets: ["latin"], display: "swap", variable: "--font-syne" });
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-mono", preload: false });


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
  alternates: { canonical: "./" },
  openGraph: {
    type: "website",
    url: siteUrl,
    title: `${personalInfo.name} | Full-Stack Developer & AI Agent Developer`,
    description:
      "Building production-ready web applications, business platforms, and AI-powered solutions with React, Next.js, and modern technologies.",
    siteName: personalInfo.name,
    images: [{ url: "og-image.jpg", width: 1200, height: 630, alt: personalInfo.name }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${personalInfo.name} | Full-Stack Developer & AI Agent Developer`,
    description:
      "Building production-ready web applications, business platforms, and AI-powered solutions with React, Next.js, and modern technologies.",
    images: ["og-image.jpg"],
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

export const viewport = {
  themeColor: "#080b14",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${syne.variable} ${inter.variable} ${mono.variable}`}>
      <body suppressHydrationWarning>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
