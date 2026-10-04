import { Suspense } from "react";
import Home from "../../components/pages/Home";
import About from "../../components/pages/About";
import Experience from "../../components/pages/Experience";
import Projects from "../../components/pages/Projects";
import Achievements from "../../components/pages/Achievements";
import Contact from "../../components/pages/Contact";
import Footer from "../../components/Footer";
import HydrateWhenNear from "../../components/HydrateWhenNear";

// One naturally scrolling page: Hero → About → Experience → Projects →
// Achievements → Contact → Footer. All sections are statically rendered
// into the HTML; the nav links to them by id.
//
// Each below-the-fold section sits in its own <Suspense> boundary and is
// hydrated only when it nears the viewport (HydrateWhenNear), so start-up
// work is just the hero + chrome instead of the whole page.
export default function HomePage() {
  return (
    <>
      <Home />
      <Suspense>
        <HydrateWhenNear id="about">
          <About embedded />
        </HydrateWhenNear>
      </Suspense>
      <Suspense>
        <HydrateWhenNear id="experience">
          <Experience embedded />
        </HydrateWhenNear>
      </Suspense>
      <Suspense>
        <HydrateWhenNear id="projects">
          <Projects embedded />
        </HydrateWhenNear>
      </Suspense>
      <Suspense>
        <HydrateWhenNear id="achievements">
          <Achievements embedded />
        </HydrateWhenNear>
      </Suspense>
      <Suspense>
        <HydrateWhenNear id="contact">
          <Contact embedded />
        </HydrateWhenNear>
      </Suspense>
      <Footer />
    </>
  );
}
