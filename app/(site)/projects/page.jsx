export const dynamic = "force-static";

import PageTransition from "../../../components/PageTransition";
import Projects from "../../../components/pages/Projects";

export const metadata = {
  alternates: { canonical: "projects/" },
  title: "Projects",
  description:
    "Production business websites built at Kargar Business Services, platforms currently in development, and personal projects by Abhishek Nagargoje.",
};

export default function ProjectsPage() {
  return (
    <PageTransition>
      <Projects />
    </PageTransition>
  );
}
