export const dynamic = "force-static";

import PageTransition from "../../../components/PageTransition";
import Achievements from "../../../components/pages/Achievements";

export const metadata = {
  alternates: { canonical: "achievements/" },
  title: "Achievements",
  description:
    "Competitions, research convention placements, and certifications earned by Abhishek Nagargoje.",
};

export default function AchievementsPage() {
  return (
    <PageTransition>
      <Achievements />
    </PageTransition>
  );
}
