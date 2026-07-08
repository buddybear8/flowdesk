"use client";

import { useEffect, useState } from "react";

// Shared mobile detector. SSR-safe: returns false until mounted, then tracks
// a matchMedia query (plus a resize fallback for older browsers/webviews).
// Breakpoint matches the app-wide mobile cutoff: < 768px.
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      mql.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, [breakpoint]);

  return isMobile;
}
