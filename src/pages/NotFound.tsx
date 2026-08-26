import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { BackToHome } from "@/components/ui/back-button";
import NavbarAuth from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import { trackRevenueEvent } from "@/lib/revenue-os";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
    trackRevenueEvent({
      eventType: 'PAGE_VIEWED',
      surface: 'not_found',
      metadata: { path: location.pathname },
    });
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-background">
      <NavbarAuth />
      <main className="mx-auto grid min-h-[60vh] max-w-2xl place-items-center px-4 py-12 text-center">
        <div className="rounded-2xl border border-slate-200 bg-white/85 p-8 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
          <p className="text-sm font-black uppercase text-purple-600 dark:text-purple-300">404</p>
          <h1 className="mt-2 text-4xl font-black text-slate-950 dark:text-white">Page not found</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-600 dark:text-slate-400">
            The page you opened does not exist or has moved.
          </p>
          <div className="mt-6">
            <BackToHome />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default NotFound;
