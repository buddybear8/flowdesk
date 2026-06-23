// Generates a standalone HTML mockup of the Trade Alerts module using the real
// trade_alerts data, in the platform's visual template. Writes the file and
// prints its path.
//   <env> npx tsx src/script-mockup-trade-alerts.ts

import { writeFileSync } from "node:fs";
import { prisma, disconnectPrisma } from "./lib/prisma.js";

const W: Record<string, number> = { Large: 0.1, Medium: 0.05, Small: 0.01, Lotto: 0.005 };

async function main() {
  const rows = await prisma.tradeAlert.findMany({ where: { assetType: "option", hidden: false }, orderBy: [{ status: "asc" }, { entryAt: "desc" }] });
  const map = (r: typeof rows[number]) => {
    const rem = Number(r.remainingFrac);
    const evs = (r.events as any[]) || [];
    const lastClose = [...evs].reverse().find((e) => e.action === "close");
    return {
      contract: `${r.ticker} ${Number(r.strike)}${r.side === "PUT" ? "P" : "C"}`,
      exp: r.expiryLabel, dte: r.expiry ? Math.round((r.expiry.getTime() - Date.now()) / 86400000) : null,
      size: r.sizeLabel, rem: Math.round(rem * 100),
      entry: Number(r.entryPrice), mark: r.lastMark != null ? Number(r.lastMark) : null,
      live: r.livePct != null ? Number(r.livePct) : null,
      book: Number(r.bookDelta), realized: rem < 1 ? Number(r.realizedPct) : null,
      mod: r.moderator, status: r.status, expired: lastClose?.expired === true,
      entryAt: r.entryAt.toISOString().slice(0, 10),
    };
  };
  const open = rows.filter((r) => r.status === "OPEN").map(map);
  const closed = rows.filter((r) => r.status === "CLOSED").map(map);
  const openBook = open.reduce((s, r) => s + r.book, 0);
  const live = open.map((r) => r.live).filter((v): v is number => v != null);
  const raw = live.length ? live.reduce((a, b) => a + b, 0) / live.length : 0;
  const cret = closed.map((r) => r.realized ?? 0);
  const winAll = closed.length ? 100 * cret.filter((v) => v > 0).length / closed.length : 0;
  const alerted = closed.filter((r) => !r.expired), expiredC = closed.filter((r) => r.expired);
  const winAlerted = alerted.length ? 100 * alerted.filter((r) => (r.realized ?? 0) > 0).length / alerted.length : 0;
  const curve = [...closed].sort((a, b) => a.entryAt.localeCompare(b.entryAt)).reduce<{ t: string; cum: number }[]>((acc, r) => {
    const cum = (acc.length ? acc[acc.length - 1].cum : 0) + (W[r.size] ?? 0.01) * (r.realized ?? 0);
    acc.push({ t: r.entryAt, cum: Number(cum.toFixed(3)) });
    return acc;
  }, []);

  const payload = { open, closed, openBook, raw, winAll, winAlerted, alerted: alerted.length, expired: expiredC.length, openCount: open.length, closedCount: closed.length, curve };
  const out = new URL("../trade-alerts-mockup.html", import.meta.url);
  writeFileSync(out, render(payload));
  console.log(`wrote ${out.pathname}`);
  console.log(`${open.length} open · ${closed.length} closed · win(all) ${winAll.toFixed(0)}% · win(alerted) ${winAlerted.toFixed(0)}%`);
  await disconnectPrisma();
}

