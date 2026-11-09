// Pure functions that turn recordings into the macro-level numbers shown on
// dashboards. Safe to import from client components.

import type { ExerciseKey, Metrics, Recording, Session } from "./types";

export type MetricKey = "peakEnvelope" | "meanEnvelope" | "rms" | "iemg" | "medianFreqHz" | "fatigueIndex";

export const METRICS: Record<
  MetricKey,
  { label: string; plain: string; unit: string; digits: number; higherIsBetter: boolean; help: string }
> = {
  peakEnvelope: {
    label: "Peak activation",
    plain: "Strongest muscle effort",
    unit: "mV",
    digits: 2,
    higherIsBetter: true,
    help: "Highest value of the EMG envelope during the set.",
  },
  meanEnvelope: {
    label: "Mean activation",
    plain: "Average effort while working",
    unit: "mV",
    digits: 2,
    higherIsBetter: true,
    help: "Average envelope over samples where the muscle was active (>15% of peak).",
  },
  rms: {
    label: "RMS amplitude",
    plain: "Signal strength",
    unit: "mV",
    digits: 3,
    higherIsBetter: true,
    help: "Root-mean-square of the raw EMG while active.",
  },
  iemg: {
    label: "Integrated EMG",
    plain: "Total work done",
    unit: "mV·s",
    digits: 2,
    higherIsBetter: true,
    help: "Area under the rectified signal while active. Depends on set length.",
  },
  medianFreqHz: {
    label: "Median frequency",
    plain: "Freshness of the muscle",
    unit: "Hz",
    digits: 0,
    higherIsBetter: true,
    help: "Median of the raw EMG power spectrum. Drops as the muscle fatigues.",
  },
  fatigueIndex: {
    label: "Fatigue index",
    plain: "How much effort dropped by the end",
    unit: "%",
    digits: 0,
    higherIsBetter: true,
    help: "Peak of the last reps vs the first reps. Closer to 0% = better endurance.",
  },
};

export interface SessionPoint {
  sessionId: string;
  date: string;
  value: number;
  bestRecordingId: string;
}

/** One value per session for an exercise: best set for amplitude metrics, mean otherwise. */
export function trendFor(recs: Recording[], exercise: ExerciseKey, metric: MetricKey): SessionPoint[] {
  const bySession = new Map<string, Recording[]>();
  for (const r of recs) {
    if (r.exercise !== exercise) continue;
    const list = bySession.get(r.sessionId) ?? [];
    list.push(r);
    bySession.set(r.sessionId, list);
  }
  const pts: SessionPoint[] = [];
  for (const [sessionId, list] of bySession) {
    const best = list.reduce((a, b) => (b.metrics.peakEnvelope > a.metrics.peakEnvelope ? b : a));
    const value =
      metric === "peakEnvelope"
        ? best.metrics.peakEnvelope
        : list.reduce((s, r) => s + (r.metrics[metric] as number), 0) / list.length;
    pts.push({ sessionId, date: list[0].recordedAt, value, bestRecordingId: best.id });
  }
  return pts.sort((a, b) => a.date.localeCompare(b.date));
}

export type Status = "improving" | "steady" | "declining" | "new";

export interface ExerciseSummary {
  exercise: ExerciseKey;
  baseline: number;
  latest: number;
  best: number;
  changePct: number;
  status: Status;
  points: SessionPoint[];
  baselineRecordingId: string;
  latestRecordingId: string;
  bestRecordingId: string;
}

export function summarize(recs: Recording[], exercise: ExerciseKey): ExerciseSummary | null {
  const pts = trendFor(recs, exercise, "peakEnvelope");
  if (!pts.length) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const best = pts.reduce((a, b) => (b.value > a.value ? b : a));
  return {
    exercise,
    baseline: first.value,
    latest: last.value,
    best: best.value,
    changePct: ((last.value - first.value) / first.value) * 100,
    status: statusOf(pts.map((p) => p.value)),
    points: pts,
    baselineRecordingId: first.bestRecordingId,
    latestRecordingId: last.bestRecordingId,
    bestRecordingId: best.bestRecordingId,
  };
}

/** Compares the last 2 sessions with the 3 before them. */
export function statusOf(values: number[]): Status {
  if (values.length < 4) return "new";
  const recent = values.slice(-2);
  const prior = values.slice(-5, -2);
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ratio = avg(recent) / avg(prior);
  if (ratio < 0.92) return "declining";
  if (ratio > 1.04) return "improving";
  return "steady";
}

export function sessionsPerWeek(sessions: Session[]) {
  if (sessions.length < 2) return sessions.length;
  const first = new Date(sessions[0].startedAt).getTime();
  const last = new Date(sessions[sessions.length - 1].startedAt).getTime();
  const weeks = Math.max(1, (last - first) / (7 * 864e5));
  return sessions.length / weeks;
}

export function formatMetric(m: Metrics, key: MetricKey) {
  const def = METRICS[key];
  const v = m[key] as number;
  return `${v.toFixed(def.digits)} ${def.unit}`;
}
