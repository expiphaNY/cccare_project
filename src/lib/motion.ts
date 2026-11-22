// ARM MOVEMENT (ACCELEROMETER) CLEANING AND REP COUNTING
//
// The accelerometer measures gravity in 3 directions. When the arm tilts, the
// 3 numbers change. From them we work out how far the arm has turned (the angle).
//
// The steps for a saved set:
//   1. Shrink the data to about 50 readings a second. We take the MIDDLE value of
//      each small block, so a single bad reading is dropped instead of smeared.
//   2. Remove any spike that is still left (middle value of 5 readings in a row).
//   3. Smooth the line so only slow arm movement remains.
//      We smooth forwards and then backwards, so the timing does not shift.
//      That keeps the movement lined up with the muscle signal for the cross-check.
//   4. Find the "rest" position: the arm hanging at the bottom of the curl.
//      The rest end is the end where the muscle is quiet.
//      Angle = how far the arm has turned away from rest.
//   5. Count reps with two thresholds, like the muscle signal:
//      a rep STARTS when the angle passes 50% of the set's range,
//      and ENDS when it falls under 25%.
//      A rep must last at least 0.5 seconds and move at least 8 degrees.
//
// These are plain functions, so the live screen, the save step and the session
// page all clean and count movement in the same way.

/** Smooth the movement line so only changes slower than 3 times a second remain. */
export const MOTION_LOWPASS_HZ = 3;
/** The movement data is shrunk to this many readings per second before we use it. */
export const MOTION_WORK_HZ = 50;
/** Smallest arm movement (degrees) that counts as a repetition. */
export const MIN_ROM_DEG = 8;
const ON_FRAC = 0.5; // UPPER threshold: a rep starts at 50% of the range
const OFF_FRAC = 0.25; // LOWER threshold: a rep ends at 25% of the range
const MIN_REP_S = 0.5; // a rep must last at least half a second
const MERGE_GAP_S = 0.25; // two reps closer than this are joined into one

export interface Window {
  /** Seconds from the start of the set. */
  start: number;
  end: number;
  /** Time of the maximum inside the window (s). */
  peakT: number;
}

export interface MotionRep extends Window {
  /** Largest arm angle reached in this rep, degrees from rest. */
  romDeg: number;
}

export interface ProcessedMotion {
  /** Rate of every array below (≈ 50 Hz). */
  fs: number;
  /** Decimated but unfiltered x/y/z (g): what the sensor sent. */
  raw: { x: Float32Array; y: Float32Array; z: Float32Array };
  /** Despiked + zero-phase low-passed x/y/z (g). */
  smooth: { x: Float32Array; y: Float32Array; z: Float32Array };
  /** Arm angle away from the rest orientation, degrees. */
  angle: Float32Array;
  reps: MotionRep[];
  /** 95th-percentile arm angle: how far the arm typically travelled. */
  rangeDeg: number;
  /** Spikes removed by the median stages (count at the working rate). */
  spikesRemoved: number;
}

/* ---------- filters ---------- */

