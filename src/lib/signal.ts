// =============================================================================
// signal.ts : DEMO SIGNALS, AND MEASURING A FINISHED SET
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Two jobs, kept together because they share the same idea of what a muscle set
//   looks like:
//     1. MAKE FAKE DATA (generateSignal, generateMotion). The demo patients have no
//        real sensor behind them, so these functions invent a believable muscle
//        signal and arm movement for each set. The same seed always gives the same
//        set, so the demo looks identical on every computer.
//     2. MEASURE A SET (analyzeSignal). Given a muscle signal it works out the
//        headline numbers: peak, average, rep count, fatigue and so on. The same
//        code measures real and fake sets, so demo results behave like real ones.
//
//   A set recorded with an envelope-only sensor carries just the envelope. For it the
//   numbers that need the fast raw signal (RMS and median frequency) are left at 0 and
//   hidden on screen. Sets with raw data, and the demo patients, have all three channels
//   (raw, rectified and envelope) so the full set of graphs can be shown.
//
// STEPS TAKEN FOR THE MARKING RUBRIC
//   Accuracy of measurements: because fake sets are made from known settings (a known
//   amplitude, fatigue and tremor), we can check the measuring code against the answer
//   we put in. For example the measured envelope tracks the amplitude it was given.
//   Design limitations: analyzeSignal says clearly which numbers need raw data and
//   leaves them out instead of inventing them.
// =============================================================================

import type { Metrics, SynthParams } from "./types";

export const DEFAULT_FS = 1000;

/* ---------- random numbers (the same seed always gives the same "random" numbers) ---------- */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function gaussFactory(rand: () => number) {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };
}

/* ---------- fake signal generator (for demos) ---------- */

const RISE = 0.45;
const HOLD = 1.3;
const FALL = 0.45;
const REST = 1.6;
const LEAD = 1.0;
const TAIL = 1.0;

export function synthDuration(reps: number) {
  return LEAD + reps * (RISE + HOLD + FALL) + (reps - 1) * REST + TAIL;
}

/**
 * Decides when each fake rep starts and how strong it is.
 * The random numbers are used in a fixed order, so the same seed always gives the
 * same signal, and the fake arm movement lines up with the fake muscle signal.
 */
function repTimeline(p: SynthParams, rand: () => number, gauss: () => number) {
  const cycle = RISE + HOLD + FALL + REST;
  const out: { start: number; amp: number; tremorPhase: number }[] = [];
  for (let k = 0; k < p.reps; k++) {
    const progress = p.reps > 1 ? k / (p.reps - 1) : 0;
    const amp = p.amplitude * (1 - p.fatigue * progress) * (1 + 0.05 * gauss());
    const jitter = (rand() - 0.5) * 0.2;
    const start = LEAD + k * cycle + jitter;
    const tremorPhase = rand() * Math.PI * 2;
    out.push({ start, amp, tremorPhase });
  }
  return out;
}

const minJerk = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (10 - 15 * x + 6 * x * x));

/**
 * Makes a fake arm-movement signal that matches the fake muscle signal.
 * It returns the accelerometer x, y and z, with noise, tremor and the odd bad reading,
 * as a real chip reports them.
 * In each rep the arm starts moving a moment (about 0.06 s) after the muscle fires,
 * curls up, holds, then lowers a bit slower than it went up.
 * Like a real sensor it adds a little noise and the odd bad reading.
 * About one set in eight has a half-hearted rep where the arm barely moves.
 * It also adds a small shake that is strongest at the top and grows as the muscle tires.
 */
