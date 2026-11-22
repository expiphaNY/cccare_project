// =============================================================================
// types.ts : THE DATA MODEL
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Every kind of record the app stores, as TypeScript types: patients, sessions, recordings, metrics,
//   rep checks, shakiness, share links, the access log and the assistant's drafts. Each collection maps
//   one to one to a MongoDB collection (see lib/store/mongo.ts). Dates are ISO-8601 text in UTC.
//   It also holds the small conversions between the board's numbers and millivolts, and the exercise list.
// =============================================================================

/** "patient" only appears in audit entries written before the app became clinician-only. */
export type Role = "clinician" | "patient" | "recipient" | "device" | "system";

export interface Actor {
  role: Role;
  name: string;
  id?: string;
}

export interface Clinician {
  id: string;
  name: string;
  title: string;
  clinic: string;
}

export interface Consent {
  /** Required to use the service at all: data is used for your own care. */
  clinicalCare: true;
  /** Clinicians in the same clinic (not only the assigned one) may view. */
  careTeamAccess: boolean;
  /** Patient may create share links themselves. */
  patientSharing: boolean;
  /** De-identified data may be used for research. Off by default. */
  researchDeidentified: boolean;
  updatedAt: string;
}

export interface DeviceInfo {
  id: string;
  model: string;
  firmware: string;
  sampleRateHz: number;
  channels: ChannelKey[];
}

export type Side = "left" | "right" | "bilateral";
export type Sex = "female" | "male" | "other";

export interface Patient {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  dob: string; // YYYY-MM-DD
  sex: Sex;
  condition: string;
  affectedSide: Side;
  exercises: ExerciseKey[];
  clinicianId: string;
  goal: string;
  createdAt: string;
  consent: Consent;
  device: DeviceInfo;
  /** Where data physically lives. Shown verbatim to the patient. */
  storageRegion: string;
  retentionPolicy: string;
  /** Working weight the clinician has prescribed; the recorder starts each set at this load. */
  prescribedLoad?: Load;
}

/* ---------- loads (weights) ---------- */

export type WeightUnit = "kg" | "lb";
export const LB_PER_KG = 2.20462;

/** External load for a set. value 0 = no added weight (arm/bodyweight only). */
export interface Load {
  value: number;
  unit: WeightUnit;
  /** Same load in kg, for comparing across units. */
  kg: number;
}

export function makeLoad(value: number, unit: WeightUnit): Load {
  const v = Math.max(0, Math.round(value * 100) / 100);
  return { value: v, unit, kg: Math.round((unit === "kg" ? v : v / LB_PER_KG) * 100) / 100 };
}

export function fmtLoad(l?: Load | null) {
  if (!l) return "—";
  return l.value === 0 ? "No weight" : `${l.value} ${l.unit}`;
}

/** Clinic-wide list of weights the recorder offers (MongoDB: settings/_id "weights"). */
export interface WeightSettings {
  unit: WeightUnit;
  /** Available weights in `unit`, ascending. 0 = no added weight. */
  options: number[];
  updatedAt: string;
  updatedBy?: string;
}

