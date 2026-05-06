"use client";

// Shared rendering atoms used by both FlowView (filterable Live feed) and
// any preset-filter view (Lottos, Opening Sweepers, …). Keeping them here
// rather than re-exporting from FlowView avoids a circular dependency the
// moment a preset view wants to render its own stats strip differently.

import type { CSSProperties, ReactNode } from "react";

export function fmtP(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return s + "$" + Math.round(a / 1e3) + "K";
  return s + "$" + a;
}

export function StatGroup({ children, last }: { children: ReactNode; last?: boolean }) {
  return (
    <div
      className="flex items-center gap-[4px]"
      style={{
        fontSize: 11,
        paddingRight: 12,
        marginRight: 12,
        borderRight: last ? "none" : "0.5px solid var(--color-border-tertiary)",
        marginLeft: last ? "auto" : undefined,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  );
}

export function SV({ color, children, style }: { color: string; children: ReactNode; style?: CSSProperties }) {
  return <span style={{ fontWeight: 500, color, ...style }}>{children}</span>;
}

export function SL({ children }: { children: ReactNode }) {
  return <span style={{ color: "var(--color-text-tertiary)", fontSize: 10 }}>{children}</span>;
}

export function Th({ children }: { children: ReactNode }) {
  return (
    <th
      style={{
        position: "sticky",
        top: 0,
        zIndex: 2,
        background: "var(--color-background-primary)",
        padding: "6px 10px",
        textAlign: "left",
        fontSize: 9,
        fontWeight: 500,
        color: "var(--color-text-tertiary)",
        textTransform: "uppercase",
        letterSpacing: ".05em",
        borderBottom: "0.5px solid var(--color-border-tertiary)",
        whiteSpace: "nowrap",
        cursor: "pointer",
      }}
    >
      {children}
    </th>
  );
}

export function Td({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <td style={{ padding: "6px 10px", verticalAlign: "middle", whiteSpace: "nowrap", ...style }}>
      {children}
    </td>
  );
}

type BadgeKind = "call" | "put" | "buy" | "sell" | "sweep" | "floor" | "single" | "block";
const BADGE_STYLES: Record<BadgeKind, { bg: string; color: string }> = {
  call: { bg: "rgba(127, 191, 82, 0.14)", color: "#7FBF52" },
  put: { bg: "rgba(231, 106, 106, 0.14)", color: "#E76A6A" },
  buy: { bg: "rgba(127, 191, 82, 0.14)", color: "#7FBF52" },
  sell: { bg: "rgba(231, 106, 106, 0.14)", color: "#E76A6A" },
  sweep: { bg: "#FAEEDA", color: "#633806" },
  floor: { bg: "#EEEDFE", color: "#3C3489" },
  single: { bg: "#F1EFE8", color: "#A8A496" },
  block: { bg: "rgba(201, 165, 90, 0.18)", color: "#C9A55A" },
};

export function Badge({ type, children }: { type: BadgeKind; children: ReactNode }) {
  const { bg, color } = BADGE_STYLES[type];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 9,
        fontWeight: 500,
        padding: "2px 6px",
        borderRadius: 3,
        background: bg,
        color,
      }}
    >
      {children}
    </span>
  );
}

const CONF_STYLES: Record<string, { bg: string; color: string }> = {
  HIGH: { bg: "rgba(127, 191, 82, 0.14)", color: "#7FBF52" },
  MED: { bg: "#FAEEDA", color: "#633806" },
  MOD: { bg: "#FAEEDA", color: "#633806" },
  LOW: { bg: "rgba(231, 106, 106, 0.14)", color: "#E76A6A" },
};

export function ConfBadge({ conf }: { conf: string }) {
  const s = CONF_STYLES[conf] ?? CONF_STYLES.MED!;
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 500,
        padding: "2px 6px",
        borderRadius: 3,
        background: s.bg,
        color: s.color,
        display: "inline-flex",
      }}
    >
      {conf}
    </span>
  );
}
