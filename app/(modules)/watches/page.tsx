// Daily Watches placeholder — the hit list UI lives in
// components/modules/watches/WatchesView.tsx and is fully built. Once the
// upstream ML model is producing rows for hit_list_daily, swap the body
// below back to `<WatchesView />` and this file is one line again.

export default function WatchesPage() {
  return (
    <div
      className="flex flex-1 items-center justify-center"
      style={{ background: "var(--color-background-tertiary)" }}
    >
      <div className="flex flex-col items-center gap-3 px-6 text-center">
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
        <div
          style={{
            fontSize: 14,
            color: "var(--color-text-secondary)",
            maxWidth: 480,
            lineHeight: 1.55,
          }}
        >
          The Daily Watches hit list is wired up and waiting for live data
          from the in-development ML model. Once that pipeline lands, this
          tab will populate automatically — the UI is already built.
        </div>
      </div>
    </div>
  );
}