export const DEFAULT_WEIGHTS: WeightSettings = {
  unit: "kg",
  options: [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20],
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/**
 * Fills in whatever an older saved weight setting lacks. Settings saved before the clinic
 * list existed hold only a unit, so without this the recorder would find no weight choices.
 */
export function withWeightDefaults(w?: Partial<WeightSettings> | null): WeightSettings {
  const options = Array.isArray(w?.options) ? w.options.filter((x) => Number.isFinite(x)) : [];
  return {
    ...DEFAULT_WEIGHTS,
    ...w,
    unit: w?.unit === "lb" ? "lb" : "kg",
    options: options.length ? options : DEFAULT_WEIGHTS.options,
  };
}

export interface Session {
  id: string;
  patientId: string;
  startedAt: string;
  location: "clinic" | "home";
  clinicianId?: string;
  notes?: string;
  /** Patient-reported pain 0–10 before the session. */
  painScore?: number;
}

export type ChannelKey = "raw" | "rectified" | "envelope";

export const CHANNELS: Record<
  ChannelKey,
  { label: string; plain: string; clinical: string }
> = {
  envelope: {
    label: "Envelope",
    plain: "A smooth line showing how hard your muscle is working.",
    clinical: "Rectified signal low-pass filtered (~3.5 Hz). Amplitude proxy for activation.",
  },
  rectified: {
    label: "Rectified",
    plain: "The raw signal flipped so every value is positive.",
    clinical: "Full-wave rectified raw EMG (|x|).",
  },
  raw: {
    label: "Raw EMG",
    plain: "The original electrical signal from your muscle, straight from the sensor.",
    clinical: "Band-limited surface EMG, sampled at device rate. Bipolar electrode pair.",
  },
};

export type ExerciseKey = "bicep-curl";

export const EXERCISES: Record<ExerciseKey, { name: string; muscle: string }> = {
  "bicep-curl": { name: "Bicep curl", muscle: "Biceps brachii" },
};

export interface Metrics {
  /** Highest envelope value in the set (mV). Headline "activation" number. */
  peakEnvelope: number;
  /** Mean envelope across active (contracting) samples (mV). */
  meanEnvelope: number;
  /** Root-mean-square of raw EMG across active samples (mV). */
  rms: number;
  /** Integrated EMG: area under rectified curve while active (mV·s). */
  iemg: number;
  /** Median power frequency of raw EMG (Hz). Falls with fatigue. */
  medianFreqHz: number;
  /** Change in rep peak, last reps vs first reps (%). Negative = fatigue. */
  fatigueIndex: number;
  activeTimeS: number;
  repsDetected: number;
  repPeaks: number[];
  repMedianFreq: number[];
}

export interface Recording {
  id: string;
  patientId: string;
  sessionId: string;
  exercise: ExerciseKey;
  muscle: string;
  side: Side;
  setNumber: number;
  targetReps: number;
  recordedAt: string;
  durationS: number;
  sampleRateHz: number;
  units: "mV";
  deviceId: string;
  metrics: Metrics;
  /**
   * How the signal was produced. "synthetic" = mock generator (seeded),
   * "device" = uploaded by the microcontroller (/api/ingest),
   * "ble" = streamed live to the browser over Web Bluetooth (/api/record).
   */
  source: "device" | "synthetic" | "ble";
  /**
   * Channels the sensor actually measured. Missing = all three. A MyoWare
   * Wireless Shield on stock firmware streams one output (usually the
   * envelope), so raw-only metrics (RMS, median frequency) are not available.
   */
  channels?: ChannelKey[];
  /** True when accelerometer x/y/z were captured alongside the EMG. */
  hasMotion?: boolean;
  /** Present for live (Web Bluetooth) recordings. */
  capture?: LiveCapture;
  /** Present for synthetic recordings: signal is regenerated deterministically. */
  synth?: SynthParams;
  /** Weight lifted in this set. Missing = not recorded. */
  load?: Load;
  /** EMG vs accelerometer rep cross-check, computed when the set was saved. */
  repCheck?: RepCheck;
  /** Shakiness (3–12 Hz tremor) from the accelerometer, computed when the set was saved. */
  tremor?: TremorMetrics;
}

/** Accelerometer tremor ("shakiness") for one set. Accelerations in milli-g RMS, 3–12 Hz. */
export interface TremorMetrics {
  level: "low" | "mild" | "moderate" | "marked";
  /** The number the level is based on: hold (postural) tremor when available. */
  headlineMg: number;
  headlineFrom: "hold" | "whole set";
  rmsMg: number;
  /** Arm held still at the top of the curl, under load (postural tremor). */
  holdRmsMg: number | null;
  /** While the arm moves. Includes some of the curl itself, so it reads higher than true tremor. */
  movingRmsMg: number | null;
  /** Arm relaxed at the bottom (rest tremor). */
  restRmsMg: number | null;
  /** Along the curl's rotation axis: shake not mixed with the curl itself. */
  offAxisRmsMg: number;
  offAxisSharePct: number;
  /** Dominant tremor frequency (Hz). */
  peakHz: number | null;
  /** Share of band power within ±1 Hz of the peak. High = rhythmic tremor, low = noise/jerkiness. */
  rhythmicityPct: number;
  rhythmic: boolean;
  /** Hold (top-of-curl) tremor RMS for each rep that had a hold. */
  perRepMg: number[];
  /** Last reps vs first reps (%). Positive = shakier as the set went on. */
  fatigueChangePct: number | null;
  glitchesRemoved: number;
  /** How often the sensor actually sent new values; needs ≥ 24 Hz to resolve 12 Hz. */
  effectiveHz: number;
  reliable: boolean;
  band: [number, number];
}

/** Result of cross-checking EMG reps against accelerometer reps for one set. */
export interface RepCheck {
  status: "verified" | "partial" | "mismatch" | "no-motion";
  emgReps: number;
  motionReps: number;
  /** Reps both sensors agree on. */
  verifiedReps: number;
  /** 2·verified / (emg + motion), 0–1. */
  agreement: number;
  /** Mean EMG onset minus movement onset over verified reps (ms). */
  meanLagMs: number | null;
  /** Mean range of motion (degrees of arm rotation) per movement rep. */
  meanRomDeg: number | null;
  reps: { start: number; end: number; source: "both" | "emg" | "motion"; emgPeak?: number; romDeg?: number; lagMs?: number }[];
  /** How the accelerometer was cleaned, so the result can be reproduced. */
  filter: { despike: string; lowpassHz: number; method: string };
}

export interface LiveCapture {
  transport: "web-bluetooth" | "web-serial" | "bridge" | "demo";
  /** Name the board advertised, e.g. "MyoWareSensor1". */
  deviceName: string;
  /** Average notification rate the browser actually received. */
  observedRateHz: number;
  /** Values received before resampling to sampleRateHz. */
  samplesReceived: number;
  /** How the device values were converted to mV. */
  scale: ValueScale;
  /** Amplifier gain divided out to get electrode-level mV (1 = none). */
  gain: number;
  /** Share (0–100) of envelope readings at the sensor's maximum; peaks above it were cut off. */
  clippedPct?: number;
  /** True when raw EMG was streamed; rectified and envelope were then derived from it. */
  rawStreamed?: boolean;
  /** High-pass applied to the raw channel before rectifying (Hz). */
  highpassHz?: number;
}

/**
 * HOW THE NUMBERS FROM THE BOARD BECOME MILLIVOLTS AT THE ELECTRODES
 * The stock sensor sends 12-bit counts (0 to 4095 for 0 to 3.3 volts). The website
 * converts them to millivolts at the board, and then divides by the sensor's
 * amplification (the "gain") to get back to millivolts at the skin. Some boards send
 * volts, or already convert to millivolts themselves, so the choices are listed here.
 */
export type ValueScale = "adc12" | "volts" | "electrode-mv";

export const VALUE_SCALES: Record<ValueScale, { label: string; toBoardMv: (v: number) => number; removeGain: boolean }> = {
  adc12: { label: "12-bit ADC counts (0–4095, 3.3 V) — MyoWare stock firmware", toBoardMv: (v) => (v * 3300) / 4095, removeGain: true },
  volts: { label: "Volts at the board output", toBoardMv: (v) => v * 1000, removeGain: true },
  "electrode-mv": { label: "Millivolts at the electrodes (firmware calls setConvertOutput(true))", toBoardMv: (v) => v, removeGain: false },
};

/**
 * MyoWare 2.0 amplifier gain, as in the MyoWare Arduino Library:
 * envelope = 200 × (1 + gain-knob kΩ); raw and rectified = 200.
 * The library's default knob setting is 50 kΩ, which gives an envelope gain of 10 200.
 */
export function myowareGain(stream: ChannelKey, gainKnobK: number) {
  return stream === "envelope" ? 200 * (1 + Math.max(0, gainKnobK)) : 200;
}

/** Accelerometer samples in g, exactly as the chip reported them, aligned with the EMG samples. */
export interface MotionData {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

export interface SynthParams {
  seed: number;
  amplitude: number;
  reps: number;
  fatigue: number;
  spectralFatigue: number;
  /** Synthetic tremor at hold, milli-g RMS (accelerometer simulation). */
  tremorMg?: number;
  /** Synthetic tremor frequency, Hz. */
  tremorHz?: number;
}

export interface SignalData {
  recordingId: string;
  sampleRateHz: number;
  raw: Float32Array;
  rectified: Float32Array;
  envelope: Float32Array;
  /** Optional accelerometer channels (g). */
  motion?: MotionData;
}

/** Channels a recording measured (defaults to all three). */
export function measuredChannels(r: Pick<Recording, "channels">): ChannelKey[] {
  return r.channels ?? ["raw", "rectified", "envelope"];
}

export interface Share {
  token: string;
  patientId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  createdBy: Actor;
  recipient: string;
  purpose: string;
  scope: "full" | "sessions";
  sessionIds?: string[];
  includeRaw: boolean;
  accessCount: number;
  lastAccessedAt?: string;
}

export type AuditAction =
  | "profile_created"
  | "profile_viewed"
  | "session_viewed"
  | "signal_viewed"
  | "comparison_viewed"
  | "export_pdf"
  | "export_html"
  | "export_fhir"
  | "export_csv"
  | "share_created"
  | "share_revoked"
  | "share_opened"
  | "consent_updated"
  | "data_recorded"
  | "note_added"
  | "note_edited"
  | "note_deleted"
  | "profile_deleted"
  | "suggestion_drafted"
  | "suggestion_approved"
  | "suggestion_rejected"
  | "load_prescribed"
  | "settings_updated";

export interface AuditEvent {
  id: string;
  patientId: string;
  at: string;
  actor: Actor;
  action: AuditAction;
  detail: string;
}

/** Kept after a profile is deleted. Contains no health data, only proof. */
export interface DeletionReceipt {
  id: string;
  patientRef: string; // SHA-256 of patient id: proves deletion without identifying
  deletedAt: string;
  deletedBy: Actor;
  counts: { sessions: number; recordings: number; shares: number; auditEvents: number };
}

export type SuggestionStatus = "pending" | "approved" | "rejected";

/**
 * A draft written by the clinician's assistant. Nothing changes until the
 * clinician approves it: a "note" is then appended to the session's notes, a
 * "load" change becomes the patient's prescribed working weight.
 */
export interface Suggestion {
  /** Missing on drafts made before drafts had kinds (treated as "general"). */
  kind?: "note" | "load" | "general";
  /** For kind "load": the weight to prescribe. */
  proposedLoad?: Load;
  id: string;
  patientId: string;
  createdAt: string;
  /** Who was using the assistant when it was drafted. */
  requestedBy: Actor;
  title: string;
  body: string;
  /** Data the assistant based the draft on. */
  rationale: string;
  sessionId?: string;
  status: SuggestionStatus;
  reviewedAt?: string;
  reviewedBy?: Actor;
  /** Optional reviewer comment. */
  reviewNote?: string;
}
