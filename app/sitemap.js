import { siteUrl } from "../lib/site";

export const dynamic = "force-static";

const routes = ["", "about/", "experience/", "projects/", "achievements/", "contact/"];

export default function sitemap() {
  return routes.map((path) => ({
    url: `${siteUrl}${path}`,
    changeFrequency: "monthly",
    priority: path === "" ? 1 : 0.7,
  }));
}