export function generateMotion(p: SynthParams, fs = DEFAULT_FS) {
  const rand = mulberry32(p.seed);
  const gauss = gaussFactory(rand);
  const timeline = repTimeline(p, rand, gauss);
  const r = mulberry32((p.seed ^ 0x5bd1e995) >>> 0);
  const g2 = gaussFactory(r);
  const n = Math.round(synthDuration(p.reps) * fs);
  const romBase = 105 + r() * 25;
  const partial = r() < 0.125 ? Math.floor(r() * p.reps) : -1;
  const roms = timeline.map((_, k) => {
    const progress = p.reps > 1 ? k / (p.reps - 1) : 0;
    const rom = romBase * (1 - 0.12 * p.fatigue * progress * 4) * (1 + 0.04 * g2());
    return k === partial ? rom * 0.22 : rom;
  });
  const EMD = 0.06;
  const UP = RISE + 0.15;
  const DOWN = FALL + 0.3;
  const theta = (t: number) => {
    let a = 0;
    timeline.forEach(({ start }, k) => {
      const u = t - start - EMD;
      if (u < 0 || u > UP + HOLD + DOWN) return;
      // Minimum-jerk profile: acceleration starts and ends at zero, like a real arm.
      const f = u < UP ? minJerk(u / UP) : u < UP + HOLD ? 1 : 1 - minJerk((u - UP - HOLD) / DOWN);
      a = Math.max(a, f * roms[k]);
    });
    return (a * Math.PI) / 180;
  };
  // Rest orientation: forearm hanging, slightly rotated.
  const tilt = 0.1 + r() * 0.15;
  // Tremor uses its own random stream so rep timing and noise stay as they were.
  const tr = mulberry32((p.seed ^ 0x27d4eb2d) >>> 0);
  const tHz = p.tremorHz ?? 8.5 + tr() * 2;
  const tAmp = ((p.tremorMg ?? 6) / 1000) * Math.SQRT2; // sine peak for the RMS target
  const ph = [tr(), tr(), tr()].map((q) => q * 2 * Math.PI);
  const dHz = 0.35 + tr() * 0.3; // second component: amplitude beating, like real tremor
  // Hold phase multiplier: 1 at the top, ~0.45 at rest, in between while moving.
  const holdness = (t: number) => {
    let h = 0.45;
    timeline.forEach(({ start }, k) => {
      const u = t - start - EMD;
      if (u < 0 || u > UP + HOLD + DOWN) return;
      const f = u < UP ? u / UP : u < UP + HOLD ? 1 : 1 - (u - UP - HOLD) / DOWN;
      const progress = p.reps > 1 ? k / (p.reps - 1) : 0;
      h = Math.max(h, 0.45 + 0.55 * f * (1 + 0.8 * p.fatigue * progress * 3));
    });
    return h;
  };
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const z = new Float32Array(n);
  const hold = Math.max(1, Math.round(fs / 50));
  let cur = [0, 0, -1];
  for (let i = 0; i < n; i++) {
    if (i % hold === 0) {
      const t = i / fs;
      const th = theta(t);
      // Small linear acceleration from the curl itself (second difference of the angle).
      // Linear (tangential) acceleration of a sensor ~15 cm from the elbow, in g.
      const lin = ((theta(t + 0.02) - 2 * th + theta(t - 0.02)) / 0.0004) * (0.15 / 9.81);
      const a = tAmp * holdness(t);
      const shake = (k: number) => a * (Math.sin(2 * Math.PI * tHz * t + ph[k]) * 0.8 + Math.sin(2 * Math.PI * (tHz + dHz) * t + ph[(k + 1) % 3]) * 0.6) / Math.hypot(0.8, 0.6);
      // Shake splits across the rotation axis (x) and the curl plane (y, z); sensor noise ~4 mg.
      cur = [
        Math.sin(tilt) + 0.004 * g2() + shake(0) * 0.65,
        Math.sin(th) * Math.cos(tilt) + lin + 0.004 * g2() + shake(1) * 0.55,
        -Math.cos(th) * Math.cos(tilt) + 0.004 * g2() + shake(2) * 0.52,
      ];
      if (r() < 0.006) cur[Math.floor(r() * 3)] += (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.6);
    }
    x[i] = cur[0];
    y[i] = cur[1];
    z[i] = cur[2];
  }
  return { x, y, z };
}

