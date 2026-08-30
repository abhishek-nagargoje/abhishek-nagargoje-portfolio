export const dynamic = "force-static";

import PageTransition from "../../components/PageTransition";
import Contact from "../../components/pages/Contact";

export const metadata = {
  title: "Contact",
  description:
    "Get in touch with Abhishek Nagargoje for software development and AI project collaborations.",
};

export default function ContactPage() {
  return (
    <PageTransition>
      <Contact />
    </PageTransition>
  );
}
