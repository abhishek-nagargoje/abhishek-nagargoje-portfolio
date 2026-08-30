export const dynamic = "force-static";

import PageTransition from "../../components/PageTransition";
import About from "../../components/pages/About";

export const metadata = {
  title: "About",
  description:
    "Abhishek Nagargoje — Full-Stack Developer & AI Agent Developer at Kargar Business Services, building production web applications and AI-powered solutions.",
};

export default function AboutPage() {
  return (
    <PageTransition>
      <About />
    </PageTransition>
  );
}
