// Domain model. Every collection below maps 1:1 to a MongoDB collection
// (see src/lib/store/mongo.ts). Dates are ISO-8601 strings in UTC.

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
}

/** How numbers from the board map to millivolts at the electrodes. */
export type ValueScale = "adc12" | "volts" | "electrode-mv";

export const VALUE_SCALES: Record<ValueScale, { label: string; toBoardMv: (v: number) => number; removeGain: boolean }> = {
  adc12: { label: "12-bit ADC counts (0–4095, 3.3 V) — MyoWare stock firmware", toBoardMv: (v) => (v * 3300) / 4095, removeGain: true },
  volts: { label: "Volts at the board output", toBoardMv: (v) => v * 1000, removeGain: true },
  "electrode-mv": { label: "Millivolts at the electrodes (firmware calls setConvertOutput(true))", toBoardMv: (v) => v, removeGain: false },
};

/**
 * MyoWare 2.0 amplifier gain, as in the MyoWare Arduino Library:
 * envelope = 200 × (1 + gain-knob kΩ); raw and rectified = 200.
 * Library default knob setting is 50 kΩ → envelope gain 10 200.
 */
export function myowareGain(stream: ChannelKey, gainKnobK: number) {
  return stream === "envelope" ? 200 * (1 + Math.max(0, gainKnobK)) : 200;
}

/** Accelerometer samples in g, aligned with the EMG samples. */
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
  | "profile_deleted";

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
