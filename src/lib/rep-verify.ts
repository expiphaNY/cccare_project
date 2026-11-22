// REP COUNTING AND THE TWO-SENSOR CHECK
//
// We count reps twice:
//   - once from the muscle signal (EMG)
//   - once from the arm movement (accelerometer)
// If both sensors found the same rep, that rep is "verified".
//
// How one rep is found (muscle signal):
//   - Work out the quiet level and the strong level of the signal.
//   - UPPER threshold: a rep STARTS when the signal rises past 35% of the way up.
//   - LOWER threshold: a rep ENDS when the signal falls under 20% of the way up.
//   - Two reps less than 0.2 seconds apart are joined into one.
//   - A rep shorter than 0.3 seconds is thrown away (it is probably a twitch).
//
// These are plain functions with no side effects, so the saved result is exactly
// what the session page draws.

import { MOTION_LOWPASS_HZ, processMotion, type MotionRep, type ProcessedMotion } from "./motion";
import type { RepCheck } from "./types";

export interface EmgRep {
  /** Sample indices. */
  startI: number;
  endI: number;
  peakI: number;
  peak: number;
}

/**
 * Finds the reps in the smooth muscle curve.
 *
 * "Quiet level" = a value that 10% of the readings are below.
 * "Strong level" = a value that only 0.5% of the readings are above.
 * (We do not use the single highest reading, because one stray spike would
 * raise the bar and hide all the other reps.)
 *
 * Start line = 35% of the way from quiet to strong. End line = 20% of the way.
 * Using two different lines stops a wobbly curve from counting as many reps.
 */
export function detectEmgReps(env: ArrayLike<number>, fs: number): EmgRep[] {
  const n = env.length;
  if (!n) return [];
  // Sort the readings from smallest to biggest so we can pick the quiet and strong levels.
  const sorted = Float32Array.from(env).sort();
  const floor = sorted[Math.floor((n - 1) * 0.1)];
  const top = sorted[Math.floor((n - 1) * 0.995)];
  const span = top - floor;
  // If the signal barely changes, there are no real reps to find.
  if (!(top > 0) || span < top * 0.25) return [];
  const on = floor + span * 0.35; // UPPER threshold: a rep starts above this
  const off = floor + span * 0.2; // LOWER threshold: a rep ends below this
  const out: EmgRep[] = [];
  let s = -1;
  let pk = 0;
  let pkI = 0;
  // Called when a rep ends. If the last rep ended under 0.2 s ago, join them.
  const close = (e: number) => {
    const prev = out[out.length - 1];
    if (prev && (s - prev.endI) / fs < 0.2) {
      prev.endI = e;
      if (pk > prev.peak) (prev.peak = pk), (prev.peakI = pkI);
    } else out.push({ startI: s, endI: e, peakI: pkI, peak: pk });
  };
  // Walk through the signal one reading at a time.
  for (let i = 0; i < n; i++) {
    const v = env[i];
    // Not in a rep yet, and we crossed the upper threshold: a rep starts.
    if (s < 0 && v > on) (s = i), (pk = v), (pkI = i);
    else if (s >= 0) {
      // In a rep: remember the highest point.
      if (v > pk) (pk = v), (pkI = i);
      // Dropped under the lower threshold: the rep ends.
      if (v < off) close(i), (s = -1);
    }
  }
  // If the recording stops mid-rep, end it there.
  if (s >= 0) close(n - 1);
  // Keep only reps longer than 0.3 seconds.
  return out.filter((r) => (r.endI - r.startI) / fs > 0.3);
}

export interface RepPair {
  start: number;
  end: number;
  source: "both" | "emg" | "motion";
  emgPeak?: number;
  romDeg?: number;
  /** EMG onset minus movement onset (ms). Negative = muscle fired before the arm moved. */
  lagMs?: number;
}

/**
 * Pairs each muscle rep with an arm-movement rep.
 * Two reps are a match if they overlap in time, or start within 0.4 seconds
 * of each other. Each rep can only be matched once. The biggest overlap wins.
 */