function render(p: any): string {
  const D = JSON.stringify(p);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Trade Alerts — mockup</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js"></script>
<style>
 :root{--bg:#0b1220;--bg2:#111a2e;--bg3:#0e1626;--card:#0f1830;--border:#1e2c47;--text:#e8eef9;--text2:#9fb0c9;--text3:#6b7c98;--gold:#c9a55a;--buy:#3fb950;--sell:#e5534b}
 *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font:13px/1.4 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
 .top{display:flex;align-items:center;justify-content:space-between;padding:10px 18px;border-bottom:.5px solid var(--border);background:var(--bg3)}
 .top .crumb{color:var(--text2);font-size:13px} .top .crumb b{color:var(--text)}
 .badge{font-size:11px;color:var(--text3);border:.5px solid var(--border);border-radius:5px;padding:2px 8px}
 .tabs{display:flex;gap:2px;padding:8px 18px 0;border-bottom:.5px solid var(--border);background:var(--bg3)}
 .tab{font-size:12px;padding:7px 14px;border-radius:6px 6px 0 0;cursor:pointer;color:var(--text2)}
 .tab.active{background:var(--bg);color:var(--text);border:.5px solid var(--border);border-bottom-color:var(--bg)}
 .tab.disabled{color:var(--text3);opacity:.6}
 .wrap{padding:14px 18px}
 .hrow{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:12px}
 h1{font-size:17px;font-weight:500;margin:0} .sub{color:var(--text2);font-size:12px;margin-top:2px}
 .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
 .card{background:var(--bg2);border:.5px solid var(--border);border-radius:8px;padding:11px 14px}
 .card .l{font-size:11px;color:var(--text2)} .card .v{font-size:18px;font-weight:600;margin-top:3px}
 .panel{background:var(--card);border:.5px solid var(--border);border-radius:12px;padding:16px;margin-bottom:12px}
 .ptitle{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:13px;font-weight:600}
 .pill{font-size:11px;padding:1px 7px;border-radius:20px;background:var(--bg2);color:var(--text2)}
 .live{font-size:10px;color:var(--buy)}
 table{width:100%;border-collapse:collapse;font-size:12px} th{font-size:10px;font-weight:500;letter-spacing:.04em;color:var(--text3);padding:6px 10px;border-bottom:.5px solid var(--border);white-space:nowrap;text-align:right} th:first-child,th:last-child{text-align:left}
 td{padding:7px 10px;white-space:nowrap;text-align:right;border-bottom:.5px solid var(--border)} td:first-child,td:last-child{text-align:left}
 .szp{display:inline-block;min-width:20px;text-align:center;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;background:var(--bg2);color:var(--text2);border:.5px solid var(--border)}
 .rem{display:inline-flex;align-items:center;gap:6px;justify-content:flex-end} .rembar{width:44px;height:5px;border-radius:3px;background:var(--bg2);overflow:hidden}
 .note{font-size:11px;color:var(--text3);margin-top:6px;line-height:1.5}
 .splitbox{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
 .split{background:var(--bg2);border:.5px solid var(--border);border-radius:8px;padding:11px 14px}
 .split .l{font-size:11px;color:var(--text2)} .split .v{font-size:16px;font-weight:600;margin-top:3px}
</style></head><body>
<div class="top"><div class="crumb">Options <span style="color:var(--text3)">›</span> <b>Trade Alerts</b></div><div class="badge">mockup · real data</div></div>
<div class="tabs"><div class="tab active">Options alerts</div><div class="tab disabled">Equities alerts · awaiting access</div></div>
<div class="wrap">
 <div class="hrow"><div><h1>Options alerts</h1><div class="sub">Live by expiration · realized from posted exits · P/L is option-premium % from entries/exits</div></div></div>
 <div class="cards" style="grid-template-columns:repeat(2,1fr)">
   <div class="card"><div class="l">OPEN NOW</div><div class="v" id="c_open"></div></div>
   <div class="card"><div class="l">CLOSED</div><div class="v" id="c_closed"></div></div>
 </div>
 <div class="panel"><div class="ptitle">Open Now <span class="pill" id="op_n"></span><span class="live">● live by expiration</span></div><div style="overflow-x:auto"><table id="t_open"></table></div></div>
 <div class="panel"><div class="ptitle">Equity curve · cumulative size-weighted book</div><div style="position:relative;height:170px"><canvas id="curve"></canvas></div></div>
 <div class="panel"><div class="ptitle">Track record · closed <span class="pill" id="cl_n"></span></div><div style="overflow-x:auto"><table id="t_closed"></table></div>
   <div class="note">Realized = banked % from posted exits; closed positions that expired are settled at their last real mark.</div></div>
</div>
<script>
const D=${D};const G="#3fb950",L="#e5534b";
const f=(v,d=1)=>v==null?"—":(v>=0?"+":"")+v.toFixed(d)+"%";
const col=v=>v==null?"var(--text3)":v>=0?G:L;
document.getElementById("c_open").textContent=D.openCount;
document.getElementById("c_closed").textContent=D.closedCount;
document.getElementById("op_n").textContent=D.openCount;document.getElementById("cl_n").textContent=D.closedCount;
function remBar(p){const c=p>=100?G:p>=50?"#e2bf73":L;return '<span class="rem"><span class="rembar"><span style="display:block;height:100%;width:'+p+'%;background:'+c+'"></span></span><span style="color:'+c+';min-width:30px;text-align:right">'+p+'%</span></span>';}
function row(r,live){const res=live?r.live:(r.realized??r.live);const sz=r.size==="Lotto"?"Lo":r.size[0];
 return '<tr><td><span style="color:'+G+';font-weight:600">'+r.contract+'</span></td>'
 +'<td>'+(r.exp?r.exp+(r.dte!=null?' · '+r.dte+'d':''):'—')+'</td>'
 +'<td><span class="szp">'+sz+'</span></td>'
 +'<td>'+remBar(r.rem)+'</td>'
 +'<td>'+r.entry.toFixed(2)+'</td>'
 +'<td>'+(r.mark!=null?r.mark.toFixed(2):'—')+'</td>'
 +'<td style="font-weight:600;color:'+col(res)+'">'+f(res)+'</td>'
 +'<td style="color:'+col(r.realized)+'">'+f(r.realized)+'</td>'
 +'<td><span style="color:var(--text2)">'+r.mod+'</span></td></tr>';}
function table(el,rows,live){const head=["CONTRACT","EXP","SIZE","REMAINING","ENTRY",live?"MID":"EXIT",live?"LIVE P/L":"RESULT","REALIZED","ALERTED BY"];
 el.innerHTML='<thead><tr>'+head.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>row(r,live)).join('')+'</tbody>';}
table(document.getElementById("t_open"),D.open,true);
table(document.getElementById("t_closed"),D.closed,false);
const up=(D.curve[D.curve.length-1]?.cum??0)>=0;
new Chart(document.getElementById("curve"),{type:"line",data:{labels:D.curve.map(p=>p.t),datasets:[{data:D.curve.map(p=>p.cum),borderColor:up?G:L,backgroundColor:up?"rgba(63,185,80,.12)":"rgba(229,83,75,.12)",fill:true,borderWidth:1.5,pointRadius:0,tension:.15}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{color:"#6b7c98",font:{size:9},maxTicksLimit:6}},y:{grid:{color:"rgba(255,255,255,.05)"},ticks:{color:"#6b7c98",font:{size:9},callback:v=>(+v).toFixed(1)+"%"}}}}});
</script></body></html>`;
}

main().catch((e) => { console.error(e); process.exit(1); });
