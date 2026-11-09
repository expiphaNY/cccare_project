// Self-contained interactive HTML report. One file, no network needed:
// uPlot is inlined, data is embedded as JSON. Recipients can open it offline,
// hover charts, layer sessions, and print to PDF.

import fs from "node:fs";
import path from "node:path";
import { summarize } from "../analytics";
import type { PatientBundle } from "../data";
import { clinicianById } from "../data";
import { ageFrom, fmtDate, fmtDateTime, fullName } from "../format";
import { resampleMean } from "../signal";
import type { Share, SignalData } from "../types";
import { EXERCISES } from "../types";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

let uplotCache: { js: string; css: string } | null = null;
function uplotAssets() {
  if (!uplotCache) {
    const dir = path.join(process.cwd(), "node_modules", "uplot", "dist");
    uplotCache = {
      js: fs.readFileSync(path.join(dir, "uPlot.iife.min.js"), "utf8"),
      css: fs.readFileSync(path.join(dir, "uPlot.min.css"), "utf8"),
    };
  }
  return uplotCache;
}

export async function buildHtml(
  b: PatientBundle,
  getSignal: (id: string) => Promise<SignalData | null>,
  ctx: { generatedBy: string; share?: Share | null },
) {
  const p = b.patient;
  const clin = clinicianById(p.clinicianId);
  const sums = p.exercises.map((e) => summarize(b.recordings, e)).filter(Boolean) as NonNullable<ReturnType<typeof summarize>>[];

  // Embed one envelope (50 Hz) per recording so the overlay works offline.
  const recs = [];
  for (const r of b.recordings) {
    const sig = await getSignal(r.id);
    const env = sig ? resampleMean(sig.envelope, sig.sampleRateHz, 50) : { y: [], dt: 0.02 };
    recs.push({
      id: r.id,
      s: r.sessionId,
      d: r.recordedAt,
      ex: r.exercise,
      set: r.setNumber,
      m: { peak: r.metrics.peakEnvelope, mean: r.metrics.meanEnvelope, rms: r.metrics.rms, mdf: r.metrics.medianFreqHz, fat: r.metrics.fatigueIndex, reps: r.metrics.repsDetected },
      dt: env.dt,
      env: env.y.map((v) => Math.round(v * 1000) / 1000),
    });
  }
  const data = {
    exercises: p.exercises.map((k) => ({ key: k, ...EXERCISES[k] })),
    sessions: b.sessions.map((s) => ({ id: s.id, d: s.startedAt, loc: s.location, pain: s.painScore ?? null, notes: s.notes ?? null })),
    recs,
  };
  const { js, css } = uplotAssets();
  const generated = fmtDateTime(new Date().toISOString());

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>EMG report · ${esc(fullName(p))}</title>
<style>${css}
:root{--ink:#0f1e33;--ink2:#43536b;--ink3:#5c6b82;--brand:#0b63ce;--soft:#e6f0fc;--tint:#f3f8fe;--canvas:#f4f7fb;--line:#e1e8f1;--good:#0f7b3d;--bad:#b42323}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Inter",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:24px 16px 64px}
.banner{background:#fff3df;color:#7a4500;border-radius:14px;padding:10px 14px;font-size:13px;margin-bottom:16px}
header.hero{background:linear-gradient(135deg,#0b63ce,#3d8ef0);color:#fff;border-radius:22px;padding:28px}
header.hero h1{margin:6px 0 4px;font-size:32px;letter-spacing:-.02em;line-height:1.1}
header.hero p{margin:0;opacity:.9;font-size:14px}
.grid{display:grid;gap:16px}.g2{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.card{background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 2px rgb(15 30 51/.04),0 4px 16px -6px rgb(15 30 51/.08);padding:20px;margin-top:16px}
h2{font-size:17px;margin:0 0 4px;letter-spacing:-.01em}.sub{color:var(--ink2);font-size:13px;margin:0 0 12px}
.kpi{display:flex;gap:24px;align-items:baseline;flex-wrap:wrap}.kpi b{font-size:26px;letter-spacing:-.02em}.kpi small{color:var(--ink3)}
.up{color:var(--good);font-weight:600}.down{color:var(--bad);font-weight:600}
.seg{display:inline-flex;background:#edf1f7;border-radius:999px;padding:2px;gap:2px;margin:0 6px 10px 0}
.seg button{border:0;background:none;border-radius:999px;padding:6px 12px;font:500 13px inherit;color:var(--ink2);cursor:pointer;font-family:inherit}
.seg button[aria-pressed=true]{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgb(15 30 51/.12)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:#fff;border-radius:999px;padding:5px 10px;font-size:13px;cursor:pointer;font-family:inherit;color:var(--ink)}
.chip[aria-pressed=true]{border-color:transparent;color:#fff}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--line)}th{color:var(--ink2);font-weight:500;background:var(--tint)}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
.u-legend{display:none}.tip{position:absolute;pointer-events:none;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 32px -8px rgb(15 30 51/.25);padding:7px 9px;font-size:12px;white-space:nowrap;z-index:5;display:none}
.muted{color:var(--ink2);font-size:13px}.btn{border:1px solid #c9d5e4;background:#fff;color:var(--brand);border-radius:999px;padding:8px 14px;font:500 13px inherit;cursor:pointer;font-family:inherit}
@media print{.noprint{display:none!important}body{background:#fff}.card{box-shadow:none;break-inside:avoid}}
</style>
</head>
<body>
<div class="wrap">
  <div class="banner noprint">Confidential health information${ctx.share ? ` shared with <b>${esc(ctx.share.recipient)}</b> for “${esc(ctx.share.purpose)}”` : ""}. This file is a copy generated ${esc(generated)} and works offline.</div>
  <header class="hero">
    <p>MyoCare · Surface EMG progress report</p>
    <h1>${esc(fullName(p))}</h1>
    <p>${ageFrom(p.dob)} y · ${esc(p.sex)} · DOB ${esc(fmtDate(p.dob))} · MRN ${esc(p.mrn)}<br>${esc(p.condition)} (${esc(p.affectedSide)}) · Clinician: ${esc(clin?.name ?? "–")} · Goal: ${esc(p.goal)}</p>
  </header>

  <div class="grid g2">
    ${sums
      .map(
        (s) => `<section class="card"><div class="muted">${esc(EXERCISES[s.exercise].muscle)}</div><h2>${esc(EXERCISES[s.exercise].name)}</h2>
      <div class="kpi"><span><small>Baseline</small><br>${s.baseline.toFixed(2)} mV</span><span><small>Latest</small><br><b>${s.latest.toFixed(2)}</b> mV</span>
      <span><small>Change</small><br><span class="${s.changePct >= 0 ? "up" : "down"}">${s.changePct >= 0 ? "+" : ""}${s.changePct.toFixed(0)}%</span></span><span><small>Status</small><br>${s.status}</span></div></section>`,
      )
      .join("")}
  </div>

  <section class="card"><h2>Peak activation per session</h2><p class="sub">Strongest set of each session. Hover for values.</p><div id="trend"></div></section>

  <section class="card">
    <h2>Compare sessions</h2><p class="sub">Pick an exercise and click dates to layer their envelopes (strongest set of each day).</p>
    <div class="noprint"><div id="exSeg" class="seg"></div><div id="modeSeg" class="seg"></div></div>
    <div id="dates" class="chips noprint"></div>
    <div id="overlay"></div>
    <div id="cmpTable"></div>
  </section>

  <section class="card"><h2>Measurement history</h2><p class="sub">Every recorded set. Date, time, exercise and set number as stored.</p><div style="overflow-x:auto"><table id="hist"></table></div></section>

  <section class="card"><h2>About this data</h2>
    <p class="muted">Signals come from ${esc(p.device.model)} (${esc(p.device.id)}, ${p.device.sampleRateHz} Hz): raw surface EMG, full-wave rectified EMG and a low-pass envelope. This file embeds the envelope (downsampled to 50 Hz) and per-set metrics. Storage: ${esc(p.storageRegion)}. Retention: ${esc(p.retentionPolicy)}</p>
    <p class="muted">Consent on file: clinical care · care-team access ${p.consent.careTeamAccess ? "yes" : "no"} · de-identified research ${p.consent.researchDeidentified ? "yes" : "no"}.${b.recordings.some((r) => r.source === "synthetic") ? " <b>Contains synthetic demo data.</b>" : ""}</p>
    <p class="noprint"><button class="btn" onclick="print()">Print / save as PDF</button></p>
  </section>
</div>
<script>${js}</script>
<script>
const D = ${JSON.stringify(data).replace(/</g, "\\u003c")};
const C = ["#2a78d6","#eb6834","#1baf7a","#eda100","#e87ba4","#008300"];
const AX = {stroke:"#5c6b82",grid:{stroke:"#eef2f7"},ticks:{stroke:"#e1e8f1"},font:"12px -apple-system,system-ui,sans-serif"};
const fmtD = (iso, y) => new Date(iso).toLocaleDateString("en-CA",{month:"short",day:"numeric",...(y?{year:"numeric"}:{})});
const sessDate = Object.fromEntries(D.sessions.map(s => [s.id, s.d]));
function tipPlugin(fmt){let t;return{hooks:{init:u=>{t=document.createElement("div");t.className="tip";u.over.appendChild(t);u.over.addEventListener("mouseleave",()=>t.style.display="none")},setCursor:u=>{const {left,top,idx}=u.cursor;if(idx==null||left<0){t.style.display="none";return}const h=fmt(u,idx);if(!h){t.style.display="none";return}t.innerHTML=h;t.style.display="block";const w=t.offsetWidth;t.style.left=(left+14+w>u.over.clientWidth?left-w-14:left+14)+"px";t.style.top=Math.max(0,top-10)+"px"}}}}
function best(ex){const by={};for(const r of D.recs){if(r.ex!==ex)continue;if(!by[r.s]||r.m.peak>by[r.s].m.peak)by[r.s]=r}return Object.values(by).sort((a,b)=>sessDate[a.s].localeCompare(sessDate[b.s]))}
function mk(el,opts,data){const w=el.clientWidth||900;el.innerHTML="";return new uPlot({...opts,width:w,height:opts.height||280},data,el)}

// Trend
(function(){const xs=[...new Set(D.sessions.map(s=>Math.round(new Date(s.d).getTime()/1000)))].sort((a,b)=>a-b);
const series=D.exercises.map(e=>{const m=Object.fromEntries(best(e.key).map(r=>[Math.round(new Date(sessDate[r.s]).getTime()/1000),r.m.peak]));return xs.map(x=>m[x]??null)});
mk(document.getElementById("trend"),{scales:{x:{time:true}},legend:{show:false},cursor:{y:false,points:{size:8,fill:"#fff"}},axes:[AX,{...AX,size:50,label:"mV"}],series:[{},...D.exercises.map((e,i)=>({label:e.name,stroke:C[i],width:2,spanGaps:true,points:{show:true,size:5,fill:"#fff",stroke:C[i]}}))],plugins:[tipPlugin((u,i)=>"<b>"+fmtD(u.data[0][i]*1000,true)+"</b>"+D.exercises.map((e,k)=>u.data[k+1][i]==null?"":"<div><span style='color:"+C[k]+"'>●</span> "+e.name+": <b>"+u.data[k+1][i].toFixed(2)+" mV</b></div>").join(""))]},[xs,...series]);
const leg=document.createElement("div");leg.className="muted";leg.innerHTML=D.exercises.map((e,i)=>"<span style='margin-right:14px'><span style='display:inline-block;width:14px;height:3px;border-radius:2px;vertical-align:middle;background:"+C[i]+"'></span> "+e.name+"</span>").join("");document.getElementById("trend").after(leg)})();

// Compare
let ex=D.exercises[0].key, mode="rep", sel=[];
function slot(){const used=new Set(sel.map(s=>s.slot));let i=0;while(used.has(i))i++;return i}
function seg(el,opts,val,on){el.innerHTML="";for(const [v,l] of opts){const b=document.createElement("button");b.textContent=l;b.setAttribute("aria-pressed",v===val);b.onclick=()=>on(v);el.appendChild(b)}}
function avgRep(r){const env=r.env,fs=1/r.dt;let pk=0;for(const v of env)pk=Math.max(pk,v);const starts=[];let on=false;for(let i=0;i<env.length;i++){if(!on&&env[i]>pk*.35){on=true;starts.push(i)}else if(on&&env[i]<pk*.2)on=false}const pre=Math.round(.5*fs),n=Math.round(3*fs),acc=new Array(n).fill(0);let c=0;for(const s of starts){if(s-pre<0||s-pre+n>env.length)continue;for(let i=0;i<n;i++)acc[i]+=env[s-pre+i];c++}return acc.map(v=>v/(c||1))}
function renderCompare(){
  seg(document.getElementById("exSeg"),D.exercises.map(e=>[e.key,e.name]),ex,v=>{ex=v;sel=[];init();});
  seg(document.getElementById("modeSeg"),[["rep","Average rep"],["set","Whole set"]],mode,v=>{mode=v;renderCompare()});
  const list=best(ex);const dates=document.getElementById("dates");dates.innerHTML="";
  for(const r of list){const s=sel.find(x=>x.id===r.id);const b=document.createElement("button");b.className="chip";b.setAttribute("aria-pressed",!!s);if(s)b.style.background=C[s.slot];b.textContent=fmtD(sessDate[r.s])+" · "+r.m.peak.toFixed(2);b.onclick=()=>{if(s)sel=sel.filter(x=>x.id!==r.id);else if(sel.length<6)sel.push({id:r.id,slot:slot()});renderCompare()};dates.appendChild(b)}
  const chosen=sel.map(s=>({...s,r:D.recs.find(x=>x.id===s.id)})).sort((a,b)=>a.r.d.localeCompare(b.r.d));
  const el=document.getElementById("overlay");
  if(!chosen.length){el.innerHTML="<p class='muted' style='padding:40px;text-align:center;background:var(--canvas);border-radius:12px'>Select dates above to layer them.</p>";document.getElementById("cmpTable").innerHTML="";return}
  const curves=chosen.map(c=>mode==="rep"?avgRep(c.r):c.r.env);const dt=chosen[0].r.dt;const n=Math.max(...curves.map(c=>c.length));const t0=mode==="rep"?-.5:0;
  const x=Array.from({length:n},(_,i)=>+(t0+i*dt).toFixed(3));
  mk(el,{height:300,scales:{x:{time:false}},legend:{show:false},cursor:{y:false,points:{show:false}},axes:[{...AX,values:(u,v)=>v.map(s=>s.toFixed(1)+" s")},{...AX,size:50,label:"mV"}],series:[{},...chosen.map(c=>({stroke:C[c.slot],width:2}))],plugins:[tipPlugin((u,i)=>u.data[0][i].toFixed(2)+" s"+chosen.map((c,k)=>u.data[k+1][i]==null?"":"<div><span style='color:"+C[c.slot]+"'>●</span> "+fmtD(c.r.d)+": <b>"+u.data[k+1][i].toFixed(3)+" mV</b></div>").join(""))]},[x,...curves.map(c=>x.map((_,i)=>c[i]??null))]);
  const f=chosen[0].r.m.peak;
  document.getElementById("cmpTable").innerHTML="<table><tr><th>Date</th><th class=n>Peak</th><th class=n>vs first</th><th class=n>Mean</th><th class=n>MDF</th><th class=n>Fatigue</th></tr>"+chosen.map((c,i)=>{const d=(c.r.m.peak-f)/f*100;return "<tr><td><span style='color:"+C[c.slot]+"'>●</span> "+fmtD(c.r.d,true)+" · set "+c.r.set+"</td><td class=n>"+c.r.m.peak.toFixed(3)+" mV</td><td class='n "+(i===0?"":d>=0?"up":"down")+"'>"+(i===0?"reference":(d>=0?"+":"")+d.toFixed(1)+"%")+"</td><td class=n>"+c.r.m.mean.toFixed(3)+"</td><td class=n>"+c.r.m.mdf.toFixed(0)+" Hz</td><td class=n>"+c.r.m.fat.toFixed(0)+"%</td></tr>"}).join("")+"</table>";
}
function init(){const l=best(ex);sel=[];if(l.length){sel.push({id:l[0].id,slot:0});if(l.length>1)sel.push({id:l[l.length-1].id,slot:1})}renderCompare()}
init();

// History
(function(){const ex=Object.fromEntries(D.exercises.map(e=>[e.key,e.name]));const loc=Object.fromEntries(D.sessions.map(s=>[s.id,s.loc]));
document.getElementById("hist").innerHTML="<tr><th>Date</th><th>Time</th><th>Where</th><th>Exercise</th><th class=n>Set</th><th class=n>Reps</th><th class=n>Peak mV</th><th class=n>Mean mV</th><th class=n>MDF Hz</th><th class=n>Fatigue</th></tr>"+
[...D.recs].sort((a,b)=>b.d.localeCompare(a.d)).map(r=>"<tr><td>"+fmtD(r.d,true)+"</td><td>"+new Date(r.d).toLocaleTimeString("en-CA",{hour:"numeric",minute:"2-digit"})+"</td><td>"+(loc[r.s]==="clinic"?"Clinic":"Home")+"</td><td>"+ex[r.ex]+"</td><td class=n>"+r.set+"</td><td class=n>"+r.m.reps+"</td><td class=n>"+r.m.peak.toFixed(3)+"</td><td class=n>"+r.m.mean.toFixed(3)+"</td><td class=n>"+r.m.mdf.toFixed(0)+"</td><td class=n>"+r.m.fat.toFixed(0)+"%</td></tr>").join("")})();
</script>
</body>
</html>`;
}
