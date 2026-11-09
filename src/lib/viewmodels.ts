// Shapes server data into the small, serialisable props client charts need.

import { summarize, trendFor, type MetricKey } from "./analytics";
import type { Patient, Recording, Session } from "./types";
import { EXERCISES } from "./types";
import type { CompareRecording } from "@/components/CompareTool";
import type { TrendPoint } from "@/components/charts/TrendPanel";

export function exerciseList(p: Patient) {
  return p.exercises.map((key) => ({ key, ...EXERCISES[key] }));
}

export function trendProps(p: Patient, recs: Recording[], metrics: MetricKey[], sessions: Session[] = []) {
  // Align exercises on the session start so one tooltip shows every exercise.
  const start = new Map(sessions.map((s) => [s.id, s.startedAt]));
  const trends: Record<string, Partial<Record<MetricKey, TrendPoint[]>>> = {};
  for (const ex of p.exercises) {
    trends[ex] = {};
    for (const m of metrics) {
      trends[ex][m] = trendFor(recs, ex, m).map((pt) => ({
        t: Math.round(new Date(start.get(pt.sessionId) ?? pt.date).getTime() / 1000),
        v: Math.round(pt.value * 1000) / 1000,
        sessionId: pt.sessionId,
      }));
    }
  }
  return { exercises: exerciseList(p), trends, metrics };
}

export function compareRecordings(recs: Recording[]): CompareRecording[] {
  return recs.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    date: r.recordedAt,
    exercise: r.exercise,
    setNumber: r.setNumber,
    peak: r.metrics.peakEnvelope,
    mean: r.metrics.meanEnvelope,
    mdf: r.metrics.medianFreqHz,
    fatigue: r.metrics.fatigueIndex,
  }));
}

export function defaultComparison(p: Patient, recs: Recording[]) {
  const s = summarize(recs, p.exercises[0]);
  if (!s) return { exercise: p.exercises[0], ids: [] as string[] };
  const ids = [s.baselineRecordingId];
  if (s.points.length > 2) ids.push(s.points[Math.floor(s.points.length / 2)].bestRecordingId);
  if (s.latestRecordingId !== s.baselineRecordingId) ids.push(s.latestRecordingId);
  return { exercise: p.exercises[0], ids };
}

export function summaries(p: Patient, recs: Recording[]) {
  return p.exercises.map((e) => summarize(recs, e)).filter((x): x is NonNullable<typeof x> => !!x);
}
