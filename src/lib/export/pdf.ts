// PDF report built with pdf-lib (pure JS, no headless browser needed).

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { metricAvailable, summarize } from "../analytics";
import type { PatientBundle } from "../data";
import { clinicianById } from "../data";
import { ageFrom, fmtDate, fmtDateTime, fmtTime, fullName } from "../format";
import type { AuditEvent, Recording, Share, SignalData } from "../types";
import { EXERCISES } from "../types";

const A4: [number, number] = [595.28, 841.89];
const M = 44;
const BRAND = rgb(11 / 255, 99 / 255, 206 / 255);
const INK = rgb(15 / 255, 30 / 255, 51 / 255);
const INK2 = rgb(67 / 255, 83 / 255, 107 / 255);
const LINE = rgb(225 / 255, 232 / 255, 241 / 255);
const TINT = rgb(243 / 255, 248 / 255, 254 / 255);
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

/** Standard PDF fonts only encode WinAnsi — map or drop everything else. */
function safe(s: string) {
  return s
    .replace(/→/g, "->")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/Δ/g, "Change ")
    .replace(/[^\x00-\xFF‘’“”–—…•€™]/g, "?");
}

class Writer {
  doc: PDFDocument;
  page!: PDFPage;
  y = 0;
  font!: PDFFont;
  bold!: PDFFont;
  pageNo = 0;
  footer: string;
  constructor(doc: PDFDocument, footer: string) {
    this.doc = doc;
    this.footer = footer;
  }
  async init() {
    this.font = await this.doc.embedFont(StandardFonts.Helvetica);
    this.bold = await this.doc.embedFont(StandardFonts.HelveticaBold);
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage(A4);
    this.pageNo++;
    this.y = A4[1] - M;
    this.page.drawText(safe(this.footer), { x: M, y: 24, size: 7.5, font: this.font, color: INK2 });
    this.page.drawText(`Page ${this.pageNo}`, { x: A4[0] - M - 30, y: 24, size: 7.5, font: this.font, color: INK2 });
  }
  ensure(h: number) {
    if (this.y - h < 50) this.newPage();
  }
  text(s: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; gap?: number; maxWidth?: number } = {}) {
    const size = o.size ?? 10;
    const font = o.bold ? this.bold : this.font;
    const maxW = o.maxWidth ?? A4[0] - M * 2 - ((o.x ?? M) - M);
    const words = safe(s).split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else cur = t;
    }
    if (cur) lines.push(cur);
    for (const l of lines) {
      this.ensure(size + 4);
      this.y -= size + 3;
      this.page.drawText(l, { x: o.x ?? M, y: this.y, size, font, color: o.color ?? INK });
    }
    this.y -= o.gap ?? 4;
  }
  rule() {
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: A4[0] - M, y: this.y }, thickness: 0.6, color: LINE });
    this.y -= 10;
  }
  /** keepWith: height of the block that must stay on the same page as the heading. */
  heading(s: string, keepWith = 0) {
    this.ensure(40 + keepWith);
    this.y -= 10;
    this.text(s, { size: 13, bold: true, gap: 6 });
  }
  /** Line chart. series: arrays of [x, y]. */
  chart(series: { pts: [number, number][]; color: string; label: string; dashed?: boolean }[], o: { h: number; yLabel: string; xFmt: (x: number) => string; yDigits?: number }) {
    const w = A4[0] - M * 2;
    const h = o.h;
    this.ensure(h + 44);
    const left = M + 34;
    const plotW = w - 40;
    const top = this.y - 14;
    const bottom = top - h;
    const xs = series.flatMap((s) => s.pts.map((p) => p[0]));
    const ys = series.flatMap((s) => s.pts.map((p) => p[1]));
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const yMin = Math.min(0, ...ys);
    const yMax = Math.max(...ys) * 1.08 || 1;
    const X = (v: number) => left + ((v - x0) / (x1 - x0 || 1)) * plotW;
    const Y = (v: number) => bottom + ((v - yMin) / (yMax - yMin)) * h;
    for (let i = 0; i <= 4; i++) {
      const v = yMin + ((yMax - yMin) * i) / 4;
      const yy = Y(v);
      this.page.drawLine({ start: { x: left, y: yy }, end: { x: left + plotW, y: yy }, thickness: 0.4, color: LINE });
      this.page.drawText(v.toFixed(o.yDigits ?? 2), { x: M, y: yy - 3, size: 7, font: this.font, color: INK2 });
    }
    this.page.drawText(safe(o.yLabel), { x: M, y: top + 4, size: 7, font: this.font, color: INK2 });
    for (let i = 0; i <= 4; i++) {
      const v = x0 + ((x1 - x0) * i) / 4;
      const label = safe(o.xFmt(v));
      const tw = this.font.widthOfTextAtSize(label, 7);
      this.page.drawText(label, { x: Math.min(X(v) - tw / 2, left + plotW - tw), y: bottom - 11, size: 7, font: this.font, color: INK2 });
    }
    for (const s of series) {
      for (let i = 1; i < s.pts.length; i++) {
        this.page.drawLine({
          start: { x: X(s.pts[i - 1][0]), y: Y(s.pts[i - 1][1]) },
          end: { x: X(s.pts[i][0]), y: Y(s.pts[i][1]) },
          thickness: s.dashed ? 0.8 : 1.4,
          color: hex(s.color),
          dashArray: s.dashed ? [3, 3] : undefined,
        });
      }
    }
    // legend
    let lx = left;
    const ly = bottom - 24;
    for (const s of series) {
      this.page.drawLine({ start: { x: lx, y: ly + 3 }, end: { x: lx + 12, y: ly + 3 }, thickness: 2, color: hex(s.color), dashArray: s.dashed ? [3, 2] : undefined });
      this.page.drawText(safe(s.label), { x: lx + 16, y: ly, size: 7.5, font: this.font, color: INK });
      lx += 26 + this.font.widthOfTextAtSize(safe(s.label), 7.5);
    }
    this.y = ly - 12;
  }
  table(cols: { label: string; w: number; align?: "left" | "right" }[], rows: string[][]) {
    const draw = (cells: string[], bold: boolean, bg?: boolean) => {
      this.ensure(16);
      if (bg) this.page.drawRectangle({ x: M, y: this.y - 13, width: A4[0] - M * 2, height: 15, color: TINT });
      let x = M + 4;
      cells.forEach((c, i) => {
        const col = cols[i];
        const font = bold ? this.bold : this.font;
        const t = safe(c);
        const tw = font.widthOfTextAtSize(t, 8);
        this.page.drawText(t, { x: col.align === "right" ? x + col.w - tw - 6 : x, y: this.y - 9, size: 8, font, color: bold ? INK2 : INK });
        x += col.w;
      });
      this.y -= 15;
    };
    draw(cols.map((c) => c.label), true, true);
    rows.forEach((r) => {
      if (this.y < 70) {
        this.newPage();
        draw(cols.map((c) => c.label), true, true);
      }
      draw(r, false);
    });
    this.y -= 6;
  }
}

