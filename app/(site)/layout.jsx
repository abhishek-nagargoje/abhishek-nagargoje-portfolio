import Layout from "../../components/Layout";

// Public-site chrome (header, section nav, background). Admin routes live
// outside this group so they never render — or download — any of it.
export default function SiteLayout({ children }) {
  return <Layout>{children}</Layout>;
}
