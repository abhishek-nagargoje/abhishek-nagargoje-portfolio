import Header from "./Header";
import Nav from "./Nav";
import TopLeftImg from "./TopLeftImg";
import MotionProvider from "./MotionProvider";
import { HydrationMarker } from "./HydrateWhenNear";

const Layout = ({ children }) => {
  return (
    <MotionProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-white focus:text-primary"
      >
        Skip to content
      </a>
      <HydrationMarker />
      <Header />
      <Nav />
      <main id="main" className="page bg-[#080b14] text-white font-sans relative">
        <TopLeftImg />
        {children}
      </main>
    </MotionProvider>
  );
};

export default Layout;
