// Centralized project data — single source of truth for the Projects page.
// tier controls visual hierarchy: "industry" > "current" > "personal".

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const projectTiers = [
  { id: "all", label: "All Projects" },
  { id: "industry", label: "Industry Projects" },
  { id: "current", label: "Currently Building" },
  { id: "personal", label: "Personal Projects" },
];

export const projectsData = [
  // ── Industry / production work — Kargar Business Services ──────────────
  {
    id: "kargar-business-services",
    title: "Kargar Business Services",
    company: "Kargar Business Services",
    tier: "industry",
    category: "Business Website / Production",
    role: "Full-Stack Developer",
    status: "Completed / Production",
    shortDescription:
      "Production business website for Kargar Business Services, built as part of my full-time role.",
    description:
      "The official business website for Kargar Business Services, a facility management company. Independently developed from scratch as a full-stack web application as part of my work as Full-Stack Developer & AI Agent Developer at the company.",
    techStack: ["Vite", "Tailwind CSS"],
    features: [],
    featured: true,
    thumbnail: null,
    links: { github: null, live: "https://www.kargarbusinessservices.com/" },
  },
  {
    id: "prezenti",
    title: "Prezenti",
    company: "Kargar Business Services",
    tier: "industry",
    category: "Business Website / Production",
    role: "Full-Stack Developer",
    status: "Completed / Production",
    shortDescription:
      "Production website for Prezenti, a facility management & corporate staffing company — developed during my work at Kargar Business Services.",
    description:
      "Prezenti connects businesses with trained support staff, offering end-to-end soft services including housekeeping, staffing, and security. Independently developed from scratch as a full-stack web application and delivered as part of my professional work.",
    techStack: ["Vite", "Tailwind CSS"],
    features: [],
    featured: true,
    thumbnail: null,
    links: { github: null, live: "https://www.prezenti.com/" },
  },
  {
    id: "vok",
    title: "VOK",
    company: "Kargar Business Services",
    tier: "industry",
    category: "Business Website / Production",
    role: "Full-Stack Developer",
    status: "Completed / Production",
    shortDescription:
      "Production website for VOK, a chartered accountancy firm — developed during my work at Kargar Business Services.",
    description:
      "Website for VOK & Associates, a chartered accountancy firm, presenting their professional accounting and financial services. Independently developed from scratch as a full-stack web application.",
    techStack: ["Vite", "Tailwind CSS"],
    features: [],
    featured: true,
    thumbnail: null,
    links: { github: null, live: "https://www.vok.co.in/" },
  },
  {
    id: "espacio-design-studio",
    title: "Espacio Design Studio",
    company: "Kargar Business Services",
    tier: "industry",
    category: "Business Website / Production",
    role: "Full-Stack Developer",
    status: "Completed / Production",
    shortDescription:
      "Production website for Espacio Design Studio, an architecture & interior design firm. Custom domain (espaciodesignstudio.in) is not yet connected — live link below points to the deployed site.",
    description:
      "Website for Espacio Design Studio, an architecture, interiors & turnkey solutions studio based in Pune. Independently developed from scratch as a full-stack web application. The studio's own domain, espaciodesignstudio.in, has not yet been pointed at this deployment, so the live link below opens the current production URL directly.",
    techStack: ["Vite", "Tailwind CSS"],
    features: [],
    featured: true,
    thumbnail: null,
    links: { github: null, live: "https://espacio-architect.vercel.app/" },
  },

  // ── Currently building — no public links yet ────────────────────────────
  {
    id: "skill-guru",
    title: "Skill Guru",
    company: "Kargar Business Services",
    tier: "current",
    category: "EdTech Platform",
    role: "Full-Stack Developer",
    status: "Currently Building",
    shortDescription:
      "An EdTech platform currently in development.",
    description:
      "Skill Guru is an education/EdTech platform currently in active development. Details will be added as the project reaches a public milestone.",
    techStack: [],
    features: [],
    featured: false,
    thumbnail: null,
    links: { github: null, live: null },
  },
  {
    id: "edtech-website",
    title: "EdTech Website",
    company: "Kargar Business Services",
    tier: "current",
    category: "EdTech Platform",
    role: "Full-Stack Developer",
    status: "Currently Building",
    shortDescription: "An education-focused website currently in development.",
    description:
      "An EdTech website currently in active development as part of ongoing professional work.",
    techStack: [],
    features: [],
    featured: false,
    thumbnail: null,
    links: { github: null, live: null },
  },
  {
    id: "macron",
    title: "Macron",
    company: "Kargar Business Services",
    tier: "current",
    category: "In Development",
    role: "Full-Stack Developer",
    status: "Currently Building",
    shortDescription: "Currently in development. Details to follow.",
    description:
      "Macron is currently in active development as part of ongoing professional work. Full details will be added once the project reaches a public milestone.",
    techStack: [],
    features: [],
    featured: false,
    thumbnail: null,
    links: { github: null, live: null },
  },

  // ── Personal / experimental projects ─────────────────────────────────────
  {
    id: "erp-finance-simulator",
    title: "SAP Finance Training Simulator",
    tier: "personal",
    category: "Finance / ERP Training App",
    role: "Solo Developer",
    status: "Live",
    shortDescription:
      "A working finance ERP training simulator with a sign-in screen: planning and analysis, parallel-ledger accounting and close, fixed assets, payables and receivables, GST and treasury.",
    description:
      "An interactive training simulator modelled on the finance areas of modern cloud ERP suites. Every screen runs on one double-entry ledger, so planning, operations, tax and cash always agree. Role-based users (preparer, approver, admin) let learners practise separation of duties end to end. Uses fictional data saved in the browser.",
    techStack: ["HTML", "CSS", "JavaScript"],
    features: [
      "Value driver tree simulation, plan versions, budget vs actuals and a planning calendar with reviewers",
      "Journals with approval workflow, IFRS and local GAAP parallel ledgers, INR/USD currencies",
      "Fixed assets with straight-line and declining-balance depreciation per ledger",
      "Automated GR/IR reconciliation and a period-close checklist that locks periods",
      "Supplier and customer invoices with GST, payment runs, receivables ageing",
      "GST return and settlement with credit carry-forward, live compliance controls and audit trail",
      "Cash position, weekly liquidity forecast and bank statement auto-matching",
    ],
    featured: true,
    thumbnail: null,
    links: { github: null, live: `${BASE}/erp-finance-simulator/index.html` },
  },
  {
    id: "client-photography-website",
    title: "Client Photography Website",
    company: null,
    tier: "personal",
    category: "Personal Client Project",
    role: "Full-stack — UI, animations & backend",
    status: "Live",
    shortDescription:
      "Independent photography portfolio built for a client — gallery-first design with GSAP animations and an Appwrite backend.",
    description:
      "A photography portfolio website developed independently for a client, prior to joining Kargar Business Services. Focused on visual presentation, smooth animations, and a modern UI suitable for a photography business.",
    techStack: ["React.js", "Tailwind CSS", "GSAP", "Appwrite", "REST API"],
    features: [
      "Responsive photography gallery",
      "Smooth page transitions via GSAP",
      "Appwrite backend integration",
      "Optimized image loading & display",
    ],
    featured: false,
    thumbnail: `${BASE}/clientWebImg.webp`,
    links: { github: null, live: "https://n-abhishek-s.github.io/Client_photography_Website/" },
  },
  {
    id: "ai-health-ecommerce-assistant",
    title: "AI Health & E-Commerce Assistant",
    company: null,
    tier: "personal",
    category: "Academic / Research Project",
    role: "Full-stack — UI, AI integration & backend",
    status: "Live",
    achievement: "Aavishkar State-Level Research Convention",
    shortDescription:
      "AI-powered platform combining healthcare assistance with e-commerce recommendations — academic research project presented at the Aavishkar State-Level Research Convention.",
    description:
      "An AI-powered platform blending healthcare assistance with smart e-commerce recommendations, developed as an academic research project (VeriMart) and presented at the 18th Maharashtra State Inter-University Research Convention (Aavishkar).",
    techStack: ["React.js", "Tailwind CSS", "Appwrite", "OpenAI API"],
    features: [
      "AI-based product recommendation engine",
      "Health assistance chat interface",
      "Smart product analysis & filtering",
      "OpenAI API integration",
    ],
    featured: false,
    thumbnail: `${BASE}/AiEcommercesWebImg.webp`,
    links: { github: null, live: "https://n-abhishek-s.github.io/AI_Ecommerce-Health-Assistant-/" },
  },
  {
    id: "marsidicars-showroom",
    title: "MarsidiCars — Car Showroom",
    company: null,
    tier: "personal",
    category: "Frontend Experiment",
    role: "Frontend — architecture, animations & design",
    status: "Live",
    shortDescription:
      "Automotive showroom frontend experiment with cinematic GSAP scroll animations and interactive layouts.",
    description:
      "A frontend-focused showroom concept for luxury vehicles, built to explore animated sections, interactive layouts, and fully responsive design with GSAP.",
    techStack: ["React.js", "Tailwind CSS", "GSAP"],
    features: [
      "Interactive car showcase layout",
      "Cinematic GSAP scroll animations",
      "Fully responsive across all devices",
    ],
    featured: false,
    thumbnail: `${BASE}/MarsadisWebImg.webp`,
    links: { github: null, live: "https://n-abhishek-s.github.io/Cars_Showroom" },
  },
];

export const industryProjects = projectsData.filter((p) => p.tier === "industry");
export const currentProjects = projectsData.filter((p) => p.tier === "current");
export const personalProjects = projectsData.filter((p) => p.tier === "personal");
