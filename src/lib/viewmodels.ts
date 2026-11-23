// =============================================================================
// viewmodels.ts : SHAPING DATA FOR CHARTS
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Turns server data into the small, plain props the client-side charts need, so the charts hold no
//   data-fetching logic.
// =============================================================================

import { summarize, trendFor, type MetricKey } from "./analytics";
import { fmtTime, sessionName, sessionTitle } from "./format";
import type { Patient, Recording, Session } from "./types";
import { EXERCISES } from "./types";
import type { CompareRecording } from "@/components/CompareTool";
import type { TrendPoint } from "@/components/charts/TrendPanel";

export function exerciseList(p: Patient) {
  return p.exercises.map((key) => ({ key, ...EXERCISES[key] }));
}

export function trendProps(
  p: Patient,
  recs: Recording[],
  metrics: MetricKey[],
  sessions: Session[] = [],
) {
  // Align exercises on the session start so one tooltip shows every exercise.
  const start = new Map(sessions.map((s) => [s.id, s.startedAt]));
  const trends: Record<string, Partial<Record<MetricKey, TrendPoint[]>>> = {};
  for (const ex of p.exercises) {
    trends[ex] = {};
    for (const m of metrics) {
      trends[ex][m] = trendFor(recs, ex, m).map((pt) => ({
        t: Math.round(
          new Date(start.get(pt.sessionId) ?? pt.date).getTime() / 1000,
        ),
        v: Math.round(pt.value * 1000) / 1000,
        sessionId: pt.sessionId,
      }));
    }
  }
  return { exercises: exerciseList(p), trends, metrics };
}

/**
 * Shapes recordings for the compare picker. Each carries its session's name, so two sessions on the same
 * day can be told apart: the title ("Nov 22, 2026" or the name the clinician typed), the start time, and
 * the full name with the time, which is what the legend and chart use.
 */
export function compareRecordings(
  recs: Recording[],
  sessions: Session[] = [],
): CompareRecording[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  return recs.map((r) => {
    const s = byId.get(r.sessionId) ?? { startedAt: r.recordedAt };
    return {
      id: r.id,
      sessionId: r.sessionId,
      sessionName: sessionName(s),
      sessionTitle: sessionTitle(s),
      sessionTime: fmtTime(s.startedAt),
      date: r.recordedAt,
      exercise: r.exercise,
      setNumber: r.setNumber,
      peak: r.metrics.peakEnvelope,
      mean: r.metrics.meanEnvelope,
      mdf: r.metrics.medianFreqHz,
      fatigue: r.metrics.fatigueIndex,
    };
  });
}

export function defaultComparison(p: Patient, recs: Recording[]) {
  const s = summarize(recs, p.exercises[0]);
  if (!s) return { exercise: p.exercises[0], ids: [] as string[] };
  // Opening the compare panel selects only the most recent session. The quick picks beside the list
  // (baseline vs latest, progression, ...) add more when the clinician wants them.
  return { exercise: p.exercises[0], ids: [s.latestRecordingId] };
}

export function summaries(p: Patient, recs: Recording[]) {
  return p.exercises
    .map((e) => summarize(recs, e))
    .filter((x): x is NonNullable<typeof x> => !!x);
}