/**
 * Makes a fake muscle signal with the same 3 versions the real pipeline has:
 *   raw       = the fast, wobbly signal
 *   rectified = the raw signal with negatives flipped to positive
 *   envelope  = the smooth curve
 * The signal is noise that gets louder while the fake muscle works.
 */
export function generateSignal(p: SynthParams, fs = DEFAULT_FS) {
  const rand = mulberry32(p.seed);
  const gauss = gaussFactory(rand);
  const dur = synthDuration(p.reps);
  const n = Math.round(dur * fs);

  const act = new Float32Array(n);
  const zone = new Int16Array(n).fill(-1);
  let zoneIndex = 0;

  for (const { start, amp, tremorPhase } of repTimeline(p, rand, gauss)) {
    const k = zoneIndex++;
    const zStart = Math.max(0, Math.floor((start - REST / 2) * fs));
    const zEnd = Math.min(n, Math.floor((start + RISE + HOLD + FALL + REST / 2) * fs));
    for (let i = zStart; i < zEnd; i++) zone[i] = k;
    for (let i = Math.max(0, Math.floor(start * fs)); i < n; i++) {
      const t = i / fs - start;
      let a = 0;
      if (t < RISE) a = 0.5 * (1 - Math.cos((Math.PI * t) / RISE));
      else if (t < RISE + HOLD)
        a = 1 + 0.04 * Math.sin(2 * Math.PI * 1.3 * t + tremorPhase);
      else if (t < RISE + HOLD + FALL)
        a = 0.5 * (1 + Math.cos((Math.PI * (t - RISE - HOLD)) / FALL));
      else break;
      act[i] = Math.max(act[i], amp * a);
    }
  }

  // Band-limited carrier: high-pass ~20 Hz, 2x low-pass at a cutoff that drops
  // with fatigue (this is what lowers median frequency in tired muscle).
  const carrier = new Float32Array(n);
  const hpA = Math.exp((-2 * Math.PI * 20) / fs);
  let hpPrevX = 0;
  let hpPrevY = 0;
  let lp1 = 0;
  let lp2 = 0;
  for (let i = 0; i < n; i++) {
    const k = zone[i] < 0 ? 0 : zone[i];
    const progress = p.reps > 1 ? k / (p.reps - 1) : 0;
    const fc = 150 * (1 - p.spectralFatigue * progress);
    const lpA = Math.exp((-2 * Math.PI * fc) / fs);
    const x = gauss();
    const hp = hpA * (hpPrevY + x - hpPrevX);
    hpPrevX = x;
    hpPrevY = hp;
    lp1 = lpA * lp1 + (1 - lpA) * hp;
    lp2 = lpA * lp2 + (1 - lpA) * lp1;
    carrier[i] = lp2;
  }
  // Normalise carrier variance per rep zone so amplitude stays calibrated.
  const zoneCount = p.reps + 1;
  const sumSq = new Float64Array(zoneCount);
  const cnt = new Float64Array(zoneCount);
  for (let i = 0; i < n; i++) {
    const z = zone[i] + 1;
    sumSq[z] += carrier[i] * carrier[i];
    cnt[z] += 1;
  }
  const scale = new Float64Array(zoneCount);
  for (let z = 0; z < zoneCount; z++) scale[z] = cnt[z] ? 1 / Math.sqrt(sumSq[z] / cnt[z]) : 1;

  const raw = new Float32Array(n);
  const rectified = new Float32Array(n);
  const envelope = new Float32Array(n);
  // mean(|N(0,σ)|) = σ·√(2/π) → σ = amp / 0.7979 so the envelope tracks amp.
  const sigmaGain = 1 / Math.sqrt(2 / Math.PI);
  const envA = Math.exp((-2 * Math.PI * 3.5) / fs);
  let e1 = 0;
  let e2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const v =
      act[i] * carrier[i] * scale[zone[i] + 1] * sigmaGain +
      0.006 * gauss() +
      0.003 * Math.sin(2 * Math.PI * 60 * t);
    raw[i] = v;
    const r = Math.abs(v);
    rectified[i] = r;
    e1 = envA * e1 + (1 - envA) * r;
    e2 = envA * e2 + (1 - envA) * e1;
    envelope[i] = e2;
  }
  return { raw, rectified, envelope, fs };
}