/** The fixed numbers for the smoothing filter, worked out once. */
function lowpassCoeffs(fs: number, hz: number) {
  const w0 = (2 * Math.PI * Math.min(hz, fs * 0.45)) / fs;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const b0 = (1 - cos) / 2 / a0;
  return { b0, b1: 2 * b0, b2: b0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

/** Smoothing filter for live data. Starts at the first reading so there is no jump. */
export class LowPass {
  private c: ReturnType<typeof lowpassCoeffs>;
  private x1 = NaN;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(fs: number, hz = MOTION_LOWPASS_HZ) {
    this.c = lowpassCoeffs(fs, hz);
  }
  step(x: number) {
    if (Number.isNaN(this.x1)) this.x1 = this.x2 = this.y1 = this.y2 = x;
    const { b0, b1, b2, a1, a2 } = this.c;
    const y = b0 * x + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Smooths the data forwards, then backwards, so the timing does not shift. */
export function filtfilt(x: ArrayLike<number>, fs: number, hz = MOTION_LOWPASS_HZ): Float32Array {
  const n = x.length;
  if (n < 4) return Float32Array.from(x);
  const pad = Math.min(n - 1, Math.round(fs));
  const ext = new Float64Array(n + 2 * pad);
  for (let i = 0; i < pad; i++) ext[i] = 2 * x[0] - x[pad - i];
  for (let i = 0; i < n; i++) ext[pad + i] = x[i];
  for (let i = 0; i < pad; i++) ext[pad + n + i] = 2 * x[n - 1] - x[n - 2 - i];
  const run = (a: Float64Array) => {
    const lp = new LowPass(fs, hz);
    for (let i = 0; i < a.length; i++) a[i] = lp.step(a[i]);
    a.reverse();
  };
  run(ext);
  run(ext);
  return Float32Array.from(ext.subarray(pad, pad + n));
}

function median(a: number[]) {
  const s = [...a].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Replaces each reading with the middle value of its neighbours. This removes spikes. */
function medianFilter(x: Float32Array, k: number, spikeG = 0.15) {
  const h = k >> 1;
  const out = new Float32Array(x.length);
  let changed = 0;
  for (let i = 0; i < x.length; i++) {
    const w: number[] = [];
    for (let j = Math.max(0, i - h); j <= Math.min(x.length - 1, i + h); j++) w.push(x[j]);
    out[i] = median(w);
    if (Math.abs(out[i] - x[i]) > spikeG) changed++;
  }
  return { out, changed };
}

/** Shrinks the data: keeps the middle value of each small block. */
function decimate(x: ArrayLike<number>, step: number) {
  const out = new Float32Array(Math.ceil(x.length / step));
  const blk: number[] = [];
  for (let b = 0; b < out.length; b++) {
    blk.length = 0;
    for (let j = b * step; j < Math.min((b + 1) * step, x.length); j++) blk.push(x[j]);
    out[b] = median(blk);
  }
  return out;
}

function percentile(x: ArrayLike<number>, p: number) {
  const s = Float32Array.from(x).sort();
  if (!s.length) return 0;
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
}

/** Finds the main direction the arm moves in. */
function principalAxis(x: Float32Array, y: Float32Array, z: Float32Array) {
  const n = x.length;
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < n; i++) (mx += x[i]), (my += y[i]), (mz += z[i]);
  mx /= n;
  my /= n;
  mz /= n;
  const c = [0, 0, 0, 0, 0, 0]; // xx xy xz yy yz zz
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx, b = y[i] - my, d = z[i] - mz;
    c[0] += a * a; c[1] += a * b; c[2] += a * d; c[3] += b * b; c[4] += b * d; c[5] += d * d;
  }
  let v = [1, 1, 1];
  for (let it = 0; it < 30; it++) {
    const w = [c[0] * v[0] + c[1] * v[1] + c[2] * v[2], c[1] * v[0] + c[3] * v[1] + c[4] * v[2], c[2] * v[0] + c[4] * v[1] + c[5] * v[2]];
    const norm = Math.hypot(w[0], w[1], w[2]) || 1;
    v = w.map((q) => q / norm);
  }
  return { mean: [mx, my, mz], axis: v };
}

function angleBetween(ax: number, ay: number, az: number, r: number[]) {
  const na = Math.hypot(ax, ay, az) || 1;
  const nr = Math.hypot(r[0], r[1], r[2]) || 1;
  const cos = (ax * r[0] + ay * r[1] + az * r[2]) / (na * nr);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/* ---------- batch (saved sets) ---------- */

export function processMotion(
  m: { x: ArrayLike<number>; y: ArrayLike<number>; z: ArrayLike<number> },
  fs: number,
  /** EMG envelope on the same grid, used only to tell rest from the top of the curl. */
  envelope?: ArrayLike<number>,
): ProcessedMotion {
  const step = Math.max(1, Math.round(fs / MOTION_WORK_HZ));
  const wfs = fs / step;
  const raw = { x: decimate(m.x, step), y: decimate(m.y, step), z: decimate(m.z, step) };
  const k = Math.max(3, Math.round(wfs * 0.1) | 1);
  const mx = medianFilter(raw.x, k);
  const my = medianFilter(raw.y, k);
  const mz = medianFilter(raw.z, k);
  const smooth = { x: filtfilt(mx.out, wfs), y: filtfilt(my.out, wfs), z: filtfilt(mz.out, wfs) };
  const n = smooth.x.length;

  // Rest = the end of the movement axis the set starts and ends at.
  const { mean, axis } = principalAxis(smooth.x, smooth.y, smooth.z);
  const proj = new Float32Array(n);
  for (let i = 0; i < n; i++) proj[i] = (smooth.x[i] - mean[0]) * axis[0] + (smooth.y[i] - mean[1]) * axis[1] + (smooth.z[i] - mean[2]) * axis[2];
  const lo = percentile(proj, 0.05);
  const hi = percentile(proj, 0.95);
  const edge = Math.max(1, Math.round(wfs * 0.6));
  const ends = [...proj.subarray(0, edge), ...proj.subarray(Math.max(0, n - edge))];
  let restIsLow = Math.abs(median(ends) - lo) <= Math.abs(median(ends) - hi);
  if (envelope && envelope.length >= m.x.length * 0.9) {
    // Mean EMG near each end of the movement axis: the quiet end is rest.
    const band = (hi - lo) * 0.2;
    let lowSum = 0, lowN = 0, highSum = 0, highN = 0;
    for (let i = 0; i < n; i++) {
      let e = 0, c = 0;
      for (let j = i * step; j < Math.min((i + 1) * step, envelope.length); j++) (e += envelope[j]), c++;
      if (!c) continue;
      e /= c;
      if (proj[i] <= lo + band) (lowSum += e), lowN++;
      else if (proj[i] >= hi - band) (highSum += e), highN++;
    }
    if (lowN && highN) {
      const a = lowSum / lowN;
      const b = highSum / highN;
      if (Math.abs(a - b) > 0.1 * Math.max(a, b)) restIsLow = a < b;
    }
  }
  const near = (v: number) => (restIsLow ? v <= lo + (hi - lo) * 0.1 : v >= hi - (hi - lo) * 0.1);
  const rest = [0, 0, 0];
  let rc = 0;
  for (let i = 0; i < n; i++)
    if (near(proj[i])) {
      rest[0] += smooth.x[i];
      rest[1] += smooth.y[i];
      rest[2] += smooth.z[i];
      rc++;
    }
  if (rc) for (let j = 0; j < 3; j++) rest[j] /= rc;
  else rest.splice(0, 3, smooth.x[0], smooth.y[0], smooth.z[0]);

  const angle = new Float32Array(n);
  for (let i = 0; i < n; i++) angle[i] = angleBetween(smooth.x[i], smooth.y[i], smooth.z[i], rest);
  const rangeDeg = percentile(angle, 0.95);
  const reps = detectMotionReps(angle, wfs, rangeDeg);
  return { fs: wfs, raw, smooth, angle, reps, rangeDeg: round1(rangeDeg), spikesRemoved: mx.changed + my.changed + mz.changed };
}

/** Counts reps from the arm angle, using the upper and lower thresholds. */
export function detectMotionReps(angle: Float32Array, fs: number, rangeDeg = percentile(angle, 0.95)): MotionRep[] {
  if (rangeDeg < MIN_ROM_DEG) return [];
  const on = rangeDeg * ON_FRAC;
  const off = rangeDeg * OFF_FRAC;
  const wins: MotionRep[] = [];
  let s = -1;
  let pk = 0;
  let pkI = 0;
  const close = (end: number) => {
    const prev = wins[wins.length - 1];
    const w = { start: s / fs, end: end / fs, peakT: pkI / fs, romDeg: round1(pk) };
    if (prev && w.start - prev.end < MERGE_GAP_S) {
      prev.end = w.end;
      if (w.romDeg > prev.romDeg) (prev.romDeg = w.romDeg), (prev.peakT = w.peakT);
    } else wins.push(w);
  };
  for (let i = 0; i < angle.length; i++) {
    const a = angle[i];
    if (s < 0 && a > on) (s = i), (pk = a), (pkI = i);
    else if (s >= 0) {
      if (a > pk) (pk = a), (pkI = i);
      if (a < off) close(i), (s = -1);
    }
  }
  if (s >= 0) close(angle.length - 1);
  return wins.filter((w) => w.end - w.start >= MIN_REP_S && w.romDeg >= MIN_ROM_DEG);
}

/* ---------- streaming (live recorder) ---------- */

/**
 * Live accelerometer cleaner + rep counter. Median-of-5 then a causal 3 Hz
 * low-pass per axis. Rest orientation = running average of the arm's
 * orientation while the muscle is quiet, so a set that starts mid-curl still
 * finds the bottom of the movement.
 */
export class LiveMotion {
  private med: number[][] = [[], [], []];
  private lp: LowPass[];
  private rest: number[] | null = null;
  private restAcc = [0, 0, 0];
  private restN = 0;
  private maxAngle = 0;
  private inRep = false;
  private repStart = 0;
  private repPeak = 0;
  reps = 0;
  roms: number[] = [];
  angle = 0;
  constructor(fs = MOTION_WORK_HZ) {
    this.lp = [new LowPass(fs), new LowPass(fs), new LowPass(fs)];
  }
  /** Cleans one reading (g). Returns the smoothed x/y/z. */
  smooth(x: number, y: number, z: number): [number, number, number] {
    return [x, y, z].map((v, i) => {
      const m = this.med[i];
      m.push(v);
      if (m.length > 5) m.shift();
      return this.lp[i].step(median(m));
    }) as [number, number, number];
  }
  /**
   * Feeds a smoothed reading while a set is recording (t in ms). `quiet` = the
   * EMG envelope is near its resting floor right now.
   */
  track(sx: number, sy: number, sz: number, t: number, quiet: boolean) {
    if (quiet) {
      this.restAcc[0] += sx;
      this.restAcc[1] += sy;
      this.restAcc[2] += sz;
      this.restN++;
      if (this.restN >= 10) this.rest = this.restAcc.map((v) => v / this.restN);
    }
    if (!this.rest) return;
    const a = angleBetween(sx, sy, sz, this.rest);
    this.angle = a;
    this.maxAngle = Math.max(this.maxAngle, a);
    if (this.maxAngle < MIN_ROM_DEG) return;
    if (!this.inRep && a > this.maxAngle * ON_FRAC) {
      this.inRep = true;
      this.repStart = t;
      this.repPeak = a;
    } else if (this.inRep) {
      this.repPeak = Math.max(this.repPeak, a);
      if (a < this.maxAngle * OFF_FRAC) {
        this.inRep = false;
        if (t - this.repStart >= MIN_REP_S * 1000) {
          this.reps++;
          this.roms.push(round1(this.repPeak));
        }
      }
    }
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10;
