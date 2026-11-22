// =============================================================================
// analysis.ts : NUMBERS FOR THE ASSISTANT'S TOOLS
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Loads a patient's records and works out the plain facts the assistant is allowed to quote: finding a patient or session by name or date, trends, and a one-row summary of each patient. Keeping this in plain code means every number comes from data, not from the model.
// =============================================================================

import "server-only";
import { METRICS, sessionsPerWeek, statusOf, summarize, trendFor, type MetricKey, type SessionPoint } from "../analytics";
import { fullName } from "../format";
import { getStore } from "../store";
import { EXERCISES, fmtLoad, type ExerciseKey, type Patient, type Recording, type Session } from "../types";

// Deterministic numbers for the agent. The model only chooses what to call and
// explains the result; it never computes a statistic itself.

export const r2 = (n: number | null | undefined, d = 2) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

export interface Bundle {
  patient: Patient;
  sessions: Session[];
  recordings: Recording[];
}

export async function loadBundle(id: string): Promise<Bundle | null> {
  const store = await getStore();
  const patient = await store.getPatient(id);
  if (!patient) return null;
  const [sessions, recordings] = await Promise.all([store.listSessions(id), store.listRecordings(id)]);
  return { patient, sessions, recordings };
}

export async function loadAll(): Promise<Bundle[]> {
  const store = await getStore();
  const patients = await store.listPatients();
  return Promise.all(
    patients.map(async (patient) => {
      const [sessions, recordings] = await Promise.all([store.listSessions(patient.id), store.listRecordings(patient.id)]);
      return { patient, sessions, recordings };
    }),
  );
}

/** Matches a patient by id, full name, first or last name (case-insensitive). */
export function resolvePatient(all: Bundle[], q: string): Bundle | null {
  const s = q.trim().toLowerCase();
  if (!s) return null;
  return (
    all.find((b) => b.patient.id.toLowerCase() === s) ??
    all.find((b) => fullName(b.patient).toLowerCase() === s) ??
    all.find((b) => fullName(b.patient).toLowerCase().includes(s) || s.includes(b.patient.lastName.toLowerCase())) ??
    null
  );
}

/** "latest" | "first" | "previous" | "current" | session id | YYYY-MM-DD. */
export function resolveSession(b: Bundle, q: string | undefined, currentId?: string): Session | null {
  const ss = b.sessions;
  if (!ss.length) return null;
  const s = (q ?? "latest").trim().toLowerCase();
  if (s === "latest" || s === "last" || s === "most recent") return ss[ss.length - 1];
  if (s === "first" || s === "baseline") return ss[0];
  if (s === "previous") return ss[ss.length - 2] ?? null;
  if (s === "current" || s === "this") return ss.find((x) => x.id === currentId) ?? null;
  return ss.find((x) => x.id.toLowerCase() === s) ?? ss.findLast((x) => x.startedAt.startsWith(s)) ?? null;
}

export function sessionHref(pid: string, sid?: string) {
  const base = `/doctor/patients/${pid}`;
  return sid ? `${base}/sessions/${sid}` : base;
}

export interface TrendStats {
  metric: string;
  unit: string;
  higherIsBetter: boolean;
  sessions: number;
  first: { date: string; value: number | null; sessionId: string } | null;
  latest: { date: string; value: number | null; sessionId: string } | null;
  best: { date: string; value: number | null; sessionId: string } | null;
  worst: { date: string; value: number | null; sessionId: string } | null;
  changeSinceStartPct: number | null;
  /** Last 2 sessions vs the 3 before them. */
  recentChangePct: number | null;
  /** Least-squares slope, as % of the mean per week. */
  slopePctPerWeek: number | null;
  /** Coefficient of variation: how much sessions bounce around. */
  variabilityPct: number | null;
  direction: "improving" | "steady" | "declining" | "too few sessions";
  points: { date: string; value: number | null }[];
}

export function trendStats(pts: SessionPoint[], metric: MetricKey): TrendStats {
  const def = METRICS[metric];
  const v = pts.map((p) => p.value);
  const n = v.length;
  const pt = (p?: SessionPoint) => (p ? { date: p.date.slice(0, 10), value: r2(p.value, def.digits + 1), sessionId: p.sessionId } : null);
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
  const mean = avg(v);
  const better = (a: SessionPoint, b: SessionPoint) => (def.higherIsBetter ? b.value > a.value : b.value < a.value);
  let slope: number | null = null;
  if (n >= 3) {
    const t0 = new Date(pts[0].date).getTime();
    const xs = pts.map((p) => (new Date(p.date).getTime() - t0) / (7 * 864e5));
    const mx = avg(xs);
    const num = xs.reduce((s, x, i) => s + (x - mx) * (v[i] - mean), 0);
    const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    if (den > 0 && mean !== 0) slope = (num / den / Math.abs(mean)) * 100;
  }
  const recent =
    n >= 4 ? (metric === "fatigueIndex" ? avg(v.slice(-2)) - avg(v.slice(-5, -2)) : (avg(v.slice(-2)) / avg(v.slice(-5, -2)) - 1) * 100) : null;
  const sd = Math.sqrt(avg(v.map((x) => (x - mean) ** 2)));
  // fatigueIndex is already a signed % (closer to 0 is better), so "change" is a difference.
  const change = n >= 2 ? (metric === "fatigueIndex" ? v[n - 1] - v[0] : ((v[n - 1] - v[0]) / Math.abs(v[0])) * 100) : null;
  let direction: TrendStats["direction"] = "too few sessions";
  if (n >= 4) {
    if (metric === "fatigueIndex") {
      // Signed %: a ratio of negatives would invert, so compare the difference.
      const d = avg(v.slice(-2)) - avg(v.slice(-5, -2));
      direction = d > 3 ? "improving" : d < -3 ? "declining" : "steady";
    } else {
      const s = statusOf(v);
      direction = s === "new" ? "too few sessions" : s;
    }
  }
  return {
    metric: def.label,
    unit: def.unit,
    higherIsBetter: def.higherIsBetter,
    sessions: n,
    first: pt(pts[0]),
    latest: pt(pts[n - 1]),
    best: n ? pt(pts.reduce((a, b) => (better(a, b) ? b : a))) : null,
    worst: n ? pt(pts.reduce((a, b) => (better(b, a) ? b : a))) : null,
    changeSinceStartPct: r2(change, 1),
    recentChangePct: r2(recent, 1),
    slopePctPerWeek: r2(slope, 1),
    variabilityPct: n >= 2 && mean ? r2((sd / Math.abs(mean)) * 100, 1) : null,
    direction,
    points: pts.slice(-12).map((p) => ({ date: p.date.slice(0, 10), value: r2(p.value, def.digits + 1) })),
  };
}

