// Generates a standalone HTML mockup of the Daily Watches confluence UI using
// today's real hit_list_daily rows, in the platform's visual template.
//   <env> npx tsx src/script-mockup-watches.ts

import { writeFileSync } from "node:fs";
import { prisma, disconnectPrisma } from "./lib/prisma.js";

async function main() {
  const latest = await prisma.hitListDaily.findFirst({ orderBy: { date: "desc" }, select: { date: true } });
  if (!latest) throw new Error("no hit list rows");
  const rows = await prisma.hitListDaily.findMany({ where: { date: latest.date }, orderBy: { rank: "asc" } });
  const tickers = rows.map((r) => r.ticker);
  const dateKey = latest.date.toISOString().slice(0, 10);
  const [summaries, openAlerts] = await Promise.all([
    prisma.aiSummary.findMany({ where: { kind: { in: tickers.map((t) => `watch-${t}-${dateKey}`) } }, select: { kind: true, body: true } }),
    prisma.tradeAlert.findMany({
      where: { ticker: { in: tickers }, status: "OPEN", hidden: false },
      orderBy: { entryAt: "desc" },
      select: { ticker: true, side: true, strike: true, expiryLabel: true, livePct: true, moderator: true },
    }),
  ]);
  const sumByTicker = new Map(summaries.map((x) => [x.kind.split("-")[1]!, x.body]));
  const alertsByTicker = new Map<string, any[]>();
  for (const a of openAlerts) {
    const label = a.strike != null ? `$${Number(a.strike)}${a.side === "PUT" ? "P" : "C"}${a.expiryLabel ? " " + a.expiryLabel : ""}` : a.ticker;
    const list = alertsByTicker.get(a.ticker) ?? [];
    list.push({ contract: label, side: a.side, livePct: a.livePct != null ? Number(a.livePct) : null, mod: a.moderator });
    alertsByTicker.set(a.ticker, list);
  }

  const hits = rows.map((r) => ({
    rank: r.rank,
    ticker: r.ticker,
    price: Number(r.price),
    direction: r.direction,
    confidence: r.confidence,
    premium: Number(r.premium),
    contract: r.contract,
    thesis: r.thesis,
    sector: r.sector,
    contracts: r.contracts,
    signals: r.signals,
    atr: r.atrTargets,
    score: Number(r.actionabilityScore),
    aiSummary: sumByTicker.get(r.ticker) ?? null,
    openAlerts: alertsByTicker.get(r.ticker) ?? [],
  }));

  const dateLabel = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(latest.date);
  const payload = { dateLabel, hits };
  const out = new URL("../watches-mockup.html", import.meta.url);
  writeFileSync(out, render(payload));
  console.log(`wrote ${decodeURIComponent(out.pathname)}`);
  console.log(`${hits.length} rows for ${latest.date.toISOString().slice(0, 10)}`);
  await disconnectPrisma();
}

