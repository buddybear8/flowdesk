"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  MODULES,
  COMMUNITY_PERFORMANCE,
  USER_GUIDE,
  SectionLabel,
  NavRow,
} from "@/components/layout/Sidebar";
import { useIsMobile } from "@/lib/use-mobile";

// Mobile-only (<768px) slide-in nav drawer. Renders the exact same nav entries
// as the desktop Sidebar (shared MODULES / COMMUNITY_PERFORMANCE / USER_GUIDE
// data + NavRow/SectionLabel components). Additive: never mounts on desktop.
export function MobileNavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const isMobile = useIsMobile();

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll while open so touch scrolling on the scrim / overscroll
  // chaining can't move the page underneath. Restore on close/unmount.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || !isMobile) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <style>{`
        @keyframes cs-drawer-scrim-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes cs-drawer-panel-in { from { transform: translateX(-100%); } to { transform: translateX(0); } }
      `}</style>
      {/* Dark scrim — tap to close */}
      <div
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: "rgba(0, 0, 0, 0.55)", animation: "cs-drawer-scrim-in 160ms ease-out" }}
      />
      {/* Slide-in panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="absolute left-0 top-0 flex h-full w-[240px] max-w-[82vw] flex-col bg-bg-primary"
        style={{
          overscrollBehavior: "contain",
          borderRight: "0.5px solid var(--color-border-tertiary)",
          animation: "cs-drawer-panel-in 200ms ease-out",
          boxShadow: "8px 0 32px rgba(0, 0, 0, 0.45)",
        }}
      >
        <div
          className="flex items-center gap-2 px-3 pt-3 pb-[10px]"
          style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}
        >
          <Link href="/" onClick={onClose} className="flex flex-1 items-center gap-2 cursor-pointer">
            <Image
              src="/logo.png"
              alt="Champagne Sessions"
              width={32}
              height={28}
              priority
              className="flex-shrink-0"
            />
            <div>
              <div className="text-[12px] font-semibold" style={{ color: "#E2BF73", letterSpacing: "0.02em" }}>Champagne Sessions</div>
              <div className="text-[9px] text-text-tertiary" style={{ marginTop: 1 }}>Trading intelligence</div>
            </div>
          </Link>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- initial focus
            // belongs inside the modal drawer when it opens
            autoFocus
            // box-content + padding + negative margin = 28px visual square
            // with a 40px touch target, no layout shift (mobile-only UI).
            className="box-content flex h-[28px] w-[28px] flex-shrink-0 items-center justify-center rounded-md p-[6px] -m-[6px] text-text-secondary hover:bg-bg-secondary"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Nav clicks bubble here — close only when an actual link was
            tapped, so a missed tap on a section label / whitespace doesn't
            dismiss the menu. overscroll-contain stops scroll chaining. */}
        <nav
          className="flex-1 overflow-y-auto px-[6px] py-[8px]"
          style={{ overscrollBehavior: "contain" }}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) onClose();
          }}
        >
          <SectionLabel>Modules</SectionLabel>
          {MODULES.map((item) => (
            <NavRow key={item.href} entry={item} active={pathname.startsWith(item.href)} />
          ))}
          <SectionLabel>Community performance</SectionLabel>
          {COMMUNITY_PERFORMANCE.map((item) => (
            <NavRow key={item.href} entry={item} active={pathname.startsWith(item.href)} />
          ))}
          <SectionLabel>User Guide</SectionLabel>
          {USER_GUIDE.map((item) => (
            <NavRow key={item.href} entry={item} active={pathname.startsWith(item.href)} />
          ))}
        </nav>

        <div className="px-[6px] py-[7px]" style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
          <Link
            href="/settings"
            onClick={onClose}
            className="flex items-center gap-[7px] rounded-md px-[9px] py-[6px] text-[11px] text-text-secondary hover:bg-bg-secondary"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M2 12c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            Settings
          </Link>
        </div>
      </aside>
    </div>
  );
}
