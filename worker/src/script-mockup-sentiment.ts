// Generates a standalone HTML mockup of the Options Sentiment dashboard using
// REAL UW data for a ticker today, with a working replay slider and the
// production layout (centered strike pills, 20 strikes centered on spot).
//
//   cd worker && <env> npx tsx src/script-mockup-sentiment.ts SPY
//
// Data strategy (mockup only — production polls /flow-per-strike every cadence
// tick for true full-chain snapshots):
//   • /flow-per-strike          → full-chain CUMULATIVE "now" state (real)
//   • 20 strikes centered on spot are selected from it
//   • /flow-per-strike-intraday → real per-minute evolution for the near-money
//     strikes; outer strikes are scaled by the real session volume curve so the
//     replay grows believably.

import { writeFileSync } from "node:fs";
import { prisma, disconnectPrisma } from "./lib/prisma.js";

const UW_BASE = "https://api.unusualwhales.com";
const H = {
  Authorization: `Bearer ${process.env.UW_API_TOKEN ?? ""}`,
  "UW-CLIENT-API-ID": "100001",
  Accept: "application/json",
};
const num = (v: unknown) => {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

interface Strike { k: number; cA: number; cB: number; pA: number; pB: number; cP: number; pP: number }
interface Minute { t: string; callVol: number; putVol: number; cpRatio: number; sentiment: string; strikes: Strike[] }

const zero = (k: number): Strike => ({ k, cA: 0, cB: 0, pA: 0, pB: 0, cP: 0, pP: 0 });

function pickCentered(items: Strike[], spot: number, n: number): Strike[] {
  const asc = [...items].sort((a, b) => a.k - b.k);
  const below = asc.filter((s) => s.k < spot);
  const above = asc.filter((s) => s.k >= spot);
  const wantBelow = Math.floor(n / 2);
  const wantAbove = n - wantBelow;
  const takeAbove = Math.min(wantAbove + Math.max(0, wantBelow - below.length), above.length);
  const takeBelow = Math.min(wantBelow + Math.max(0, wantAbove - takeAbove), below.length);
  return [...below.slice(below.length - takeBelow), ...above.slice(0, takeAbove)];
}

async function getRows(path: string): Promise<any[]> {
  const res = await fetch(`${UW_BASE}${path}`, { headers: H });
  const j: any = await res.json();
  return Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : [];
}

const etMinute = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

function agg(strikes: Strike[], t: string): Minute {
  let callVol = 0, putVol = 0, netC = 0, netP = 0, absP = 0;
  for (const s of strikes) { callVol += s.cA + s.cB; putVol += s.pA + s.pB; netC += s.cP; netP += s.pP; absP += Math.abs(s.cP) + Math.abs(s.pP); }
  const net = netC - netP;
  const sentiment = absP > 0 && Math.abs(net) < 0.1 * absP ? "Neutral" : net >= 0 ? "Bullish" : "Bearish";
  return { t, callVol, putVol, cpRatio: putVol > 0 ? callVol / putVol : 0, sentiment, strikes };
}

async function main() {
  const ticker = (process.argv[2] ?? "SPY").toUpperCase();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  const gex = await prisma.gexSnapshot.findFirst({ where: { ticker }, orderBy: { capturedAt: "desc" }, select: { spot: true } });
  let spot = gex?.spot ? Number(gex.spot) : 0;

  // 1) Full-chain cumulative "now" state → 20 strikes centered on spot.
  const fullRows = await getRows(`/api/stock/${ticker}/flow-per-strike?date=${date}`);
  const fullChain: Strike[] = fullRows.map((r) => ({
    k: num(r.strike),
    cA: num(r.call_volume_ask_side), cB: num(r.call_volume_bid_side),
    pA: num(r.put_volume_ask_side), pB: num(r.put_volume_bid_side),
    cP: num(r.call_premium_ask_side) - num(r.call_premium_bid_side),
    pP: num(r.put_premium_ask_side) - num(r.put_premium_bid_side),
  })).filter((s) => s.k > 0);
  if (!spot) {
    let w = 0, v = 0;
    for (const s of fullChain) { const vol = s.cA + s.cB + s.pA + s.pB; w += s.k * vol; v += vol; }
    spot = v > 0 ? w / v : 0;
  }
  const centered = pickCentered(fullChain, spot, 20).sort((a, b) => b.k - a.k);
  const finalByK = new Map(centered.map((s) => [s.k, s]));

  // 2) Real per-minute evolution from intraday (near-money strikes) + session
  //    volume curve for scaling the outer strikes.
  const intra = await getRows(`/api/stock/${ticker}/flow-per-strike-intraday?date=${date}&filter=Volume`);
  intra.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  const cum = new Map<number, Strike>();
  const frames: { t: string; cum: Map<number, Strike>; total: number }[] = [];
  let curMin = "";
  const pushFrame = (t: string) => {
    let total = 0;
    const snap = new Map<number, Strike>();
    for (const [k, s] of cum) { snap.set(k, { ...s }); total += s.cA + s.cB + s.pA + s.pB; }
    frames.push({ t, cum: snap, total });
  };
  for (const r of intra) {
    const m = etMinute(String(r.timestamp));
    if (curMin && m !== curMin) pushFrame(curMin);
    curMin = m;
    const k = num(r.strike);
    const s = cum.get(k) ?? zero(k);
    s.cA += num(r.call_volume_ask_side); s.cB += num(r.call_volume_bid_side);
    s.pA += num(r.put_volume_ask_side); s.pB += num(r.put_volume_bid_side);
    s.cP += num(r.call_premium_ask_side) - num(r.call_premium_bid_side);
    s.pP += num(r.put_premium_ask_side) - num(r.put_premium_bid_side);
    cum.set(k, s);
  }
  if (curMin) pushFrame(curMin);
  const finalTotal = frames.length ? frames[frames.length - 1]!.total : 0;

  // 3) Compose 20-strike minutes: real evolution where intraday has the strike,
  //    else final value scaled by the session volume progression.
  const minutes: Minute[] = frames.map((f) => {
    const factor = finalTotal > 0 ? f.total / finalTotal : 1;
    const strikes = centered.map((fin) => {
      const real = f.cum.get(fin.k);
      if (real) return { ...real };
      return { k: fin.k, cA: fin.cA * factor, cB: fin.cB * factor, pA: fin.pA * factor, pB: fin.pB * factor, cP: fin.cP * factor, pP: fin.pP * factor };
    });
    return agg(strikes, f.t);
  });
  // Ensure the final frame is the exact real full-chain state.
  if (minutes.length) minutes[minutes.length - 1] = agg(centered.map((s) => ({ ...s })), frames[frames.length - 1]!.t);

  const payload = { ticker, date, spot, minutes };
  const html = render(payload);
  const out = new URL("../sentiment-mockup.html", import.meta.url);
  writeFileSync(out, html);
  console.log(`wrote ${out.pathname}`);
  console.log(`${ticker} ${date} · ${minutes.length} minutes · ${centered.length} strikes centered on $${spot.toFixed(2)} · range $${centered.at(-1)?.k}–$${centered[0]?.k}`);
  await disconnectPrisma();
}

function render(p: { ticker: string; date: string; spot: number; minutes: Minute[] }): string {
  const DATA = JSON.stringify(p);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Options Sentiment — ${p.ticker} (mockup)</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js"></script>
<style>
  :root{--bg:#0b1220;--bg2:#111a2e;--bg3:#0e1626;--card:#0f1830;--border:#1e2c47;--text:#e8eef9;--text2:#9fb0c9;--text3:#6b7c98;--gold:#c9a55a;--buy:#3fb950;--sell:#e5534b}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font:14px/1.4 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .wrap{max-width:1100px;margin:0 auto;padding:22px}
  .banner{background:rgba(201,165,90,.12);border:1px solid rgba(201,165,90,.4);color:var(--gold);font-size:12px;padding:8px 12px;border-radius:8px;margin-bottom:16px}
  h1{font-size:18px;font-weight:600;margin:0}
  .sub{color:var(--text2);font-size:12px;margin-top:3px}
  .row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
  select{background:var(--bg3);color:var(--text2);border:.5px solid var(--border);border-radius:6px;padding:5px 9px;font-size:12px}
  .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}
  .card{background:var(--bg2);border:.5px solid var(--border);border-radius:10px;padding:12px 14px}
  .card .l{font-size:11px;color:var(--text2)}
  .card .v{font-size:20px;font-weight:700;margin-top:4px}
  .panel{background:var(--card);border:.5px solid var(--border);border-radius:12px;padding:16px}
  .slider-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
  .slider-head .t{font-size:22px;font-weight:700}
  input[type=range]{width:100%;accent-color:var(--gold);cursor:pointer}
  .ends{display:flex;justify-content:space-between;color:var(--text3);font-size:11px;margin-top:3px}
  .main{display:grid;grid-template-columns:1fr 210px;gap:14px;margin-top:14px}
  .legend{display:flex;gap:12px;font-size:11px;color:var(--text2);align-items:center}
  .sw{width:10px;height:10px;border-radius:2px;display:inline-block;margin-right:5px;vertical-align:-1px}
  .sumbox{background:var(--bg3);border:.5px solid var(--border);border-radius:12px;padding:14px;margin-bottom:10px}
  .sumbox .h{font-size:10px;color:var(--text3)}
  .sumbox .title{font-size:14px;font-weight:700;margin:2px 0 8px}
  .sumrow{display:flex;justify-content:space-between;font-size:13px;padding:3px 0}
  .hr{height:1px;background:var(--border);margin:7px 0}
  .chartbox{position:relative;height:560px}
</style></head>
<body><div class="wrap">
  <div class="banner">Static mockup · real UW data for ${p.ticker} on ${p.date} · 20 strikes centered on spot. Near-money strikes evolve from real intraday flow; outer strikes scaled by the session volume curve.</div>
  <div class="row">
    <div><h1>Options sentiment — per-strike buy vs sell</h1>
      <div class="sub">Bought at ask <span style="color:var(--buy)">(green)</span> vs sold at bid <span style="color:var(--sell)">(red)</span> · cumulative through the session</div></div>
    <select disabled><option>${p.ticker}</option></select>
  </div>
  <div class="cards">
    <div class="card"><div class="l">CALL VOL</div><div class="v" id="cv" style="color:#5aa9e6"></div></div>
    <div class="card"><div class="l">PUT VOL</div><div class="v" id="pv" style="color:#b98ae6"></div></div>
    <div class="card"><div class="l">C/P RATIO</div><div class="v" id="cp" style="color:#e2bf73"></div></div>
    <div class="card"><div class="l">SENTIMENT</div><div class="v" id="se"></div></div>
  </div>
  <div class="panel">
    <div class="slider-head"><div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.04em">Replay — drag to scrub the session</div><div class="t" id="time"></div></div>
    <input type="range" id="slider" min="0" value="0"/>
    <div class="ends"><span id="t0"></span><span id="tcount"></span><span id="t1"></span></div>
  </div>
  <div class="main">
    <div class="panel">
      <div class="row" style="margin-bottom:8px"><div style="font-weight:600">${p.ticker} — CALLS ← &nbsp; → PUTS</div>
        <div class="legend"><span><span class="sw" style="background:var(--buy)"></span>Buy</span><span><span class="sw" style="background:var(--sell)"></span>Sell</span></div></div>
      <div class="chartbox"><canvas id="chart"></canvas></div>
    </div>
    <div>
      <div class="sumbox"><div class="h">All <span class="cnt"></span> strikes</div><div class="title">CALLS</div>
        <div class="sumrow"><span style="color:var(--text2)">Buy</span><span id="cbuy" style="color:var(--buy);font-weight:600"></span></div>
        <div class="sumrow"><span style="color:var(--text2)">Sell</span><span id="csell" style="color:var(--sell);font-weight:600"></span></div>
        <div class="hr"></div><div class="sumrow"><span style="color:var(--text2)">Ratio</span><span id="cratio" style="font-weight:800"></span></div></div>
      <div class="sumbox"><div class="h">All <span class="cnt"></span> strikes</div><div class="title">PUTS</div>
        <div class="sumrow"><span style="color:var(--text2)">Buy</span><span id="pbuy" style="color:var(--buy);font-weight:600"></span></div>
        <div class="sumrow"><span style="color:var(--text2)">Sell</span><span id="psell" style="color:var(--sell);font-weight:600"></span></div>
        <div class="hr"></div><div class="sumrow"><span style="color:var(--text2)">Ratio</span><span id="pratio" style="font-weight:800"></span></div></div>
    </div>
  </div>
</div>
<script>
const D=${DATA};const BUY="#3fb950",SELL="#e5534b";
const fmt=n=>Math.round(n).toLocaleString();
const to12=t=>{let[h,m]=t.split(":");h=+h;const a=h>=12?"PM":"AM";h=h%12||12;return h+":"+m+" "+a};
const M=D.minutes;
const sl=document.getElementById("slider");sl.max=Math.max(0,M.length-1);sl.value=M.length-1;
document.getElementById("t0").textContent=M.length?to12(M[0].t):"";
document.getElementById("t1").textContent=M.length?to12(M[M.length-1].t):"";
document.getElementById("tcount").textContent=M.length+" snapshots";
document.querySelectorAll(".cnt").forEach(e=>e.textContent=(M.at(-1)?.strikes.length||0));
const ctx=document.getElementById("chart");
const SENT={Bullish:"#3fb950",Bearish:"#e5534b",Neutral:"#c9a55a"};
// Centered strike pills at x=0.
const centerLabels={id:"centerLabels",afterDatasetsDraw(c){const L=c.data.labels;if(!L)return;const x=c.scales.x.getPixelForValue(0),g=c.ctx;g.save();g.font="600 12px ui-sans-serif,system-ui,sans-serif";g.textAlign="center";g.textBaseline="middle";const h=18;L.forEach((lab,i)=>{const y=c.scales.y.getPixelForValue(i),t=String(lab),w=g.measureText(t).width+16;g.beginPath();if(g.roundRect)g.roundRect(x-w/2,y-h/2,w,h,5);else g.rect(x-w/2,y-h/2,w,h);g.fillStyle="#0d1626";g.fill();g.lineWidth=.5;g.strokeStyle="rgba(255,255,255,.10)";g.stroke();g.fillStyle="#e8eef9";g.fillText(t,x,y+.5)});g.restore();}};
let chart;
function draw(i){
  const m=M[i];if(!m)return;
  const ss=m.strikes;
  const labels=ss.map(s=>s.k.toLocaleString());
  const maxSide=ss.reduce((a,s)=>Math.max(a,s.cA+s.cB,s.pA+s.pB),1);
  const gut=maxSide*0.16,maxAbs=(maxSide+gut)*1.03;
  const bp={stack:"s",borderWidth:0,categoryPercentage:0.82,barPercentage:0.96};
  const ds=[
    {label:"_callGap",data:ss.map(()=>-gut),backgroundColor:"transparent",...bp},
    {label:"Call buy",data:ss.map(s=>-s.cA),backgroundColor:BUY,...bp},
    {label:"Call sell",data:ss.map(s=>-s.cB),backgroundColor:SELL,...bp},
    {label:"_putGap",data:ss.map(()=>gut),backgroundColor:"transparent",...bp},
    {label:"Put buy",data:ss.map(s=>s.pA),backgroundColor:BUY,...bp},
    {label:"Put sell",data:ss.map(s=>s.pB),backgroundColor:SELL,...bp},
  ];
  if(!chart){
    chart=new Chart(ctx,{type:"bar",data:{labels,datasets:ds},plugins:[centerLabels],options:{
      indexAxis:"y",responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:false},tooltip:{filter:i=>!String(i.dataset.label).startsWith("_"),callbacks:{label:c=>c.dataset.label+": "+Math.abs(Math.round(c.raw)).toLocaleString()}}},
      scales:{x:{stacked:true,min:-maxAbs,max:maxAbs,grid:{color:"rgba(255,255,255,.06)"},ticks:{color:"#6b7c98",font:{size:9},callback:v=>Math.abs(+v).toLocaleString()}},
              y:{stacked:true,grid:{color:"rgba(255,255,255,.04)"},ticks:{display:false}}}}});
  }else{chart.data.labels=labels;chart.data.datasets.forEach((d,j)=>d.data=ds[j].data);chart.options.scales.x.min=-maxAbs;chart.options.scales.x.max=maxAbs;chart.update();}
  document.getElementById("cv").textContent=fmt(m.callVol);
  document.getElementById("pv").textContent=fmt(m.putVol);
  document.getElementById("cp").textContent=m.cpRatio.toFixed(2);
  const se=document.getElementById("se");se.textContent=m.sentiment;se.style.color=SENT[m.sentiment]||"#fff";
  document.getElementById("time").textContent=to12(m.t)+" ET";
  let cb=0,cs=0,pb=0,ps=0;ss.forEach(s=>{cb+=s.cA;cs+=s.cB;pb+=s.pA;ps+=s.pB});
  document.getElementById("cbuy").textContent=fmt(cb);document.getElementById("csell").textContent=fmt(cs);
  document.getElementById("pbuy").textContent=fmt(pb);document.getElementById("psell").textContent=fmt(ps);
  const cr=cs>0?cb/cs:0,pr=ps>0?pb/ps:0;
  const cre=document.getElementById("cratio");cre.textContent=cr.toFixed(2);cre.style.color=cr>=1?BUY:SELL;
  const pre=document.getElementById("pratio");pre.textContent=pr.toFixed(2);pre.style.color=pr>=1?BUY:SELL;
}
sl.addEventListener("input",e=>draw(+e.target.value));
draw(M.length-1);
</script>
</body></html>`;
}

main().catch((e) => { console.error(e); process.exit(1); });
