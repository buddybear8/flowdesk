"use client";

// Settings card: display timezone (US zones). Purely presentational — market
// hours, session dates, and alert logic stay ET; this changes how times are
// shown across charts, flow alerts, sentiment replay, and capture stamps.

import { US_TIMEZONES, useTimeZone, type UsTimeZoneId } from "@/lib/timezone";

export function TimezonePicker() {
  const { tz, setTz } = useTimeZone();
  const now = new Date();
  return (
    <div>
      <div className="flex flex-wrap gap-[7px]">
        {US_TIMEZONES.map((z) => {
          const active = tz === z.id;
          return (
            <button
              key={z.id}
              onClick={() => setTz(z.id as UsTimeZoneId)}
              className="rounded-md cursor-pointer"
              style={{
                fontSize: 12,
                padding: "7px 13px",
                fontFamily: "inherit",
                background: active ? "rgba(201,165,90,0.16)" : "var(--color-background-tertiary)",
                color: active ? "var(--color-brand-gold, #C9A55A)" : "var(--color-text-secondary)",
                border: `0.5px solid ${active ? "var(--color-brand-gold, #C9A55A)" : "var(--color-border-secondary)"}`,
                fontWeight: active ? 600 : 400,
              }}
            >
              <span style={{ display: "block" }}>{z.label}</span>
              <span style={{ display: "block", fontSize: 10, opacity: 0.75, marginTop: 1 }}>
                {now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: z.id })} {z.abbr}
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 10, lineHeight: 1.5 }}>
        Changes how times display across the platform — charts, flow alerts, sentiment replay, and data
        freshness stamps. Market hours and session dates remain based on Eastern (exchange) time.
      </div>
    </div>
  );
}