export function matchReps(emg: { start: number; end: number; peak: number }[], motion: MotionRep[]): RepPair[] {
  const cand: { i: number; j: number; ov: number }[] = [];
  emg.forEach((e, i) =>
    motion.forEach((m, j) => {
      const ov = Math.min(e.end, m.end) - Math.max(e.start, m.start);
      const shortest = Math.min(e.end - e.start, m.end - m.start);
      // A match: overlap of at least 20% of the shorter rep, or starts within 0.4 s.
      if (ov > 0.2 * shortest || Math.abs(e.start - m.start) < 0.4) cand.push({ i, j, ov });
    }),
  );
  cand.sort((a, b) => b.ov - a.ov); // best overlaps first
  const ue = new Set<number>();
  const um = new Set<number>();
  const pairs: RepPair[] = [];
  for (const c of cand) {
    if (ue.has(c.i) || um.has(c.j)) continue;
    ue.add(c.i);
    um.add(c.j);
    const e = emg[c.i];
    const m = motion[c.j];
    pairs.push({ start: Math.min(e.start, m.start), end: Math.max(e.end, m.end), source: "both", emgPeak: r3(e.peak), romDeg: m.romDeg, lagMs: Math.round((e.start - m.start) * 1000) });
  }
  // Anything left over was seen by only one sensor.
  emg.forEach((e, i) => !ue.has(i) && pairs.push({ start: e.start, end: e.end, source: "emg", emgPeak: r3(e.peak) }));
  motion.forEach((m, j) => !um.has(j) && pairs.push({ start: m.start, end: m.end, source: "motion", romDeg: m.romDeg }));
  return pairs.sort((a, b) => a.start - b.start);
}

export interface Verification {
  check: RepCheck;
  emg: { start: number; end: number; peak: number }[];
  motion: ProcessedMotion | null;
}

/**
 * The full check for one set of reps.
 * Results:
 *   verified  - every rep was seen by both sensors
 *   partial   - most reps agree (75% or more)
 *   mismatch  - the sensors disagree a lot
 *   no-motion - there was no movement data, so we only count the muscle reps
 */
export function verifyReps(
  envelope: ArrayLike<number>,
  fs: number,
  motion?: { x: ArrayLike<number>; y: ArrayLike<number>; z: ArrayLike<number> } | null,
): Verification {
  const emg = detectEmgReps(envelope, fs).map((r) => ({ start: r.startI / fs, end: r.endI / fs, peak: r.peak }));
  const filter = { despike: "block median → median-of-5 (100 ms)", lowpassHz: MOTION_LOWPASS_HZ, method: "zero-phase Butterworth; arm angle from rest orientation" };
  if (!motion || !motion.x.length) {
    return {
      emg,
      motion: null,
      check: { status: "no-motion", emgReps: emg.length, motionReps: 0, verifiedReps: 0, agreement: 0, meanLagMs: null, meanRomDeg: null, reps: emg.map((e) => ({ start: r2(e.start), end: r2(e.end), source: "emg", emgPeak: r3(e.peak) })), filter },
    };
  }
  // Clean the movement data and find the movement reps.
  const pm = processMotion(motion, fs, envelope);
  const pairs = matchReps(emg, pm.reps);
  const both = pairs.filter((p) => p.source === "both");
  // Agreement score: 1 means both sensors found exactly the same reps, 0 means none in common.
  const agreement = emg.length + pm.reps.length ? (2 * both.length) / (emg.length + pm.reps.length) : 0;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const status: RepCheck["status"] =
    both.length > 0 && both.length === emg.length && both.length === pm.reps.length ? "verified" : agreement >= 0.75 ? "partial" : "mismatch";
  const meanLag = avg(both.map((p) => p.lagMs!));
  const meanRom = avg(pm.reps.map((r) => r.romDeg));
  return {
    emg,
    motion: pm,
    check: {
      status,
      emgReps: emg.length,
      motionReps: pm.reps.length,
      verifiedReps: both.length,
      agreement: r2(agreement),
      meanLagMs: meanLag == null ? null : Math.round(meanLag),
      meanRomDeg: meanRom == null ? null : Math.round(meanRom),
      reps: pairs.map((p) => ({ ...p, start: r2(p.start), end: r2(p.end) })),
      filter,
    },
  };
}

export const REP_STATUS: Record<RepCheck["status"], { label: string; tone: "good" | "warn" | "bad" | "neutral"; help: string }> = {
  verified: { label: "Reps verified", tone: "good", help: "EMG and accelerometer found the same repetitions." },
  partial: { label: "Mostly verified", tone: "warn", help: "Most reps agree; a few were seen by only one sensor." },
  mismatch: { label: "Reps disagree", tone: "bad", help: "EMG and movement disagree. Check electrode contact, sensor placement or form." },
  "no-motion": { label: "EMG only", tone: "neutral", help: "No accelerometer data, so reps are counted from EMG alone." },
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
