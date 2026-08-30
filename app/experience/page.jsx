export const dynamic = "force-static";

import PageTransition from "../../components/PageTransition";
import Experience from "../../components/pages/Experience";

export const metadata = {
  title: "Experience",
  description:
    "Abhishek Nagargoje's professional experience as Full-Stack Developer & AI Agent Developer at Kargar Business Services.",
};

export default function ExperiencePage() {
  return (
    <PageTransition>
      <Experience />
    </PageTransition>
  );
}