function render(p: unknown): string {
  const D = JSON.stringify(p);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Daily Watches — confluence mockup</title>
<style>
 :root{--bg:#0b1220;--bg2:#111a2e;--bg3:#0e1626;--card:#0f1830;--border:#1e2c47;--text:#e8eef9;--text2:#9fb0c9;--text3:#6b7c98;--gold:#c9a55a;--buy:#7fbf52;--sell:#e76a6a;--blue:#5aa9e6;--purpleBg:#eeedfe;--purple:#3c3489;--info:#12203a}
 *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font:13px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
 .top{display:flex;align-items:center;justify-content:space-between;padding:10px 18px;border-bottom:.5px solid var(--border);background:var(--bg3)}
 .crumb{color:var(--text2);font-size:13px}.crumb b{color:var(--text)}
 .badge{font-size:11px;color:var(--text3);border:.5px solid var(--border);border-radius:5px;padding:2px 8px}
 .wrap{display:flex;height:calc(100vh - 45px);overflow:hidden}
 .left{width:56%;display:flex;flex-direction:column;border-right:.5px solid var(--border);min-width:0}
 .shead{padding:9px 14px;border-bottom:.5px solid var(--border);background:var(--bg3)}
 .shead .d{font-size:14px;font-weight:500}
 .pill{display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:500;border-radius:20px;padding:2px 8px;background:rgba(127,191,82,.14);color:var(--buy);margin-left:8px}
 .sub{font-size:11px;color:var(--text2);margin-top:4px}
 .sortbar{display:flex;justify-content:space-between;align-items:center;padding:7px 14px;border-bottom:.5px solid var(--border);background:var(--bg3);font-size:12px}
 table{width:100%;border-collapse:collapse}
 th{position:sticky;top:0;background:var(--bg3);padding:6px 10px;text-align:left;font-size:9px;font-weight:500;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;border-bottom:.5px solid var(--border);white-space:nowrap}
 td{padding:7px 10px;border-bottom:.5px solid var(--border);white-space:nowrap;vertical-align:middle}
 tr.row{cursor:pointer} tr.row:hover{background:rgba(255,255,255,.02)} tr.row.sel{background:var(--info)}
 .tk{color:var(--gold);font-weight:600;font-size:13px}
 .b{display:inline-flex;align-items:center;font-size:9px;font-weight:600;padding:2px 5px;border-radius:3px;margin-right:3px;cursor:help}
 .bF{background:rgba(90,169,230,.14);color:var(--blue);border:.5px solid rgba(90,169,230,.4)}
 .bSu{background:rgba(127,191,82,.14);color:var(--buy);border:.5px solid rgba(127,191,82,.4)}
 .bSd{background:rgba(231,106,106,.14);color:var(--sell);border:.5px solid rgba(231,106,106,.4)}
 .bDP{background:var(--purpleBg);color:var(--purple);border:.5px solid #afa9ec}
 .bP{background:rgba(201,165,90,.16);color:var(--gold);border:.5px solid rgba(201,165,90,.45)}
 .conf{font-size:9px;font-weight:500;padding:2px 6px;border-radius:3px}
 .cH{background:rgba(127,191,82,.14);color:var(--buy)} .cM{background:rgba(226,191,115,.16);color:#e2bf73} .cL{background:rgba(231,106,106,.14);color:var(--sell)}
 .tbl-scroll{flex:1;overflow-y:auto}
 .right{flex:1;display:flex;flex-direction:column;background:var(--bg3);min-width:0;overflow-y:auto}
 .rhead{padding:12px 16px;border-bottom:.5px solid var(--border)}
 .rname{font-size:22px;font-weight:500}.rsec{font-size:12px;color:var(--text2)}
 .dirpill{display:inline-flex;gap:5px;font-weight:500;border-radius:7px;margin:9px 0 10px;font-size:12px;padding:5px 14px}
 .mgrid{display:grid;grid-template-columns:repeat(3,1fr);border:.5px solid var(--border);border-radius:8px;overflow:hidden}
 .mc{padding:8px 10px;text-align:center;border-right:.5px solid var(--border)} .mc:last-child{border-right:none}
 .mc .l{font-size:9px;font-weight:500;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px}
 .mc .v{font-size:15px;font-weight:500}
 .sec{padding:12px 16px}
 .slabel{font-size:9px;font-weight:500;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px}
 .panel{background:var(--bg2);border-radius:8px;padding:9px 11px;margin-bottom:12px}
 .srow{display:flex;align-items:center;gap:8px;margin-bottom:5px}
 .srow .n{flex:1;font-size:11px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .bar{width:70px;height:4px;border-radius:2px;background:var(--bg);overflow:hidden;flex-shrink:0}
 .bar>div{height:100%;background:var(--gold)}
 .pts{font-size:10px;font-weight:500;width:44px;text-align:right;flex-shrink:0}
 .agree{font-size:10px;margin-top:5px}
 .atr{display:grid;grid-template-columns:repeat(3,1fr);border:.5px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:4px}
 .acell{padding:7px 8px;text-align:center;border-right:.5px solid var(--border)}
 .acell:nth-child(3n){border-right:none} .acell:nth-child(-n+3){border-bottom:.5px solid var(--border)}
 .acell .al{font-size:9px;font-weight:600;letter-spacing:.03em;margin-bottom:2px}
 .acell .av{font-size:13px;font-weight:500}
 .note{font-size:9px;color:var(--text3);margin-top:4px}
 ct{font-size:11px}
 .ctable th{position:static;background:transparent}
 .thesis{font-size:12px;color:var(--text2);line-height:1.6}
</style></head><body>
<div class="top"><div class="crumb">Daily watches <span style="color:var(--text3)">›</span> <b>Hit list</b></div><div class="badge">mockup · real data</div></div>
<div class="wrap">
 <div class="left">
  <div class="shead"><span class="d" id="hdate"></span><span class="pill">● Confluence top 10</span>
   <div class="sub">Scored across flow · sentiment · dark pool · persistence — computed 7:30 AM ET from the prior session</div></div>
  <div class="sortbar"><span><b>Hit list</b> <span style="color:var(--text2);font-weight:400" id="nrows"></span></span><span style="color:var(--text3);font-size:10px">Sort: Confluence score</span></div>
  <div class="tbl-scroll"><table>
   <thead><tr><th style="width:22px">#</th><th style="width:74px">Ticker</th><th style="width:42px">Score</th><th style="width:46px">Conf.</th><th style="width:64px">Premium</th><th style="width:110px">Contract</th><th style="width:112px;text-align:center">Signals</th><th>Thesis</th></tr></thead>
   <tbody id="tbody"></tbody>
  </table></div>
 </div>
 <div class="right" id="detail"></div>
</div>
<script>
const D=${D};
const G="#7fbf52",R="#e76a6a";
const fmtP=v=>{const a=Math.abs(v);if(a>=1e6)return "$"+(a/1e6).toFixed(1)+"M";if(a>=1e3)return "$"+Math.round(a/1e3)+"K";return "$"+a};
const confCls=c=>c==="HIGH"?"cH":(c==="MED"||c==="MOD")?"cM":"cL";
function badges(s){if(!s)return "—";let h='<span class="b bF" title="Flow: '+fmtP(s.flow.premium)+' across '+s.flow.alerts+' alerts">F</span>';
 if(s.sentiment)h+='<span class="b '+(s.sentiment.side==="UP"?"bSu":"bSd")+'" title="Sentiment: C/P '+s.sentiment.cpRatio.toFixed(2)+(s.agree?" — confirms flow":"")+'">S</span>';
 if(s.darkpool)h+='<span class="b bDP" title="Dark pool rank #'+s.darkpool.rank+'">DP</span>';
 if(s.persistence)h+='<span class="b bP" title="Signaled '+s.persistence.days+' of last '+s.persistence.of+' sessions">×'+s.persistence.days+'</span>';
 return h;}
let sel=0;let panelOpen=true;
function renderTable(){
 document.getElementById("hdate").textContent=D.dateLabel;
 document.getElementById("nrows").textContent=D.hits.length+" names";
 document.getElementById("tbody").innerHTML=D.hits.map((h,i)=>
  '<tr class="row'+(i===sel?" sel":"")+'" onclick="pick('+i+')" style="'+(h.openAlerts.length&&i!==sel?'background:rgba(201,165,90,.07);':'')+(h.openAlerts.length?'box-shadow:inset 2.5px 0 0 var(--gold);':'')+'">'
  +'<td style="font-size:11px;color:var(--text3)">'+h.rank+'</td>'
  +'<td><span class="tk">'+h.ticker+'</span> <span style="font-size:9px;color:'+(h.direction==="UP"?G:R)+'">'+(h.direction==="UP"?"▲":"▼")+'</span>'+(h.openAlerts.length?' <span title="Live trade alert: '+h.openAlerts.map(a=>a.contract).join(", ")+'" style="font-size:9px">🔔'+(h.openAlerts.length>1?h.openAlerts.length:"")+'</span>':'')+'</td>'
  +'<td style="font-size:12px;font-weight:600;color:var(--gold)">'+h.score.toFixed(1)+'</td>'
  +'<td><span class="conf '+confCls(h.confidence)+'">'+h.confidence+'</span></td>'
  +'<td style="font-size:12px;font-weight:500;color:'+(h.direction==="UP"?G:R)+'">'+fmtP(h.premium)+'</td>'
  +'<td style="font-size:11px">'+h.contract+'</td>'
  +'<td style="text-align:center">'+badges(h.signals)+'</td>'
  +'<td style="font-size:11px;color:var(--text2);white-space:normal">'+h.thesis+'</td></tr>').join("");
}
function srow(label){return '<div class="srow"><span style="font-size:10px;color:'+G+';flex-shrink:0">✓</span><span class="n">'+label+'</span></div>';}
function acell(label,val,up,primary){return '<div class="acell" style="'+(primary?('background:'+(up?'rgba(127,191,82,.07)':'rgba(231,106,106,.07)')):'')+'"><div class="al" style="color:'+(up?G:R)+'">'+label+'</div><div class="av">$'+val.toFixed(2)+'</div></div>';}
function pick(i){sel=i;renderTable();renderDetail();}
function goAlerts(){alert("In the live app this opens the Trade alerts dashboard");}
function setPanel(open){panelOpen=open;renderDetail();}
function renderDetail(){
 const h=D.hits[sel];const s=h.signals;const a=h.atr;const up=h.direction==="UP";
 const el=document.getElementById("detail");
 if(!panelOpen){
  el.style.flex="0 0 26px";
  el.innerHTML='<button onclick="setPanel(true)" title="Expand" style="all:unset;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;padding:10px 0;width:26px;height:100%"><span style="font-size:11px;color:var(--text2)">«</span><span style="font-size:10px;font-weight:600;color:var(--gold);writing-mode:vertical-rl">'+h.ticker+'</span></button>';
  return;
 }
 el.style.flex="1";
 let html='<div style="display:flex;justify-content:flex-end;padding:6px 12px;border-bottom:.5px solid var(--border)"><button onclick="setPanel(false)" style="all:unset;cursor:pointer;font-size:11px;color:var(--text2)">Minimize »</button></div>';
 html+='<div class="rhead"><div style="display:flex;justify-content:space-between;align-items:flex-start">'
  +'<div><div class="rname">'+h.ticker+'</div><div class="rsec">'+h.sector+' · #'+h.rank+'</div></div>'
  +'<span style="font-size:20px;font-weight:500">$'+h.price.toFixed(2)+'</span></div>'
  +'<div class="dirpill" style="background:'+(up?"rgba(127,191,82,.14)":"rgba(231,106,106,.14)")+';color:'+(up?G:R)+';border:.5px solid '+(up?G:R)+'">'+(up?"▲ Bullish":"▼ Bearish")+'</div>'
  +'<div class="mgrid"><div class="mc"><div class="l">Total premium</div><div class="v">'+fmtP(h.premium)+'</div></div>'
  +'<div class="mc"><div class="l">Score</div><div class="v" style="color:var(--gold)">'+(s?s.total:"—")+'</div></div>'
  +'<div class="mc"><div class="l">Confidence</div><div class="v">'+h.confidence+'</div></div></div></div>';
 html+='<div class="sec">';
 if(h.openAlerts.length){html+='<div class="panel" style="background:rgba(201,165,90,.10);border-left:3px solid var(--gold);border-radius:0 8px 8px 0"><div class="slabel" style="color:var(--gold);margin-bottom:6px">🔔 Live trade alert'+(h.openAlerts.length>1?"s":"")+' on '+h.ticker+'</div><div style="display:flex;gap:5px;flex-wrap:wrap">'
  +h.openAlerts.map(a=>'<button onclick="goAlerts()" title="Open in Trade alerts — alerted by '+a.mod+'" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:5px;padding:3px 9px;font-size:11px;font-weight:600;border-radius:6px;background:var(--bg);border:.5px solid var(--gold);color:'+(a.side==="PUT"?R:G)+'">'+a.contract+(a.livePct!=null?' <span style="font-weight:500;color:'+(a.livePct>=0?G:R)+'">'+(a.livePct>=0?"+":"")+a.livePct.toFixed(1)+'%</span>':'')+' <span style="font-size:9px;font-weight:400;color:var(--text3)">'+a.mod+' ↗</span></button>').join("")
  +'</div></div>';}
 html+='<div class="panel"><div class="slabel" style="margin-bottom:4px">Why this stands out</div><div class="thesis">'+h.thesis+'</div></div>';
 if(h.aiSummary){html+='<div class="panel"><div class="slabel" style="color:var(--gold);margin-bottom:4px">✦ AI briefing</div><div class="thesis" style="white-space:pre-wrap">'+h.aiSummary+'</div></div>';}
 if(s){html+='<div class="slabel">Confluence score · '+s.total+'</div><div class="panel">'
  +srow("Flow — "+fmtP(s.flow.premium)+" / "+s.flow.alerts+" alerts")
  +(s.sentiment?srow("Sentiment — C/P "+s.sentiment.cpRatio.toFixed(2)+" "+(s.sentiment.side==="UP"?"bullish":"bearish")):"")
  +(s.darkpool?srow("Dark pool — rank #"+s.darkpool.rank):"")
  +(s.persistence?srow("Persistence — "+s.persistence.days+" of "+s.persistence.of+" sessions"):"")
  +(s.agree!=null?'<div class="agree" style="color:'+(s.agree?G:"var(--text3)")+'">'+(s.agree?"✓ Flow and sentiment agree on direction":"Flow and sentiment point different ways")+'</div>':"")
  +'</div>';}
 if(a){html+='<div class="slabel">Move targets · weekly ATR $'+a.atrW.toFixed(2)+'</div><div class="atr">'
  +acell("+0.5 ATR",a.up05,true,up)+acell("+1 ATR",a.up1,true,up)+acell("+2 ATR",a.up2,true,up)
  +acell("−0.5 ATR",a.dn05,false,!up)+acell("−1 ATR",a.dn1,false,!up)+acell("−2 ATR",a.dn2,false,!up)
  +'</div><div class="note">From last close $'+h.price.toFixed(2)+' · ATR computed on completed weekly bars</div>';}
 const cs=h.contracts||[];
 if(cs.length){html+='<div class="slabel" style="margin-top:12px">Contracts</div><table class="ctable" style="font-size:11px"><thead><tr><th>Strike</th><th>Expiry</th><th>Premium</th><th>Rule</th><th style="text-align:right">V/OI</th></tr></thead><tbody>'
  +cs.map(c=>'<tr><td style="font-weight:500;font-size:12px">'+c.strikeLabel+'</td><td style="color:var(--text2)">'+c.expiryLabel+'</td><td style="color:'+G+';font-weight:500">'+c.premiumLabel+'</td><td style="font-size:10px;color:var(--text2)">'+c.rule+'</td><td style="text-align:right;color:'+G+';font-weight:500">'+c.vOiLabel+'</td></tr>').join("")
  +'</tbody></table>';}
 html+='</div>';
 document.getElementById("detail").innerHTML=html;
}
renderTable();renderDetail();
</script></body></html>`;
}

main().catch((e) => { console.error(e); process.exit(1); });
