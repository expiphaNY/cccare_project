// Raw EMG → rectified → envelope, shared by the live recorder (sample by
// sample) and the save route (whole set), so what you see live is what gets
// saved. Pure functions: safe on the client and the server.

/** Standard surface-EMG high-pass: removes movement artefact and drift. */
export const EMG_HIGHPASS_HZ = 20;
/** Envelope smoothing: two cascaded one-pole low-passes (same as deriveChannels). */
export const EMG_ENVELOPE_HZ = 3.5;

/** Second-order Butterworth high-pass (RBJ biquad), direct form I. */
class HighPass {
  private b0: number;
  private b1: number;
  private b2: number;
  private a1: number;
  private a2: number;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(fs: number, hz: number) {
    const w0 = (2 * Math.PI * Math.min(hz, fs * 0.45)) / fs;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
    const a0 = 1 + alpha;
    this.b0 = (1 + cos) / 2 / a0;
    this.b1 = -(1 + cos) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  step(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/**
 * Streaming version for live data. The first `push` batch sets the DC level
 * (MyoWare RAW sits at mid-supply) and the starting envelope level, so there is
 * no step or slow ramp-up at the start.
 */
export class EmgEnvelopeFilter {
  private hp: HighPass | null;
  private a: number;
  private dc = NaN;
  private e1 = NaN;
  private e2 = NaN;
  constructor(fs: number, highpassHz: number | null = EMG_HIGHPASS_HZ) {
    this.hp = highpassHz ? new HighPass(fs, highpassHz) : null;
    this.a = Math.exp((-2 * Math.PI * EMG_ENVELOPE_HZ) / fs);
  }
  /** Filters the next batch of samples (oldest first); returns parallel arrays. */
  push(raw: ArrayLike<number>) {
    const n = raw.length;
    const filtered = new Float32Array(n);
    const rectified = new Float32Array(n);
    const envelope = new Float32Array(n);
    if (!n) return { filtered, rectified, envelope };
    if (Number.isNaN(this.dc)) {
      let s = 0;
      for (let i = 0; i < n; i++) s += raw[i];
      this.dc = s / n;
    }
    for (let i = 0; i < n; i++) {
      const x = raw[i] - this.dc;
      const y = this.hp ? this.hp.step(x) : x;
      filtered[i] = y;
      rectified[i] = Math.abs(y);
    }
    if (Number.isNaN(this.e1)) {
      let s = 0;
      for (let i = 0; i < n; i++) s += rectified[i];
      this.e1 = this.e2 = s / n;
    }
    const a = this.a;
    for (let i = 0; i < n; i++) {
      this.e1 = a * this.e1 + (1 - a) * rectified[i];
      this.e2 = a * this.e2 + (1 - a) * this.e1;
      envelope[i] = this.e2;
    }
    return { filtered, rectified, envelope };
  }
}

/**
 * Whole-set version. DC is the set mean; the envelope starts at the mean
 * rectified level of the first 100 ms instead of ramping up from zero.
 */
export function envelopeFromRaw(raw: ArrayLike<number>, fs: number, highpassHz: number | null = EMG_HIGHPASS_HZ) {
  const n = raw.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += raw[i];
  mean = n ? mean / n : 0;
  const centred = new Float32Array(n);
  for (let i = 0; i < n; i++) centred[i] = raw[i] - mean;
  const head = Math.max(1, Math.min(n, Math.round(fs * 0.1)));
  const hp = highpassHz ? new HighPass(fs, highpassHz) : null;
  const filtered = new Float32Array(n);
  const rectified = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    filtered[i] = hp ? hp.step(centred[i]) : centred[i];
    rectified[i] = Math.abs(filtered[i]);
  }
  let e = 0;
  for (let i = 0; i < head; i++) e += rectified[i];
  let e1 = e / head;
  let e2 = e1;
  const a = Math.exp((-2 * Math.PI * EMG_ENVELOPE_HZ) / fs);
  const envelope = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    e1 = a * e1 + (1 - a) * rectified[i];
    e2 = a * e2 + (1 - a) * e1;
    envelope[i] = e2;
  }
  return { filtered, rectified, envelope };
}
