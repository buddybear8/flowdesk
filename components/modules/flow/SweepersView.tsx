// Opening Sweeps placeholder — the sweeper feed is not yet wired, so the tab
// shows a "Coming Soon" state. The previous table/filter UI is preserved in
// git history; restore it here once the sweeper feed is producing rows.

export function SweepersView() {
  return (
    <div
      className="flex flex-1 items-center justify-center"
      style={{ background: "var(--color-background-tertiary)" }}
    >
      <div
        style={{
          fontSize: 52,
          fontWeight: 600,
          color: "#E2BF73",
          letterSpacing: "0.01em",
          lineHeight: 1.1,
        }}
      >
        Coming Soon
      </div>
    </div>
  );
}