/* ---------- measuring a recording ---------- */

// Frequency maths (FFT). Only used for one number, the "median frequency", which
// drops as a muscle tires. You can skip this part when presenting.

function fftInPlace(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ar = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const ai = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j + len / 2] = re[i + j] - ar;
        im[i + j + len / 2] = im[i + j] - ai;
        re[i + j] += ar;
        im[i + j] += ai;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

const WIN = 512;

function powerSpectrum(raw: Float32Array, start: number) {
  const re = new Float64Array(WIN);
  const im = new Float64Array(WIN);
  for (let i = 0; i < WIN; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1));
    re[i] = (raw[start + i] ?? 0) * w;
  }
  fftInPlace(re, im);
  const p = new Float64Array(WIN / 2);
  for (let i = 0; i < WIN / 2; i++) p[i] = re[i] * re[i] + im[i] * im[i];
  return p;
}

function medianFreq(power: Float64Array, fs: number) {
  let total = 0;
  for (let i = 1; i < power.length; i++) total += power[i];
  let acc = 0;
  for (let i = 1; i < power.length; i++) {
    acc += power[i];
    if (acc >= total / 2) return (i * fs) / WIN;
  }
  return 0;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Measures one set. Returns:
 *   peakEnvelope  = the highest point of the smooth curve
 *   meanEnvelope  = the average height while the muscle is working
 *   rms, iemg     = two other ways to say "how much total muscle work"
 *   repsDetected  = number of reps (start above 35% of the peak, end below 20%)
 *   fatigueIndex  = last reps' peak compared with first reps' peak (negative = getting weaker)
 *   medianFreqHz  = how fast the signal wobbles (only when we have the fast raw data)
 */
export function analyzeSignal(
  raw: Float32Array,
  rectified: Float32Array,
  envelope: Float32Array,
  fs: number,
): Metrics {
  const n = envelope.length;
  // Some sensors send only the smooth curve and no raw data.
  // Numbers that need raw data are then set to 0 and hidden on screen.
  const hasRaw = raw.length === n;
  const hasRect = rectified.length === n;
  let peak = 0;
  for (let i = 0; i < n; i++) if (envelope[i] > peak) peak = envelope[i];
  const thr = peak * 0.15; // "working" means above 15% of the peak

  let activeN = 0;
  let envSum = 0;
  let sq = 0;
  let rectSum = 0;
  for (let i = 0; i < n; i++) {
    if (envelope[i] > thr) {
      activeN++;
      envSum += envelope[i];
      if (hasRaw) sq += raw[i] * raw[i];
      rectSum += hasRect ? rectified[i] : envelope[i];
    }
  }

  // Count the reps with two lines (hysteresis) on the envelope: a rep starts above
  // 35% of the peak and ends below 20% of it. Same rule as detectEmgReps in rep-verify.ts.
  const on = peak * 0.35;
  const off = peak * 0.2;
  const reps: { start: number; end: number; peak: number; peakIdx: number }[] = [];
  let inRep = false;
  let cur = { start: 0, end: 0, peak: 0, peakIdx: 0 };
  for (let i = 0; i < n; i++) {
    const v = envelope[i];
    if (!inRep && v > on) {
      inRep = true;
      cur = { start: i, end: i, peak: v, peakIdx: i };
    } else if (inRep) {
      if (v > cur.peak) {
        cur.peak = v;
        cur.peakIdx = i;
      }
      if (v < off) {
        inRep = false;
        cur.end = i;
        if ((cur.end - cur.start) / fs > 0.3) reps.push(cur);
      }
    }
  }
  if (inRep) {
    cur.end = n - 1;
    reps.push(cur);
  }

  const repPeaks = reps.map((r) => r3(r.peak));
  const repMedianFreq = !hasRaw || fs < 200 ? reps.map(() => 0) : reps.map((r) => {
    // Split the rep into overlapping slices, measure each, and average them.
    const acc = new Float64Array(WIN / 2);
    for (let s = r.start; s + WIN <= r.end; s += WIN / 2) {
      const p = powerSpectrum(raw, s);
      for (let i = 0; i < acc.length; i++) acc[i] += p[i];
    }
    return r1(medianFreq(acc, fs));
  });

  const k = Math.min(2, Math.floor(reps.length / 2)) || 1;
  const first = repPeaks.slice(0, k);
  const last = repPeaks.slice(-k);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const fatigue = avg(first) ? (avg(last) / avg(first) - 1) * 100 : 0;

  return {
    peakEnvelope: r3(peak),
    meanEnvelope: r3(activeN ? envSum / activeN : 0),
    rms: r3(hasRaw && activeN ? Math.sqrt(sq / activeN) : 0),
    iemg: r3(rectSum / fs),
    medianFreqHz: r1(avg(repMedianFreq)),
    fatigueIndex: r1(fatigue),
    activeTimeS: r1(activeN / fs),
    repsDetected: reps.length,
    repPeaks,
    repMedianFreq,
  };
}

/** For sensors that send only raw data: flip negatives, then smooth, to get the smooth curve. */
export function deriveChannels(raw: Float32Array, fs: number) {
  const rectified = new Float32Array(raw.length);
  const envelope = new Float32Array(raw.length);
  const a = Math.exp((-2 * Math.PI * 3.5) / fs);
  let e1 = 0;
  let e2 = 0;
  for (let i = 0; i < raw.length; i++) {
    const r = Math.abs(raw[i]);
    rectified[i] = r;
    e1 = a * e1 + (1 - a) * r;
    e2 = a * e2 + (1 - a) * e1;
    envelope[i] = e2;
  }
  return { rectified, envelope };
}

/* ---------- shrinking data so charts draw quickly ---------- */

/** Shrinks smooth data by averaging small blocks. */
export function resampleMean(x: Float32Array, fs: number, targetHz: number) {
  const step = Math.max(1, Math.round(fs / targetHz));
  const out: number[] = [];
  for (let i = 0; i < x.length; i += step) {
    let s = 0;
    let c = 0;
    for (let j = i; j < Math.min(i + step, x.length); j++) {
      s += x[j];
      c++;
    }
    out.push(Math.round((s / c) * 10000) / 10000);
  }
  return { y: out, dt: step / fs };
}

/**
 * Shrinks fast, wobbly data for a chart. From each small block it keeps the lowest
 * and the highest point, so spikes are still visible.
 */
export function decimateMinMax(x: Float32Array, fs: number, maxPoints: number) {
  if (x.length <= maxPoints) {
    return {
      t: Array.from(x, (_, i) => Math.round((i / fs) * 1000) / 1000),
      y: Array.from(x, (v) => Math.round(v * 10000) / 10000),
    };
  }
  const buckets = Math.floor(maxPoints / 2);
  const size = x.length / buckets;
  const t: number[] = [];
  const y: number[] = [];
  for (let b = 0; b < buckets; b++) {
    const s = Math.floor(b * size);
    const e = Math.min(x.length, Math.floor((b + 1) * size));
    let mn = Infinity;
    let mx = -Infinity;
    let mnI = s;
    let mxI = s;
    for (let i = s; i < e; i++) {
      if (x[i] < mn) {
        mn = x[i];
        mnI = i;
      }
      if (x[i] > mx) {
        mx = x[i];
        mxI = i;
      }
    }
    const [i1, v1, i2, v2] = mnI < mxI ? [mnI, mn, mxI, mx] : [mxI, mx, mnI, mn];
    t.push(Math.round((i1 / fs) * 1000) / 1000, Math.round((i2 / fs) * 1000) / 1000);
    y.push(Math.round(v1 * 10000) / 10000, Math.round(v2 * 10000) / 10000);
  }
  return { t, y };
}