export function metricTrend(b: Bundle, metric: MetricKey, exercise?: ExerciseKey, lastN?: number) {
  const ex = exercise && b.patient.exercises.includes(exercise) ? exercise : b.patient.exercises[0];
  let pts = trendFor(b.recordings, ex, metric);
  if (lastN && lastN > 1) pts = pts.slice(-lastN);
  return { exercise: EXERCISES[ex].name, ...trendStats(pts, metric) };
}

/** One row of headline numbers per patient, used for ranking and reports. */
export function patientRow(b: Bundle) {
  const { patient: p, sessions, recordings } = b;
  const ex = p.exercises[0];
  const s = summarize(recordings, ex);
  const peak = trendStats(trendFor(recordings, ex, "peakEnvelope"), "peakEnvelope");
  const last = sessions[sessions.length - 1];
  const lastRecs = last ? recordings.filter((r) => r.sessionId === last.id) : [];
  const pain = sessions.filter((x) => x.painScore != null).map((x) => x.painScore!);
  return {
    patientId: p.id,
    name: fullName(p),
    condition: p.condition,
    affectedSide: p.affectedSide,
    exercise: EXERCISES[ex].name,
    sessions: sessions.length,
    lastSession: last?.startedAt.slice(0, 10) ?? null,
    daysSinceLastSession: last ? Math.floor((Date.now() - new Date(last.startedAt).getTime()) / 864e5) : null,
    sessionsPerWeek: r2(sessionsPerWeek(sessions), 1),
    status: s?.status ?? "new",
    peakBaselineMv: r2(s?.baseline, 3),
    peakLatestMv: r2(s?.latest, 3),
    overallChangePct: r2(s?.changePct, 1),
    recentChangePct: peak.recentChangePct,
    slopePctPerWeek: peak.slopePctPerWeek,
    latestFatigueIndexPct: lastRecs.length ? r2(lastRecs.reduce((a, r) => a + r.metrics.fatigueIndex, 0) / lastRecs.length, 1) : null,
    painFirst: pain[0] ?? null,
    painLatest: pain[pain.length - 1] ?? null,
    painChange: pain.length >= 2 ? pain[pain.length - 1] - pain[0] : null,
    prescribedLoad: p.prescribedLoad ? fmtLoad(p.prescribedLoad) : null,
    latestLoad: lastRecs.find((r) => r.load) ? fmtLoad(lastRecs.find((r) => r.load)!.load) : null,
    href: `/doctor/patients/${p.id}`,
  };
}

export type PatientRow = ReturnType<typeof patientRow>;

export function setSummary(r: Recording) {
  const m = r.metrics;
  const base = {
    recordingId: r.id,
    set: r.setNumber,
    exercise: EXERCISES[r.exercise].name,
    time: r.recordedAt.slice(11, 16),
    reps: m.repsDetected,
    load: fmtLoad(r.load),
    repCheck: r.repCheck
      ? { status: r.repCheck.status, emgReps: r.repCheck.emgReps, movementReps: r.repCheck.motionReps, verifiedReps: r.repCheck.verifiedReps, meanRomDeg: r.repCheck.meanRomDeg }
      : null,
    peakMv: r2(m.peakEnvelope, 3),
    meanMv: r2(m.meanEnvelope, 3),
    fatigueIndexPct: r2(m.fatigueIndex, 1),
    repPeaksMv: m.repPeaks.map((x) => r2(x, 3)),
  };
  const clipped = r.capture?.clippedPct ?? 0;
  const quality = clipped >= 2 && !r.capture?.rawStreamed ? `Sensor at its maximum ${clipped}% of the set: peaks are underestimated.` : undefined;
  return {
    ...base,
    durationS: r.durationS,
    sampleRateHz: r.sampleRateHz,
    rmsMv: r2(m.rms, 4),
    iemgMvS: r2(m.iemg, 3),
    medianFreqHz: r2(m.medianFreqHz, 0),
    repMedianFreqHz: m.repMedianFreq.map((x) => r2(x, 0)),
    source: r.source,
    channels: r.channels ?? ["raw", "rectified", "envelope"],
    ...(quality && { quality }),
  };
}
