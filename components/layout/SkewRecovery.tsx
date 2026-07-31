"use client";

// Deployment-skew self-healing. A long-lived tab holds JS from an older
// deploy; after a new deploy, client-side navigation (RSC payload / lazy
// chunk fetches) can fail silently and the UI stops responding to clicks
// until a manual refresh. This listens for those specific failures and
// performs ONE automatic hard reload (10-minute guard prevents loops).

import { useEffect } from "react";

const GUARD_KEY = "cs-skew-reload-at";
const GUARD_MS = 10 * 60 * 1000;

function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(GUARD_KEY) ?? 0);
    if (Date.now() - last < GUARD_MS) return;
    sessionStorage.setItem(GUARD_KEY, String(Date.now()));
  } catch { /* still reload */ }
  window.location.reload();
}

function isSkewError(msg: string): boolean {
  return (
    /ChunkLoadError|Loading chunk .* failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg) ||
    /Failed to fetch RSC payload/i.test(msg)
  );
}

export function SkewRecovery() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (isSkewError(e.message ?? "")) reloadOnce();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const msg = e.reason instanceof Error ? e.reason.message : String(e.reason ?? "");
      if (isSkewError(msg)) reloadOnce();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
