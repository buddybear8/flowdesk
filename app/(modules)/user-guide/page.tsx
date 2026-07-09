import type { CSSProperties } from "react";

// Champagne Intelligence — in-app user guide / operator's manual.
// Static content; mirrors flowdesk-manual-mockup.html in the platform theme.

const GOLD = "#C9A55A";
const BUY = "#3FB950";
const SELL = "#E5534B";
const CYAN = "#22D3EE";
const AMBER = "#E2BF73";
const TP = "var(--color-text-primary)";
const T2 = "var(--color-text-secondary)";
const T3 = "var(--color-text-tertiary)";
const BORDER = "0.5px solid var(--color-border-tertiary)";

export default function UserGuidePage() {
  return (
    <div className="flex-1 overflow-y-auto" style={{ background: "var(--color-background-tertiary)" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "22px 28px 80px" }}>
        {/* Hero */}
        <div style={{ background: "linear-gradient(160deg, var(--color-background-secondary), var(--color-background-primary))", border: BORDER, borderRadius: 16, padding: "24px 26px", marginBottom: 22 }}>
          <div style={{ fontSize: 24, fontWeight: 600, color: TP, marginBottom: 6 }}>Champagne Intelligence Operator’s Manual</div>
          <div style={{ color: T2, maxWidth: 640, lineHeight: 1.6 }}>
            Champagne Intelligence is an options-analytics workstation that pulls live market structure — options flow,
            dealer gamma, dark-pool prints, and Champagne Sessions trade alerts — into one dashboard. This guide explains
            what every module does and how to read it.
          </div>
        </div>

        {/* Refresh cadence */}
        <H2>Refresh cadence</H2>
        <P>
          Most modules refresh every <B>2–10 minutes during market hours</B> (Mon–Fri, 9:30 AM–4:00 PM ET); a few run
          premarket or hourly. The view auto-refreshes on top of that (typically every 60s) so you rarely need to reload.
          Each panel carries a small <B>freshness dot</B>{" "}
          <span style={{ fontSize: 11, color: BUY, border: `0.5px solid rgba(63,185,80,.4)`, borderRadius: 20, padding: "2px 8px", whiteSpace: "nowrap" }}>
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: BUY, marginRight: 5 }} />67s
          </span>{" "}
          showing how long ago its data landed.
        </P>

        {/* Reading the interface */}
        <H2>Reading the interface</H2>
        <div style={grid2}>
          <Card>
            <H3>Navigation</H3>
            <Ul>
              <li>Pick a module from the <B>left sidebar</B>.</li>
              <li>Modules with <B>sub-tabs</B> show them along the top; the breadcrumb (top-left) tracks where you are.</li>
              <li>The tab you’re on is saved in the URL (<Kbd>?tab=1</Kbd>), so views are shareable/bookmarkable.</li>
              <li>The top-right pill shows <B>Market open / closed</B>.</li>
              <li>Anywhere you see a ticker box, type any symbol (1–5 letters) and press Enter.</li>
            </Ul>
          </Card>
          <Card>
            <H3>Color &amp; symbol legend</H3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px" }}>
              <Legend sw={BUY}>Bullish · bought-at-ask · calls · gains</Legend>
              <Legend sw={SELL}>Bearish · sold-at-bid · puts · losses</Legend>
              <Legend sw={GOLD}>Active tab / selected</Legend>
              <Legend sw={CYAN}>Spot price line</Legend>
              <Legend sw={AMBER}>Neutral / partial</Legend>
              <Legend mono="↕ ▲ ▼">Sortable column</Legend>
            </div>
            <div style={{ fontSize: 12, color: T2, marginTop: 10 }}>
              Any table with <span style={{ fontFamily: "monospace" }}>↕</span> headers is <B>sortable</B> — click a header
              to sort by it, click again to flip direction. Each table sorts independently.
            </div>
          </Card>
        </div>

        {/* Modules */}
        <H2>The modules</H2>

        <Mod icon="📋" title="Daily watches" route="/watches" one="A ranked top-10 of tickers showing a confluence of signals, computed every morning.">
          <H4>What it does</H4>
          <P>Every morning premarket, scores the prior session across four independent signals — <B>flow</B> (premium and
            conviction of notable options orders), <B>sentiment</B> (extreme call/put ratios), <B>dark pool</B> (ranked
            off-exchange prints), and <B>persistence</B> (kept signaling across recent sessions) — and ranks the top 10
            by confluence. Names firing several signals at once outrank one-signal wonders.</P>
          <H4>How to use it</H4>
          <Ul>
            <li>The <B>Signals</B> column shows which categories fired: <B>F</B> flow, <B>S</B> sentiment (green/red by
              side), <B>DP</B> dark pool, <B>×N</B> signaled N of the last 5 sessions.</li>
            <li>Click a row for the detail panel: the <B>confluence score breakdown</B>, a suggested <B>contract to
              watch</B> (expiry within 3 months, matching the signal direction), and <B>move targets</B> — Target 1 / 2 / 3 in the
              signal&rsquo;s direction (upside for bullish picks, downside for bearish).</li>
            <li>This is a screening list, not trade advice — validate each name yourself; the targets frame the size of
              move that would be normal vs outsized.</li>
          </Ul>
        </Mod>

        <Mod icon="🌊" title="Market Pulse" route="/market-tide" one="Is the whole market leaning bullish or bearish right now?">
          <H4>What it does</H4>
          <P>Aggregates options activity across the entire market into a single intraday <B>pulse</B> — net call premium vs
            net put premium — so you can read overall risk appetite at a glance, independent of any one ticker.</P>
          <H4>How to use it</H4>
          <Ul>
            <li>Rising pulse = net <span style={{ color: BUY }}>call buying</span> (risk-on); falling = net{" "}
              <span style={{ color: SELL }}>put buying</span> (risk-off).</li>
            <li>Use it as market context before acting on a single-name signal from another module.</li>
          </Ul>
        </Mod>

        <Mod icon="⚡" title="Options GEX" route="/gex" one="Dealer gamma positioning — where price gets pinned vs where it accelerates." tabs={["GEX overview", "Heatmap"]}>
          <H4>What it does</H4>
          <P>Shows how options dealers are positioned in gamma. <B>Positive-gamma</B> strikes are stabilizing (dealers sell
            rallies / buy dips → price gets “pinned”); <B>negative-gamma</B> zones are destabilizing (hedging accelerates
            moves → more volatility). The <B>gamma-flip</B> level is the pivot between the two.</P>
          <H4>How to use it</H4>
          <Ul>
            <li><B>GEX overview</B> — net gamma by strike, the gamma-flip level, and key support/resistance. Big
              positive-gamma strikes act as magnets; watch the flip as a regime line.</li>
            <li><B>Heatmap</B> — a strike × expiration grid; scan across expirations to see where positioning concentrates.
              Top GEX nodes are highlighted in yellow and often act as major magnets when far away, and support/resistance
              when price reaches the node. A <B>GEX / VEX</B> toggle switches the grid to vanna exposure — where dealer
              hedging shifts when implied volatility moves. A <B>Near / Swing</B> toggle controls the columns: Near shows
              the closest expirations (including dailies on the big index names), while Swing shows the next five weekly
              Friday expirations for a multi-week view.</li>
            <li>Enter any ticker in the ticker box.</li>
          </Ul>
          <H4>Good to know</H4>
          <P>If a name shows <B>“unavailable — data isn’t available for this chain right now,”</B> the underlying chain has a
            temporary gap for that ticker; it self-heals automatically.</P>
        </Mod>

        <Mod icon="🎯" title="Options sentiment" route="/flow-sentiment" one="Who’s buying and who’s selling — calls vs puts, at the ask vs the bid." tabs={["Market dashboard", "Ticker view"]}>
          <H4>What it does</H4>
          <P>Turns raw options volume into directional pressure: contracts <span style={{ color: BUY }}>bought at the ask</span>{" "}
            (aggressive buyers) vs <span style={{ color: SELL }}>sold at the bid</span> (aggressive sellers), split by calls
            and puts.</P>
          <H4>How to use it</H4>
          <Ul>
            <li><B>Market dashboard</B> (the default landing tab) — a market-wide scan: Call/Put and Buy/Sell ratios for the
              major indices and mega caps, plus <B>Top bullish</B> (C/P &gt; 2.0) and <B>Top bearish</B> (C/P &lt; 0.5)
              leaderboards, filtered to liquid names. Every table is sortable; <B>click any ticker</B> to jump straight to
              its Ticker view.</li>
            <li><B>Ticker view</B> — per-strike bars with calls to the left, puts to the right, green (buy) vs red (sell).
              The dashed cyan line marks spot; the margins show each strike’s <B>buy/sell ratio</B>. Drag the{" "}
              <B>replay slider</B> to watch the session build minute-by-minute, and toggle how many strikes (10–40) to show.</li>
          </Ul>
        </Mod>

        <Mod icon="🔔" title="Trade alerts" route="/trade-alerts" one="Champagne Sessions trade alerts, tracked automatically with live P/L." tabs={["Options alerts", "Equities alerts"]}>
          <H4>What it does</H4>
          <P>Pulls every moderator trade alert from Champagne Sessions Discord and stitches the buy/add/trim/sell messages
            into positions. Open trades are marked to the current option price for a <B>live P/L</B>; closed trades show{" "}
            <B>realized</B> results. A running <B>track record</B> and a size-weighted <B>equity curve</B> summarize
            performance.</P>
          <H4>How to use it</H4>
          <Ul>
            <li><B>Open Now</B> — the live book. <B>MID</B> = current price, <B>LIVE P/L</B> = mark-to-market vs entry,{" "}
              <B>REMAINING</B> = how much of the position is still on.</li>
            <li><B>Track record</B> — closed history with realized results.</li>
            <li>Contract names are <span style={{ color: BUY }}>green for calls</span> /{" "}
              <span style={{ color: SELL }}>red for puts</span>. <B>ALERTED</B> = date posted; <B>ALERTED BY</B> = which
              moderator. Every column is sortable.</li>
            <li>Two sub-tabs split <B>Options</B> vs <B>Equities</B> alerts.</li>
          </Ul>
        </Mod>

        <Mod icon="📡" title="Flow alerts" route="/flow" one="Real-time unusual options flow as it prints." tabs={["Live feed", "Lottos", "Opening Sweeps"]}>
          <H4>What it does</H4>
          <P>Surfaces notable options orders in real time — large, aggressive, or unusual trades that can signal informed
            positioning.</P>
          <H4>How to use it</H4>
          <Ul>
            <li><B>Live feed</B> — the full stream of flow alerts as they arrive.</li>
            <li><B>Lottos</B> — cheap, short-dated, high-risk/high-reward contracts.</li>
            <li><B>Opening Sweeps</B> — aggressive multi-exchange orders that <em>open</em> new positions (often the
              highest-conviction prints).</li>
          </Ul>
        </Mod>

        <Mod icon="🌑" title="Dark pools" route="/darkpool" one="Large off-exchange prints and the price levels they cluster at." tabs={["Ranked feed", "DP levels"]}>
          <H4>What it does</H4>
          <P>Shows dark-pool (off-exchange) prints — often institutional-sized trades that don’t hit the public tape the
            same way. Clusters of prints at a price can act as support/resistance.</P>
          <H4>How to use it</H4>
          <Ul>
            <li><B>Ranked feed</B> — the most significant prints, ranked.</li>
            <li><B>DP levels</B> — prints aggregated into price levels to watch.</li>
          </Ul>
        </Mod>

        <Mod icon="📈" title="Charts" route="/charts" one="Interactive charting with embedded TradingView charts.">
          <H4>What it does</H4>
          <P>Interactive charting with embedded TradingView charts showing ranked dark pool trades. Overlay toggles let
            you layer on <B>ranked trades</B> (numbered bubbles and horizontal levels), <B>GEX levels</B> (call wall,
            put wall, gamma flip, and the top GEX nodes), and <B>Watch targets</B> — the Target 1 / 2 / 3 ladder from
            the ticker&apos;s most recent Daily Watches appearance.</P>
        </Mod>

        <Mod icon="🏆" title="Community gains" route="/community-gains" one="Group performance over time.">
          <H4>What it does</H4>
          <P>Interactive chart showing cumulative verified Champagne Sessions Discord member gains, to track overall group
            performance over time.</P>
        </Mod>

        {/* Live values & availability */}
        <H2>Live values &amp; availability</H2>
        <div style={grid2}>
          <Card>
            <H3>Live-priced values</H3>
            <P>Some live values (like Trade-alert P/L) update on a daily budget that resets after the post-market close
              (8 PM EST). On heavy days that budget can run out, at which point those values hold at their{" "}
              <B>last-known reading</B> until it resets the next session. Historical and stored views are always available.</P>
          </Card>
          <Card>
            <H3>Temporary data gaps</H3>
            <P>Occasionally a specific ticker’s data is temporarily unavailable. Rather than render a broken or misleading
              panel, Champagne Intelligence shows a clean <B>“unavailable”</B> state and recovers automatically once the
              data returns.</P>
          </Card>
        </div>

        {/* Glossary */}
        <H2>Glossary</H2>
        <div style={{ background: "var(--color-background-primary)", border: BORDER, borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {GLOSSARY.map(([term, def]) => (
                <tr key={term} style={{ borderBottom: BORDER }}>
                  <td style={{ padding: "9px 14px", width: 210, verticalAlign: "top" }}><B>{term}</B></td>
                  <td style={{ padding: "9px 14px", color: T2, verticalAlign: "top" }}>{def}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const GLOSSARY: [string, string][] = [
  ["GEX (Gamma Exposure)", "How much dealers must buy/sell to stay hedged as price moves. Drives whether price gets pinned (positive) or pushed (negative)."],
  ["Gamma flip", "The price level where net dealer gamma crosses zero — the pivot between a stabilizing and a destabilizing regime."],
  ["Spot", "The current underlying price (shown as the dashed cyan line on strike charts)."],
  ["C/P ratio", "Call volume ÷ put volume. >1 leans bullish, <1 leans bearish."],
  ["Buy/Sell (B/S) ratio", "Contracts bought at the ask ÷ sold at the bid. >1 = net aggressive buying."],
  ["Bought at ask / Sold at bid", "Aggressor side of a trade — who “crossed the spread.” The core of the Options-sentiment read."],
  ["0DTE / DTE", "Days to expiration. 0DTE = expiring today."],
  ["Live P/L vs Realized", "Live = open position marked to current price; Realized = banked result from closed portions."],
  ["Size (Lotto / S / M / L)", "A trade alert’s conviction/size tag — used to weight the equity curve."],
  ["Sweep", "An order split across multiple exchanges to fill fast — often urgent, higher-conviction."],
  ["Lotto", "A cheap, short-dated, high-risk/high-reward options bet."],
  ["Dark-pool print", "A trade executed off the public exchanges, frequently institutional-sized."],
  ["Market pulse", "Net call-vs-put premium across the whole market — an aggregate risk-appetite gauge."],
];

const grid2: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 };

function H2({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 18, fontWeight: 600, color: TP, margin: "30px 0 12px", paddingTop: 12, borderTop: BORDER }}>{children}</div>;
}
function H3({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 14, fontWeight: 600, color: TP, margin: "0 0 6px" }}>{children}</div>;
}
function H4({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: GOLD, margin: "12px 0 4px", fontWeight: 600 }}>{children}</div>;
}
function P({ children, style }: { children: React.ReactNode; style?: CSSProperties }) {
  return <div style={{ color: T2, lineHeight: 1.65, margin: "4px 0 0", ...style }}>{children}</div>;
}
function B({ children }: { children: React.ReactNode }) {
  return <b style={{ color: TP, fontWeight: 600 }}>{children}</b>;
}
function Ul({ children }: { children: React.ReactNode }) {
  return <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: T2, lineHeight: 1.6 }}>{children}</ul>;
}
function Kbd({ children }: { children: React.ReactNode }) {
  return <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, background: "var(--color-background-tertiary)", border: BORDER, borderRadius: 4, padding: "1px 6px", color: "#cfe0f5" }}>{children}</span>;
}
function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background: "var(--color-background-primary)", border: BORDER, borderRadius: 12, padding: "16px 18px" }}>{children}</div>;
}
function Legend({ sw, mono, children }: { sw?: string; mono?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: T2 }}>
      {sw && <span style={{ width: 12, height: 12, borderRadius: 3, background: sw, flex: "none" }} />}
      {mono && <span style={{ fontFamily: "monospace" }}>{mono}</span>}
      {children}
    </div>
  );
}
function Mod({ icon, title, route, one, tabs, children }: { icon: string; title: string; route: string; one?: string; tabs?: string[]; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--color-background-primary)", border: BORDER, borderRadius: 14, overflow: "hidden", margin: "16px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 18px", borderBottom: BORDER }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center", fontSize: 17, background: "var(--color-background-secondary)", border: BORDER, flex: "none" }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div><b style={{ fontSize: 15, color: TP }}>{title}</b><span style={{ color: T3, fontSize: 12, marginLeft: 8, fontFamily: "ui-monospace, monospace" }}>{route}</span></div>
          {one && <div style={{ color: T2, fontSize: 12.5, marginTop: 1 }}>{one}</div>}
        </div>
        {tabs && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {tabs.map((t) => (
              <span key={t} style={{ fontSize: 10.5, border: BORDER, borderRadius: 20, padding: "3px 10px", color: T2, background: "var(--color-background-secondary)", whiteSpace: "nowrap" }}>{t}</span>
            ))}
          </div>
        )}
      </div>
      <div style={{ padding: "14px 18px 18px" }}>{children}</div>
    </div>
  );
}