function typicalRep(sig: SignalData) {
  const env = sig.envelope;
  const fs = sig.sampleRateHz;
  let peak = 0;
  for (const v of env) peak = Math.max(peak, v);
  const starts: number[] = [];
  let on = false;
  for (let i = 0; i < env.length; i++) {
    if (!on && env[i] > peak * 0.35) {
      on = true;
      starts.push(i);
    } else if (on && env[i] < peak * 0.2) on = false;
  }
  const pre = Math.round(0.5 * fs);
  const n = Math.round(3 * fs);
  const acc = new Float64Array(n);
  let c = 0;
  for (const s of starts) {
    if (s - pre < 0 || s - pre + n > env.length) continue;
    for (let i = 0; i < n; i++) acc[i] += env[s - pre + i];
    c++;
  }
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i += 20) pts.push([i / fs - 0.5, acc[i] / (c || 1)]);
  return pts;
}

export async function buildPdf(
  b: PatientBundle,
  getSignal: (id: string) => Promise<SignalData | null>,
  ctx: { generatedBy: string; share?: Share | null; audit: AuditEvent[] },
) {
  const doc = await PDFDocument.create();
  const p = b.patient;
  doc.setTitle(`MyoCare EMG report — ${fullName(p)}`);
  doc.setAuthor("MyoCare");
  doc.setSubject("Surface EMG rehabilitation progress report");
  doc.setCreationDate(new Date());
  const w = new Writer(doc, `CONFIDENTIAL health information · ${fullName(p)} · generated ${fmtDateTime(new Date().toISOString())} for ${ctx.generatedBy}`);
  await w.init();

  // Header band
  w.page.drawRectangle({ x: 0, y: A4[1] - 92, width: A4[0], height: 92, color: BRAND });
  w.page.drawText("MyoCare", { x: M, y: A4[1] - 40, size: 18, font: w.bold, color: rgb(1, 1, 1) });
  w.page.drawText(safe("Surface EMG progress report"), { x: M, y: A4[1] - 60, size: 10.5, font: w.font, color: rgb(0.9, 0.95, 1) });
  w.page.drawText(safe(`Generated ${fmtDateTime(new Date().toISOString())}`), { x: A4[0] - M - 170, y: A4[1] - 40, size: 8.5, font: w.font, color: rgb(0.9, 0.95, 1) });
  if (ctx.share)
    w.page.drawText(safe(`Shared with: ${ctx.share.recipient}`).slice(0, 60), { x: A4[0] - M - 170, y: A4[1] - 54, size: 8.5, font: w.font, color: rgb(0.9, 0.95, 1) });
  w.y = A4[1] - 118;

  const clin = clinicianById(p.clinicianId);
  w.text(fullName(p), { size: 20, bold: true, gap: 2 });
  w.text(
    `${ageFrom(p.dob)} y · ${p.sex} · DOB ${fmtDate(p.dob)} · MRN ${p.mrn} · ${p.condition} (${p.affectedSide}) · Clinician: ${clin?.name ?? "–"}`,
    { size: 9, color: INK2, gap: 2 },
  );
  w.text(`Goal: ${p.goal}`, { size: 9, color: INK2, gap: 2 });
  w.text(`Device: ${p.device.model} (${p.device.id}, fw ${p.device.firmware}, ${p.device.sampleRateHz} Hz) · Sessions: ${b.sessions.length} · Sets: ${b.recordings.length}`, {
    size: 9,
    color: INK2,
    gap: 10,
  });
  if (b.recordings.some((r) => r.source === "synthetic")) w.text("Note: this record contains synthetic demo data.", { size: 8, color: INK2, gap: 6 });
  w.rule();

  // Summary per exercise
  w.heading("Summary");
  const sums = p.exercises.map((e) => summarize(b.recordings, e)).filter(Boolean) as NonNullable<ReturnType<typeof summarize>>[];
  w.table(
    [
      { label: "Exercise (muscle)", w: 200 },
      { label: "Baseline peak", w: 75, align: "right" },
      { label: "Latest peak", w: 70, align: "right" },
      { label: "Best", w: 60, align: "right" },
      { label: "Change", w: 60, align: "right" },
      { label: "Status", w: 40 },
    ],
    sums.map((s) => [
      `${EXERCISES[s.exercise].name} (${EXERCISES[s.exercise].muscle})`,
      `${s.baseline.toFixed(3)} mV`,
      `${s.latest.toFixed(3)} mV`,
      `${s.best.toFixed(3)} mV`,
      `${s.changePct >= 0 ? "+" : ""}${s.changePct.toFixed(1)}%`,
      s.status,
    ]),
  );

  // Trend chart
  if (sums.length) {
    w.heading("Peak activation per session", 200);
    w.chart(
      sums.map((s, i) => ({ pts: s.points.map((pt) => [new Date(pt.date).getTime(), pt.value] as [number, number]), color: SERIES[i], label: EXERCISES[s.exercise].name })),
      { h: 150, yLabel: "Peak envelope (mV)", xFmt: (x) => fmtDate(new Date(x).toISOString(), { year: undefined }) },
    );
  }

  // Baseline vs latest overlay (typical rep)
  for (const [i, s] of sums.entries()) {
    const [a, z] = await Promise.all([getSignal(s.baselineRecordingId), getSignal(s.latestRecordingId)]);
    if (!a || !z) continue;
    const ra = b.recordings.find((r) => r.id === s.baselineRecordingId)!;
    const rz = b.recordings.find((r) => r.id === s.latestRecordingId)!;
    w.heading(`${EXERCISES[s.exercise].name}: typical repetition, baseline vs latest`, 170);
    w.chart(
      [
        { pts: typicalRep(a), color: SERIES[0], label: `${fmtDate(ra.recordedAt)} (baseline)` },
        { pts: typicalRep(z), color: SERIES[1], label: `${fmtDate(rz.recordedAt)} (latest)` },
      ],
      { h: 120, yLabel: "Envelope (mV), reps aligned at onset & averaged", xFmt: (x) => `${x.toFixed(1)} s` },
    );
    if (i > 2) break;
  }

  // History
  w.heading("Full measurement history");
  const sessById = new Map(b.sessions.map((s) => [s.id, s]));
  const rows = [...b.recordings]
    .sort((x, y) => x.recordedAt.localeCompare(y.recordedAt))
    .map((r: Recording) => [
      fmtDate(r.recordedAt),
      fmtTime(r.recordedAt),
      sessById.get(r.sessionId)?.location === "clinic" ? "Clinic" : "Home",
      EXERCISES[r.exercise].name,
      String(r.setNumber),
      String(r.metrics.repsDetected),
      r.metrics.peakEnvelope.toFixed(3),
      r.metrics.meanEnvelope.toFixed(3),
      metricAvailable(r, "medianFreqHz") ? r.metrics.medianFreqHz.toFixed(0) : "–",
      `${r.metrics.fatigueIndex.toFixed(0)}%`,
    ]);
  w.table(
    [
      { label: "Date", w: 66 },
      { label: "Time", w: 50 },
      { label: "Where", w: 38 },
      { label: "Exercise", w: 130 },
      { label: "Set", w: 26, align: "right" },
      { label: "Reps", w: 30, align: "right" },
      { label: "Peak mV", w: 46, align: "right" },
      { label: "Mean mV", w: 46, align: "right" },
      { label: "MDF Hz", w: 40, align: "right" },
      { label: "Fatigue", w: 35, align: "right" },
    ],
    rows,
  );

  const notes = b.sessions.filter((s) => s.notes);
  if (notes.length) {
    w.heading("Clinical notes");
    for (const s of notes) w.text(`${fmtDate(s.startedAt)}: ${s.notes!.replace(/\n/g, " / ")}`, { size: 9, gap: 3 });
  }

  // Provenance & privacy
  w.heading("Data provenance & privacy");
  w.text(
    `Signals: surface EMG from ${p.device.model}. Each set stores raw EMG, full-wave rectified EMG and a low-pass envelope at ${p.device.sampleRateHz} Hz, tagged with exercise, set number, date and time. Metrics: peak/mean envelope over active samples (>15% of peak), RMS, integrated EMG, median power frequency (Welch, 512-sample Hann windows), fatigue index (last vs first reps).`,
    { size: 8.5, color: INK2 },
  );
  w.text(`Storage: ${p.storageRegion}. Retention: ${p.retentionPolicy}`, { size: 8.5, color: INK2 });
  w.text(
    `Consent: clinical care (required) · care-team access ${p.consent.careTeamAccess ? "yes" : "no"} · de-identified research ${p.consent.researchDeidentified ? "yes" : "no"} (updated ${fmtDate(p.consent.updatedAt)}).`,
    { size: 8.5, color: INK2 },
  );
  if (ctx.share)
    w.text(`This copy was produced through a share link created by ${ctx.share.createdBy.name} for "${ctx.share.purpose}". Link expires ${fmtDate(ctx.share.expiresAt)}.`, {
      size: 8.5,
      color: INK2,
    });
  w.text("Machine-readable equivalent: HL7 FHIR R4 Bundle (Patient, Encounter, Observation with SampledData, Consent, Provenance).", { size: 8.5, color: INK2, gap: 8 });

  if (ctx.audit.length) {
    w.text("Recent access log", { size: 10, bold: true, gap: 4 });
    w.table(
      [
        { label: "When", w: 120 },
        { label: "Who", w: 150 },
        { label: "What", w: 237 },
      ],
      ctx.audit.slice(0, 15).map((e) => [fmtDateTime(e.at), `${e.actor.name} (${e.actor.role})`, e.detail.slice(0, 60)]),
    );
  }

  return doc.save();
}
