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
