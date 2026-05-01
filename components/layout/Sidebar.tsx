"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

type NavEntry = {
  href: string;
  label: string;
  icon: string;
  badge?: { text: string; variant: "red" | "green" };
};

const MODULES: NavEntry[] = [
  { href: "/watches",     label: "Daily watches",     icon: "🔥",   badge: { text: "new", variant: "green" } },
  // Sentiment tracker — archived from V1 (PRD §7 archive banner). Route, page,
  // and component remain in the repo; un-comment this entry to re-enable.
  // { href: "/sentiment",   label: "Sentiment tracker", icon: "👑" },
  { href: "/market-tide", label: "Market Pulse",       icon: "🌀" },
  { href: "/gex",         label: "Options GEX",       icon: "⚡" },
  { href: "/flow",        label: "Flow alerts",       icon: "📈",   badge: { text: "18", variant: "red" } },
  { href: "/darkpool",    label: "Dark pools",        icon: "🌊" },
];

const ACCOUNT: NavEntry[] = [
  { href: "/watchlists", label: "Watchlists", icon: "★" },
  { href: "/alerts",     label: "Alerts",     icon: "🔔",  badge: { text: "3", variant: "red" } },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="flex h-full w-[192px] flex-shrink-0 flex-col bg-bg-primary"
      style={{ borderRight: "0.5px solid var(--color-border-tertiary)" }}
    >
      <div className="px-3 pt-3 pb-[10px]" style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
        <div className="mb-[9px] flex items-center gap-2">
          <div
            className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md"
            style={{ background: "#185FA5" }}
          >
            <svg viewBox="0 0 14 14" fill="none" width="14" height="14">
              <path d="M2 10L7 4L12 10" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div className="text-[14px] font-medium text-text-primary">FlowDesk</div>
            <div className="text-[9px] text-text-tertiary" style={{ marginTop: 1 }}>Trading intelligence</div>
          </div>
        </div>
        <input
          type="text"
          placeholder="Search nav..."
          className="w-full rounded-md bg-bg-secondary py-[5px] px-[9px] text-[11px] text-text-primary outline-none"
          style={{ border: "0.5px solid var(--color-border-secondary)" }}
        />
      </div>

      <nav className="flex-1 overflow-y-auto px-[6px] py-[8px]">
        <SectionLabel>Modules</SectionLabel>
        {MODULES.map(item => (
          <NavRow key={item.href} entry={item} active={pathname.startsWith(item.href)} />
        ))}
        <div className="mx-[2px] my-[6px] h-[0.5px]" style={{ background: "var(--color-border-tertiary)" }} />
        <SectionLabel>Account</SectionLabel>
        {ACCOUNT.map(item => (
          <NavRow key={item.href} entry={item} active={pathname.startsWith(item.href)} smallIcon />
        ))}
      </nav>

      <div className="px-[6px] py-[7px]" style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
        <Link
          href="/settings"
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
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-2 text-[9px] font-medium uppercase text-text-tertiary"
      style={{ letterSpacing: ".06em", margin: "6px 0 3px" }}
    >
      {children}
    </div>
  );
}

function NavRow({ entry, active, smallIcon }: { entry: NavEntry; active: boolean; smallIcon?: boolean }) {
  return (
    <Link
      href={entry.href}
      className={clsx(
        "flex items-center gap-2 rounded-md px-[9px] py-[7px] mb-[1px]",
        !active && "hover:bg-bg-secondary"
      )}
      style={{
        border: active ? "0.5px solid var(--color-border-info)" : "0.5px solid transparent",
        background: active ? "var(--color-background-info)" : undefined,
      }}
    >
      <span
        className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md"
        style={{
          fontSize: smallIcon ? 12 : 13,
          background: active ? "rgba(24,95,165,0.15)" : "var(--color-background-secondary)",
        }}
      >
        {entry.icon}
      </span>
      <span
        className={clsx("flex-1 text-[12px]", active ? "font-medium" : "")}
        style={{ color: active ? "var(--color-text-info)" : "var(--color-text-secondary)" }}
      >
        {entry.label}
      </span>
      {entry.badge && (
        <span
          className="rounded-full px-[5px] text-[8px] font-medium"
          style={{
            padding: "1px 5px",
            background: entry.badge.variant === "red" ? "#FCEBEB" : "#EAF3DE",
            color: entry.badge.variant === "red" ? "#A32D2D" : "#27500A",
          }}
        >
          {entry.badge.text}
        </span>
      )}
    </Link>
  );
}
