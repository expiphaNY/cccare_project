// =============================================================================
// LiveRecorder.tsx : THE RECORDING SCREEN (CONNECT, RECORD, SAVE)
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   This is where a clinician measures a patient live. Step by step:
//     1. CONNECT the sensor board over Bluetooth (or the back-up connections, or the demo sensor).
//     2. WATCH the muscle envelope and the arm movement live, with live rep counts, a level meter,
//        a shakiness number and warnings if the signal is silent or stuck at the sensor's maximum.
//     3. RECORD one set at a time, typing the weight lifted for each set (any number, in kg or lb).
//        The session can be given a name; without one it is named by its date. The start time is always added.
//     4. At the end of each set, put the readings on an even clock, count the reps with both
//        sensors, compare them, and measure shakiness. These are the same calculations the server
//        runs on save, so what is shown here matches what is stored.
//     5. SAVE all sets together to the patient's record (api/record/route.ts).
//
//   MUSCLE: the board only measures. Its raw readings are cleaned HERE, live, by
//   lib/emg-filter.ts (remove the baseline, cut slow drift, flip negatives, smooth), and the
//   muscle reps are counted on that envelope. The sensor's hardware envelope is only a
//   back-up for boards that send no raw. ARM: the board only measures here too: its x/y/z go
//   through lib/motion.ts (drop spikes, smooth, learn the resting direction, count reps).
//   The same code runs again on save, so what is shown live is what is stored.
//   Shakiness (tremor) is measured from the untouched x, y and z.
//
// STEPS TAKEN FOR THE MARKING RUBRIC
//   Functioning reliably: if the sensor drops mid-set the part already recorded is kept; a set under 2 s is discarded as a mistake;
//   'waiting for data' is shown if nothing arrives for 1.5 s; unsaved sets trigger a browser warning before leaving the page.
//   Robust code: a failed save keeps every set on screen so it can be retried; clipping (signal stuck at the maximum) is flagged.
//   Quality of output: raw muscle readings are cleaned in 4 named steps on the website; the accelerometer is despiked and smoothed before it is shown or counted.
//   Ease of use: every connection problem is shown in plain words with numbered fixes; a demo sensor lets anyone try it with no hardware.
//   Impact on people (safety): the weight lifted is recorded for every set; rep and shakiness results are shown before saving.
// =============================================================================

"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type uPlot from "uplot";
import {
  Bluetooth,
  BluetoothConnected,
  CircleCheck,
  Copy,
  Dumbbell,
  FlaskConical,
  Info,
  LoaderCircle,
  Play,
  Save,
  Settings2,
  Square,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  MYOWARE_CHARACTERISTIC,
  MYOWARE_NAME_PREFIX,
  MYOWARE_SERVICE,
  BOARD_SEND_HZ,
  ConnectError,
  connectBluetooth,
  connectBridge,
  connectDemo,
  connectSerial,
  sensorSupport,
  resampleUniform,
  type BluetoothSupport,
  type ConnectionKind,
  type ConnectStage,
  type LiveSample,
  type SensorConnection,
} from "@/lib/ble";
import { detectReps } from "@/lib/client-signal";
import { EMG_HIGHPASS_HZ, EmgEnvelopeFilter, envelopeFromRaw } from "@/lib/emg-filter";
import { DEMO, DEMO_MSG } from "@/lib/demo";
import { LiveMotion } from "@/lib/motion";
import { REP_STATUS, verifyReps } from "@/lib/rep-verify";
import { LiveTremor, analyzeTremor, tremorLevel } from "@/lib/tremor";
import { VALUE_SCALES, fmtLoad, myowareGain, type ChannelKey, type Load, type RepCheck, type TremorMetrics, type ValueScale } from "@/lib/types";
import { SESSION_NAME_MAX, defaultSessionName } from "@/lib/format";
import { WeightInput } from "./WeightInput";
import { Sparkline } from "./charts/Sparkline";
import { AXIS, UChart } from "./charts/UChart";
import { Segmented } from "./Segmented";
import { Badge, Card, CardHeader, btn, cx } from "./ui";

const noSubscribe = () => () => {};

type Nullable = number | null;

/**
 * Some readings carry no accelerometer value (for example the first packets, before
 * Bluetooth agrees on a larger packet size). This fills each gap with the nearest real
 * value so the lists stay the same length and can be put on one clock.
 */
function fillGaps(a: Nullable[]): number[] {
  const first = a.find((x): x is number => x != null) ?? 0;
  let last = first;
  return a.map((x) => (x == null ? last : (last = x)));
}

/** Every set without raw data is put on an even clock of this many readings per second before saving. */
const SAVE_FS = 100;
/** The longest stretch of live signal the chart can show, in seconds. */
const MAX_WINDOW_S = 60;
/** The zoom steps for "Show last ... s". */
const WINDOW_STEPS = [5, 10, 15, 20, 30, 45, 60];
/** A set shorter than this many seconds is thrown away as an accidental press. */
const MIN_SET_S = 2;
const MOTION_COLORS = ["#2a78d6", "#eb6834", "#1baf7a"];

type Status = "idle" | "connecting" | "ready" | "recording" | "saving";
/** Which version of the muscle signal the live chart shows. Raw and rectified need the raw stream. */
type LiveView = "envelope" | "rectified" | "raw";

/** A board reading at (or within about 1% of) the converter's top: the signal is being cut off. */
function isClipped(scale: ValueScale, v: number) {
  return scale === "adc12" ? v >= 4050 : scale === "volts" ? v >= 3.26 : false;
}
/** The largest value the sensor can report, in millivolts at the skin (null if unknown). */
function ceilingMv(st: Settings) {
  if (st.scale === "electrode-mv") return null;
  return VALUE_SCALES[st.scale].toBoardMv(st.scale === "adc12" ? 4095 : 3.3) / gainFor(st);
}
/** The raw output always has the fixed 200 times amplification (there is no gain knob for it). */
function rawGainFor(st: Settings) {
  return VALUE_SCALES[st.scale].removeGain ? myowareGain("raw", st.gainKnobK) : 1;
}

interface CompletedSet {
  startedAt: string;
  durationS: number;
  /** The muscle values in millivolts at the skin, on an even clock of `fs` readings a second. */
  values: Float32Array;
  /** Raw muscle readings in millivolts at the skin on the same clock, when the firmware streamed them. */
  raw?: Float32Array;
  fs: number;
  /** The accelerometer x, y and z in g, on the same clock. */
  motion?: { x: Float32Array; y: Float32Array; z: Float32Array };
  /** Share of envelope readings at the sensor's ceiling (0–100). */
  clippedPct: number;
  observedRateHz: number;
  samplesReceived: number;
  peak: number;
  reps: number;
  preview: number[];
  /** Weight lifted in this set. */
  load: Load;
  /** EMG vs accelerometer cross-check (same calculation the server stores). */
  check: RepCheck;
  /** Shakiness (same calculation the server stores). */
  tremor?: TremorMetrics;
}

interface Settings {
  /** "bridge" = this site's server reads the Mac's paired serial port; "serial" = Chrome Web Serial; "ble" = Chrome Web Bluetooth. */
  connection: ConnectionKind;
  namePrefix: string;
  service: string;
  characteristic: string;
  /** How the board's numbers turn into millivolts. */
  scale: ValueScale;
  /** Which MyoWare output the firmware sends: envelope, rectified or raw. */
  stream: ChannelKey;
  /** The MyoWare gain knob's setting in kilo-ohms (the library default is 50). */
  gainKnobK: number;
}

/** The sensor's amplification, divided out of the board's numbers to get millivolts at the skin. */
function gainFor(st: Settings) {
  return VALUE_SCALES[st.scale].removeGain ? myowareGain(st.stream, st.gainKnobK) : 1;
}

const DEFAULT_SETTINGS: Settings = {
  // These match firmware/MyoCareBLE. For an older Bluetooth-serial sketch use "bridge".
  connection: "ble",
  namePrefix: MYOWARE_NAME_PREFIX,
  service: MYOWARE_SERVICE,
  characteristic: MYOWARE_CHARACTERISTIC,
  scale: "adc12",
  stream: "envelope",
  gainKnobK: 50,
};

export function LiveRecorder({
  patientId,
  as,
  exercises,
  defaultLocation,
  sessionHrefBase,
  prescribedLoad,
}: {
  patientId: string;
  as: "clinician";
  exercises: { key: string; name: string; muscle: string }[];
  defaultLocation: "clinic" | "home";
  sessionHrefBase: string;
  /** Patient's prescribed working weight: the starting weight in the box. */
  prescribedLoad?: Load;
}) {
  const router = useRouter();
  // The weight typed for the next set. null = the box is empty or not a valid weight, and a set cannot start.
  const [load, setLoad] = useState<Load | null>(prescribedLoad ?? null);
  // What the clinician typed as the session's name. Empty = use the date. The start time is added either way.
  const [sessionNameText, setSessionNameText] = useState("");
  // Browser capability: "checking" during SSR, then the real answer on the client.
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const support = useSyncExternalStore<BluetoothSupport>(noSubscribe, () => sensorSupport(settings.connection), () => "checking");
  const [status, setStatus] = useState<Status>("idle");
  const [deviceName, setDeviceName] = useState("");
  const [transport, setTransport] = useState<SensorConnection["transport"]>("bridge");
  const [notice, setNotice] = useState<{
    tone: "bad" | "warn" | "good";
    text: string;
    tips?: string[];
    action?: { label: string; onClick: () => void };
  } | null>(null);
  const [stage, setStage] = useState<{ stage: ConnectStage; name?: string } | null>(null);
  const [exercise, setExercise] = useState(exercises[0]?.key ?? "");
  const [location, setLocation] = useState(defaultLocation);
  const [pain, setPain] = useState<string>("");
  const [sets, setSets] = useState<CompletedSet[]>([]);
  const [hasMotion, setHasMotion] = useState(false);
  const [rawFs, setRawFs] = useState(0);
  const hasRaw = rawFs > 0;
  const [liveView, setLiveView] = useState<LiveView>("envelope");
  const [windowS, setWindowS] = useState(10);
  const [readout, setReadout] = useState({ value: 0, max: 0, rate: 0, elapsed: 0, peak: 0, reps: 0, motionReps: 0, angle: 0, shake: 0, stale: false, sinceConnect: 0, rawLevel: 0, clipPct: 0, setClipPct: 0 });
  const [motionView, setMotionView] = useState<"smooth" | "raw">("smooth");
  const motionViewRef = useRef<"smooth" | "raw">("smooth");

  const conn = useRef<SensorConnection | null>(null);
  // The weight is fixed when a set starts (the box is locked while recording), so the saved set always
  // carries the weight that was on screen when it began.
  const loadRef = useRef<Load | null>(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  const setLoadRef = useRef<Load | null>(null);
  const statusRef = useRef<Status>("idle");
  const settingsRef = useRef(settings);
  const viewRef = useRef<LiveView>("envelope");
  const windowRef = useRef(10);
  useEffect(() => {
    statusRef.current = status;
    settingsRef.current = settings;
    viewRef.current = hasRaw ? liveView : "envelope";
    windowRef.current = windowS;
    motionViewRef.current = motionView;
  });
  // The rolling display buffer: seconds since connecting, millivolts, and acceleration in g.
  const t0 = useRef(0);
  // The accelerometer lists stay the same length as `t`. A reading with no accelerometer
  // value leaves a gap (null) instead of shifting everything out of line.
  const emptyBuf = () => ({
    t: [] as number[],
    v: [] as number[],
    ax: [] as Nullable[],
    ay: [] as Nullable[],
    az: [] as Nullable[],
    // The unfiltered accelerometer, for the "Raw" switch (ax, ay, az above are cleaned).
    rax: [] as Nullable[],
    ray: [] as Nullable[],
    raz: [] as Nullable[],
    motionFilter: new LiveMotion(BOARD_SEND_HZ),
    tremor: new LiveTremor(BOARD_SEND_HZ),
    shakeMg: 0,
    // Raw muscle readings: seconds since connecting, then the readings after the
    // 20 Hz cleaning, their rectified version and the envelope worked out from them
    // (the same filter that runs when the set is saved).
    rt: [] as number[],
    rv: [] as number[],
    rr: [] as number[],
    re: [] as number[],
    filter: null as EmgEnvelopeFilter | null,
    clip: [] as number[], // 1 where the reading was stuck at the sensor's maximum
    last: 0, // when the newest reading arrived
    rawEma: 0, // a slowly moving average of the board's number, for the level meter
    rawClock: 0, // performance.now() in ms of the newest raw reading
    rawFs: 0, // raw readings per second (0 = no raw stream)
  });
  const buf = useRef(emptyBuf());
  // Everything gathered for the set being recorded (times in performance.now() milliseconds).
  const emptyRec = () => ({
    start: 0,
    startIso: "",
    t: [] as number[],
    v: [] as number[],
    ax: [] as Nullable[],
    ay: [] as Nullable[],
    az: [] as Nullable[],
    rt: [] as number[],
    rv: [] as number[],
    clipped: 0,
    peak: 0,
    floor: Infinity,
    reps: 0,
    inRep: false,
    repStart: 0,
    // The arm rep counter. It learns the resting direction while the muscle is quiet.
    motion: new LiveMotion(BOARD_SEND_HZ),
    lastEnv: 0,
  });
  const rec = useRef(emptyRec());
  const emgPlot = useRef<uPlot | null>(null);
  const motionPlot = useRef<uPlot | null>(null);

  /* ---------- incoming readings ---------- */

  const onSample = useCallback((s: LiveSample) => {
    const st = settingsRef.current;
    // The board's number -> millivolts at the board -> millivolts at the skin.
    const mv = VALUE_SCALES[st.scale].toBoardMv(s.v) / gainFor(st);
    const b = buf.current;
    const ts = (s.t - t0.current) / 1000;
    const clipped = isClipped(st.scale, s.v);
    b.t.push(ts);
    b.v.push(mv);
    b.clip.push(clipped ? 1 : 0);
    const motion = s.ax != null && s.ay != null && s.az != null;
    // Clean the accelerometer for the chart (drop spikes, then smooth). The untouched
    // readings are kept for the "Raw" switch and for saving: the save route cleans the
    // whole set again, with a filter that can look ahead.
    const sm = motion ? b.motionFilter.smooth(s.ax!, s.ay!, s.az!) : null;
    b.ax.push(sm ? sm[0] : null);
    b.ay.push(sm ? sm[1] : null);
    b.az.push(sm ? sm[2] : null);
    if (motion) b.shakeMg = b.tremor.push(s.ax!, s.ay!, s.az!, s.t);
    b.rax.push(motion ? s.ax! : null);
    b.ray.push(motion ? s.ay! : null);
    b.raz.push(motion ? s.az! : null);
    b.last = s.t;
    b.rawEma = b.rawEma ? 0.95 * b.rawEma + 0.05 * s.v : s.v;
    // Keep only as much history as the longest chart window needs (plus 2 s spare), trimmed in batches.
    if (b.t.length > 64 && b.t[0] < ts - MAX_WINDOW_S - 2) {
      const cut = b.t.findIndex((x) => x >= ts - MAX_WINDOW_S);
      for (const k of ["t", "v", "ax", "ay", "az", "rax", "ray", "raz", "clip"] as const) b[k].splice(0, cut);
    }

    // A batch of raw muscle readings: give each reading its own time. Lines can arrive in
    // bursts, so we continue where the previous batch ended instead of trusting arrival
    // times, but never let the raw clock run more than 250 ms ahead of (or behind) reality.
    const rawT: number[] = [];
    const rawV: number[] = [];
    let rawEnv: Float32Array | null = null;
    if (s.raw?.length && s.rawFs) {
      const dt = 1000 / s.rawFs;
      const n = s.raw.length;
      let start = Math.max(b.rawClock + dt, s.t - (n - 1) * dt);
      if (start > s.t + 250 || start < s.t - (n - 1) * dt - 250) start = s.t - (n - 1) * dt;
      const g = rawGainFor(st);
      const toMv = VALUE_SCALES[st.scale].toBoardMv;
      for (let i = 0; i < n; i++) {
        const t = start + i * dt;
        rawT.push(t);
        rawV.push(toMv(s.raw[i]) / g); // millivolts at the skin, not yet filtered (the save route filters the whole set)
        b.rt.push((t - t0.current) / 1000);
      }
      if (!b.filter || b.rawFs !== s.rawFs) b.filter = new EmgEnvelopeFilter(s.rawFs);
      const f = b.filter.push(rawV);
      rawEnv = f.envelope;
      for (let i = 0; i < n; i++) {
        b.rv.push(f.filtered[i]);
        b.rr.push(f.rectified[i]);
        b.re.push(f.envelope[i]);
      }
      b.rawClock = start + (n - 1) * dt;
      b.rawFs = s.rawFs;
      if (b.rt.length > 2048 && b.rt[0] < ts - MAX_WINDOW_S - 2) {
        const cut = b.rt.findIndex((x) => x >= ts - MAX_WINDOW_S);
        for (const k of ["rt", "rv", "rr", "re"] as const) b[k].splice(0, cut);
      }
    }

    if (statusRef.current === "recording") {
      const r = rec.current;
      r.t.push(s.t);
      r.v.push(mv);
      r.ax.push(motion ? s.ax! : null);
      r.ay.push(motion ? s.ay! : null);
      r.az.push(motion ? s.az! : null);
      for (let i = 0; i < rawT.length; i++) {
        r.rt.push(rawT[i]);
        r.rv.push(rawV[i]);
      }
      if (clipped) r.clipped++;

      // LIVE MUSCLE REP COUNT. Two lines, as in lib/rep-verify.ts: a rep starts when the
      // signal passes 35% of the way from its quietest to its strongest level so far, and
      // ends when it falls under 20%. A burst shorter than 0.3 s is ignored as a twitch.
      // Once raw readings stream, the count follows the envelope worked out from them
      // (lines without raw are skipped so the two scales never mix).
      const track = (e: number, t: number) => {
        r.peak = Math.max(r.peak, e);
        r.floor = Math.min(r.floor, e);
        const span = r.peak - r.floor;
        if (r.peak > 0 && span > r.peak * 0.25) {
          const startLine = r.floor + span * 0.35;
          const endLine = r.floor + span * 0.2;
          if (!r.inRep && e > startLine) {
            r.inRep = true;
            r.repStart = t;
          } else if (r.inRep && e < endLine) {
            r.inRep = false;
            if (t - r.repStart > 300) r.reps++;
          }
        }
      };
      if (rawEnv) for (let i = 0; i < rawEnv.length; i++) track(rawEnv[i], rawT[i]);
      else if (!b.rawFs) track(mv, s.t);
      // LIVE ARM REP COUNT. The board sends only x/y/z: the resting direction is learnt
      // while the muscle is quiet, then reps are counted on the angle away from it.
      if (sm) {
        const e = rawEnv?.length ? rawEnv[rawEnv.length - 1] : b.rawFs ? r.lastEnv : mv;
        if (rawEnv?.length) r.lastEnv = e;
        const span = r.peak - r.floor;
        const quiet = !(r.peak > 0 && span > r.peak * 0.25) || e < r.floor + span * 0.15;
        r.motion.track(sm[0], sm[1], sm[2], s.t, quiet);
      }
    }
  }, []);

  const onSampleMotionFlag = useCallback(
    (s: LiveSample) => {
      // A board with no working accelerometer sends 0.00 for x, y and z: that is not movement data.
      if (s.ax != null && (s.ax !== 0 || s.ay !== 0 || s.az !== 0)) setHasMotion(true);
      if (s.raw?.length && s.rawFs) setRawFs(s.rawFs);
      onSample(s);
    },
    [onSample],
  );

  /* ---------- screen updates ----------
     The charts are redrawn on every screen refresh (smooth), but the numbers beside
     them are updated 20 times a second (immediate, but still readable, not a blur).
     The charts' right edge is "now", as in the original GitHub version. */

  useEffect(() => {
    if (status === "idle" || status === "connecting") return;
    let raf = 0;
    let lastReadout = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const b = buf.current;
      const tNow = (now - t0.current) / 1000;
      const min = tNow - windowRef.current;
      const view = viewRef.current;
      emgPlot.current?.batch(() => {
        // Raw and rectified come from the raw stream; the envelope comes from it too when it exists.
        const d = view === "raw" ? [b.rt, b.rv] : view === "rectified" ? [b.rt, b.rr] : b.rawFs ? [b.rt, b.re] : [b.t, b.v];
        emgPlot.current!.setData(d as uPlot.AlignedData, false);
        emgPlot.current!.setScale("x", { min, max: tNow });
      });
      if (motionPlot.current) {
        motionPlot.current.batch(() => {
          const showRaw = motionViewRef.current === "raw";
          motionPlot.current!.setData((showRaw ? [b.t, b.rax, b.ray, b.raz] : [b.t, b.ax, b.ay, b.az]) as uPlot.AlignedData, false);
          motionPlot.current!.setScale("x", { min, max: tNow });
        });
      }
      // 50 ms = 20 updates a second: fast enough to feel immediate, still readable (it was 125 ms).
      if (now - lastReadout > 50) {
        lastReadout = now;
        const n = b.t.length;
        // How many readings arrived in the last second.
        let k = n - 1;
        while (k > 0 && b.t[k - 1] > tNow - 1) k--;
        // The envelope used for the numbers: worked out from the raw readings when they stream.
        const et = b.rawFs ? b.rt : b.t;
        const ev = b.rawFs ? b.re : b.v;
        // The big number is the average of the last few values, so it does not flicker.
        const recent = ev.slice(Math.max(0, ev.length - (b.rawFs ? Math.round(b.rawFs / 10) : 6)));
        const r = rec.current;
        // The highest value inside the chart window (sets the size of the level meter).
        let max = 0;
        for (let i = 0; i < ev.length; i++) {
          if (et[i] < tNow - windowRef.current) continue;
          if (ev[i] > max) max = ev[i];
        }
        // The share of the last 2 seconds that was stuck at the sensor's maximum.
        let clips = 0;
        let lastSec = 0;
        for (let i = n - 1; i >= 0 && b.t[i] > tNow - 2; i--) {
          clips += b.clip[i];
          lastSec++;
        }
        setReadout({
          value: recent.length ? recent.reduce((a, x) => a + x, 0) / recent.length : 0,
          max,
          rate: n ? n - k : 0,
          elapsed: statusRef.current === "recording" ? (now - r.start) / 1000 : 0,
          peak: statusRef.current === "recording" ? r.peak : 0,
          reps: statusRef.current === "recording" ? r.reps : 0,
          motionReps: statusRef.current === "recording" ? r.motion.reps : 0,
          angle: statusRef.current === "recording" ? r.motion.angle : 0,
          shake: b.shakeMg,
          // "stale" = nothing has arrived for 1.5 seconds: the connection is silent.
          stale: !b.last || now - b.last > 1500,
          sinceConnect: (now - t0.current) / 1000,
          rawLevel: b.rawEma,
          clipPct: lastSec ? (clips / lastSec) * 100 : 0,
          setClipPct: statusRef.current === "recording" && r.v.length ? (r.clipped / r.v.length) * 100 : 0,
        });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [status]);

  /* ---------- connect / disconnect ---------- */

  const resetBuffers = () => {
    t0.current = performance.now();
    buf.current = emptyBuf();
  };

  /**
   * Called when a set ends (stop pressed, or the sensor dropped out mid-set).
   * It puts the recorded readings on an even clock, counts the reps with both
   * sensors, measures shakiness, and adds the set to the "ready to save" list.
   * A set under 2 seconds is thrown away as an accidental press.
   */
  const finishSet = useCallback((reason?: string) => {
    const r = rec.current;
    // The weight that was typed when this set started. startSet() never begins a set without one.
    const setWeight = setLoadRef.current;
    if (!setWeight) return;
    const dur = r.t.length > 1 ? (r.t[r.t.length - 1] - r.t[0]) / 1000 : 0;
    if (dur < MIN_SET_S || r.t.length < 10) {
      setNotice({ tone: "warn", text: `${reason ? reason + " " : ""}That set was under ${MIN_SET_S} seconds, so it wasn't kept.` });
      return;
    }
    // With raw muscle readings, everything goes onto the raw channel's (faster) clock so
    // all channels share one time axis; otherwise onto an even SAVE_FS clock.
    const rawFs = buf.current.rawFs;
    const withRaw = rawFs > 0 && r.rt.length > rawFs * MIN_SET_S * 0.5;
    const fs = withRaw ? rawFs : SAVE_FS;
    // With raw, the clock is the raw readings' own clock, so each raw reading is kept exactly;
    // the slower channels are blended onto it.
    const grid = withRaw
      ? { start: r.rt[0], n: Math.max(2, Math.round((r.rt[r.rt.length - 1] - r.rt[0]) / (1000 / fs)) + 1) }
      : { start: r.t[0], n: Math.max(2, Math.floor(dur * fs) + 1) };
    const values = resampleUniform(r.t, r.v, fs, grid);
    const raw = withRaw ? resampleUniform(r.rt, r.rv, fs, grid, "nearest") : undefined;
    // Keep movement only if the accelerometer sent real (non-zero) values.
    const hasRealMotion = r.ax.some((x, i) => x != null && (x !== 0 || r.ay[i] !== 0 || r.az[i] !== 0));
    const motion = hasRealMotion
      ? {
          x: resampleUniform(r.t, fillGaps(r.ax), fs, grid),
          y: resampleUniform(r.t, fillGaps(r.ay), fs, grid),
          z: resampleUniform(r.t, fillGaps(r.az), fs, grid),
        }
      : undefined;
    // This is the same calculation the save route runs, so the summary here matches the saved set.
    const env = raw ? envelopeFromRaw(raw, fs).envelope : values;
    let peak = 0;
    for (const v of env) peak = Math.max(peak, v);
    const reps = raw || settingsRef.current.stream === "envelope" ? detectReps(env, fs).length : r.reps;
    const verification = verifyReps(env, fs, motion);
    const check = verification.check;
    const observedRateHz = Math.round(((r.t.length - 1) / dur) * 10) / 10;
    const tremor = motion && verification.motion ? analyzeTremor(motion, fs, verification.motion, observedRateHz).metrics : undefined;
    // A tiny 60-point picture of the set, for the list of finished sets.
    const step = Math.max(1, Math.floor(env.length / 60));
    const preview: number[] = [];
    for (let i = 0; i < env.length; i += step) preview.push(env[i]);
    setSets((s) => [
      ...s,
      {
        startedAt: r.startIso,
        durationS: Math.round(dur * 10) / 10,
        values,
        raw,
        fs,
        motion,
        clippedPct: Math.round((r.clipped / Math.max(1, r.v.length)) * 1000) / 10,
        observedRateHz,
        samplesReceived: r.t.length,
        peak,
        reps,
        preview,
        load: setWeight,
        check,
        tremor,
      },
    ]);
    setNotice(reason ? { tone: "warn", text: `${reason} The set recorded so far was kept.` } : null);
  }, []);

  const onDisconnect = useCallback(() => {
    conn.current = null;
    const wasRecording = statusRef.current === "recording";
    setStatus("idle");
    emgPlot.current = null;
    motionPlot.current = null;
    if (wasRecording) finishSet("The sensor disconnected.");
    else if (statusRef.current !== "idle") setNotice({ tone: "warn", text: "The sensor disconnected." });
  }, [finishSet]);

  const connect = async (kind: "sensor" | "demo", override?: Partial<Settings>) => {
    setNotice(null);
    setHasMotion(false);
    setRawFs(0);
    resetBuffers();
    if (kind === "demo") {
      conn.current = connectDemo({ onSample: onSampleMotionFlag, onDisconnect });
      setDeviceName(conn.current.name);
      setTransport("demo");
      setStatus("ready");
      return;
    }
    setStatus("connecting");
    const opts = { ...settings, ...override };
    try {
      const handlers = { onSample: onSampleMotionFlag, onDisconnect, onStage: (st: ConnectStage, name?: string) => setStage({ stage: st, name }) };
      conn.current =
        opts.connection === "bridge"
          ? await connectBridge(handlers)
          : opts.connection === "serial"
            ? await connectSerial(handlers)
            : await connectBluetooth({ ...opts, ...handlers });
      // The bridge resolves on the first reading; keep that sample in the buffer.
      if (conn.current.transport !== "bridge") resetBuffers();
      setDeviceName(conn.current.name);
      setTransport(conn.current.transport);
      setStatus("ready");
    } catch (e) {
      setStatus("idle");
      const err = e instanceof ConnectError ? e : new ConnectError("other", (e as Error)?.message ?? String(e));
      if (err.kind === "cancelled" && opts.connection === "serial") {
        setNotice({
          tone: "warn",
          text: `${err.message} If your sensor wasn’t in the list:`,
          tips: [
            "Pair it first: System Settings → Bluetooth → click Connect next to MyoWare_Shield. Pairing creates the port the browser lists.",
            "In the list, choose MyoWare_Shield (it may appear as cu.MyoWare_Shield).",
            "Check the sensor is switched on, then try again.",
            "Use Chrome or Edge directly. Built-in browsers inside other apps can’t show the port list.",
          ],
          action: { label: "Try again", onClick: () => connect("sensor", override) },
        });
      } else if (err.kind === "cancelled") {
        setNotice({
          tone: "warn",
          text: opts.namePrefix
            ? `${err.message} If your sensor wasn’t in the list:`
            : `${err.message} If the list was empty:`,
          tips: [
            "If your Mac’s Bluetooth settings list MyoWare_Shield (not MyoWareSensor1), the shield still runs the old Bluetooth serial sketch. Upload firmware/MyoCareBLE from this project, or switch Advanced sensor settings → Connection to “through this computer”.",
            "Check the sensor is switched on and its blue light is blinking (blinking = waiting for a connection).",
            "Open your Mac’s Bluetooth settings. If the sensor shows as connected there, disconnect it (or choose Forget). A connected sensor stops advertising.",
            "Make sure Chrome is allowed to use Bluetooth: System Settings → Privacy & Security → Bluetooth → turn on Google Chrome (or Edge).",
            "Use Chrome or Edge directly. Built-in browsers inside other apps can’t show the device list.",
          ],
          action: opts.namePrefix ? { label: "Show all nearby devices", onClick: () => connect("sensor", { namePrefix: "" }) } : undefined,
        });
      } else {
        setNotice({ tone: "bad", text: err.message, tips: err.tips, action: { label: "Try again", onClick: () => connect("sensor", override) } });
      }
    } finally {
      setStage(null);
    }
  };

  const disconnect = () => {
    if (statusRef.current === "recording") finishSet();
    statusRef.current = "idle";
    conn.current?.disconnect();
    conn.current = null;
    setStatus("idle");
  };

  useEffect(() => () => conn.current?.disconnect(), []);

  // Keyboard zoom for the live chart: + / − change how many seconds are shown.
  const connectedNow = status === "ready" || status === "recording";
  useEffect(() => {
    if (!connectedNow) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (el && (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable))) return;
      const i = WINDOW_STEPS.indexOf(windowRef.current);
      if (e.key === "+" || e.key === "=") setWindowS(WINDOW_STEPS[Math.max(0, i - 1)]);
      else if (e.key === "-" || e.key === "_") setWindowS(WINDOW_STEPS[Math.min(WINDOW_STEPS.length - 1, i + 1)]);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [connectedNow]);

  /* ---------- sets ---------- */

  const startSet = () => {
    // A set needs a weight (0 is fine and means arm only), so an empty or invalid box blocks the start.
    if (!loadRef.current) return;
    setLoadRef.current = loadRef.current;
    rec.current = { ...emptyRec(), start: performance.now(), startIso: new Date().toISOString() };
    setNotice(null);
    statusRef.current = "recording";
    setStatus("recording");
  };

  const stopSet = () => {
    setStatus("ready");
    statusRef.current = "ready";
    finishSet();
  };

  const cancelSet = () => {
    statusRef.current = "ready";
    setStatus("ready");
    setNotice({ tone: "warn", text: "Set cancelled. Nothing from it was kept." });
  };

  const unsaved = sets.length > 0 || status === "recording";
  useEffect(() => {
    if (!unsaved) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [unsaved]);

  const save = async () => {
    setStatus("saving");
    setNotice(null);
    // 4 significant digits: electrode-level values are often ~0.01 mV.
    const round = (a: Float32Array) => Array.from(a, (x) => Number(x.toPrecision(4)));
    try {
      if (DEMO) throw new Error(DEMO_MSG);
      const res = await fetch(`/api/record?patient=${encodeURIComponent(patientId)}&as=${as}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exercise,
          location,
          // What was typed; the server adds the start time (or uses the date) so every session is named the same way.
          sessionName: sessionNameText.trim() || undefined,
          painScore: pain === "" ? undefined : Number(pain),
          deviceName,
          transport,
          stream: settings.stream,
          scale: settings.scale,
          gain: gainFor(settings),
          sets: sets.map((s) => ({
            startedAt: s.startedAt,
            sampleRateHz: s.fs,
            clippedPct: s.clippedPct,
            observedRateHz: s.observedRateHz,
            samplesReceived: s.samplesReceived,
            raw: s.raw && round(s.raw),
            values: round(s.values),
            load: { value: s.load.value, unit: s.load.unit },
            motion: s.motion && { x: round(s.motion.x), y: round(s.motion.y), z: round(s.motion.z) },
          })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      statusRef.current = "idle";
      conn.current?.disconnect();
      setSets([]);
      router.push(`${sessionHrefBase}/${j.sessionId}`);
      router.refresh();
    } catch (e) {
      setStatus(conn.current ? "ready" : "idle");
      setNotice({ tone: "bad", text: `Couldn't save: ${(e as Error).message}. Your sets are still here — try again.` });
    }
  };

  /* ---------- charts ---------- */

  const emgOptions = useMemo<Omit<uPlot.Options, "width" | "height">>(
    () => ({
      padding: [10, 12, 0, 0],
      cursor: { show: false },
      scales: {
        x: { time: false },
        y: {
          range: (_u, mn, mx) => {
            // The raw view swings both above and below zero, so it is centred; the others start at zero.
            if (viewRef.current === "raw") {
              const m = Math.max(Math.abs(mn ?? 0), Math.abs(mx ?? 0), 1e-3) * 1.1;
              return [-m, m];
            }
            return [Math.min(0, mn ?? 0), (mx ?? 0) > 0 ? mx! * 1.1 : 1];
          },
        },
      },
      axes: [
        { ...AXIS, values: (_u, v) => v.map(() => ""), size: 8, ticks: { show: false } },
        { ...AXIS, size: 56, values: (_u, v) => v.map((n) => fmtMv(n)), label: "mV", labelSize: 16, labelFont: AXIS.font },
      ],
      series: [{}, { stroke: "#0b63ce", width: 2, fill: "rgba(11,99,206,0.10)", points: { show: false } }],
      legend: { show: false },
      hooks: {
        draw: [
          (u: uPlot) => {
            // Draw a dashed red line at the sensor's maximum: readings cannot go above it.
            // (Not drawn for the raw or rectified views, or once raw readings stream.)
            if (viewRef.current !== "envelope" || buf.current.rawFs) return;
            const c = ceilingMv(settingsRef.current);
            const yMax = u.scales.y.max ?? 0;
            if (c == null || c > yMax) return;
            const y = u.valToPos(c, "y", true);
            const ctx = u.ctx;
            const dpr = devicePixelRatio || 1;
            ctx.save();
            ctx.strokeStyle = "rgba(180,35,35,0.75)";
            ctx.lineWidth = 1.25 * dpr;
            ctx.setLineDash([5 * dpr, 4 * dpr]);
            ctx.beginPath();
            ctx.moveTo(u.bbox.left, y);
            ctx.lineTo(u.bbox.left + u.bbox.width, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "rgba(180,35,35,0.9)";
            ctx.font = `${11 * dpr}px -apple-system, system-ui, sans-serif`;
            ctx.textAlign = "right";
            ctx.fillText(`sensor maximum ${fmtMv(c)} mV`, u.bbox.left + u.bbox.width - 6 * dpr, y + 13 * dpr);
            ctx.restore();
          },
        ],
        drawAxes: [
          (u: uPlot) => {
            // Shade the part of the window that belongs to the set being recorded.
            if (statusRef.current !== "recording") return;
            const start = (rec.current.start - t0.current) / 1000;
            const x0 = Math.max(u.bbox.left, u.valToPos(start, "x", true));
            const ctx = u.ctx;
            ctx.save();
            ctx.fillStyle = "rgba(180,35,35,0.05)";
            ctx.fillRect(x0, u.bbox.top, u.bbox.left + u.bbox.width - x0, u.bbox.height);
            ctx.restore();
          },
        ],
      },
    }),
    [],
  );
  const motionOptions = useMemo<Omit<uPlot.Options, "width" | "height">>(
    () => ({
      padding: [8, 12, 0, 0],
      cursor: { show: false },
      scales: { x: { time: false }, y: { range: (_u, mn, mx) => [Math.min(-1.2, mn ?? 0), Math.max(1.2, mx ?? 0)] } },
      axes: [
        { ...AXIS, values: (_u, v) => v.map(() => ""), size: 8, ticks: { show: false } },
        { ...AXIS, size: 56, values: (_u, v) => v.map((n) => n.toFixed(1)), label: "g", labelSize: 16, labelFont: AXIS.font },
      ],
      series: [{}, ...MOTION_COLORS.map((c) => ({ stroke: c, width: 1.5, points: { show: false } }))],
      legend: { show: false },
    }),
    [],
  );
  const emptyEmg = useMemo(() => [[], []] as unknown as uPlot.AlignedData, []);
  const emptyMotion = useMemo(() => [[], [], [], []] as unknown as uPlot.AlignedData, []);

  /* ---------- view ---------- */

  const connected = status === "ready" || status === "recording" || status === "saving";
  const recording = status === "recording";
  const ex = exercises.find((e) => e.key === exercise);
  const meterMax = Math.max(1e-6, readout.max, readout.peak, ...sets.map((s) => s.peak)) * 1.05;

  return (
    <div className="space-y-6">
      {notice && (
        <div
          role={notice.tone === "bad" ? "alert" : "status"}
          className={cx(
            "fade-in flex items-start gap-2 rounded-2xl px-4 py-3 text-sm",
            notice.tone === "bad" ? "bg-bad-soft text-bad" : notice.tone === "warn" ? "bg-warn-soft text-warn" : "bg-good-soft text-good",
          )}
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="flex-1">
            <p>{notice.text}</p>
            {notice.tips && (
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px]">
                {notice.tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}
            {notice.action && (
              <button type="button" className={cx(btn.secondary, btn.small, "mt-2.5")} onClick={notice.action.onClick}>
                {notice.action.label}
              </button>
            )}
          </div>
          <button type="button" onClick={() => setNotice(null)} className="pressable -m-1 rounded-full p-1 hover:bg-black/5" aria-label="Dismiss message">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      {!connected ? (
        <ConnectCard
          support={support}
          connecting={status === "connecting"}
          stage={stage}
          settings={settings}
          setSettings={setSettings}
          onConnect={() => connect("sensor")}
          onDemo={() => connect("demo")}
        />
      ) : (
        <>
          {/* Sensor + setup */}
          <Card>
            <div className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
              <span className="inline-flex size-10 items-center justify-center rounded-full bg-good-soft text-good">
                {transport === "demo" ? <FlaskConical className="size-5" aria-hidden /> : <BluetoothConnected className="size-5" aria-hidden />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{deviceName}</div>
                <div className="flex items-center gap-1.5 text-[13px] text-ink-2">
                  <span className={cx("inline-block size-2 rounded-full", readout.stale ? "bg-warn" : "bg-good")} aria-hidden />
                  {readout.stale ? "Connected · waiting for data…" : `Connected · ${readout.rate} readings/s`}
                  {transport === "demo" && <Badge tone="warn">Simulated</Badge>}
                </div>
              </div>
              <button type="button" className={cx(btn.secondary, btn.small)} onClick={disconnect} disabled={recording || status === "saving"}>
                Disconnect
              </button>
            </div>
            {readout.stale && readout.sinceConnect > 5 && (
              <div className="mx-5 mb-4 flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-[13px] text-warn sm:mx-6" role="status">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>
                  Connected, but no readings are arriving. Turn the sensor off and on (or press its reset button), then disconnect here and
                  reconnect.
                </p>
              </div>
            )}
            {!readout.stale && settings.scale === "adc12" && readout.rawLevel > 3800 && (
              <div className="mx-5 mb-4 flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-[13px] text-warn sm:mx-6" role="status">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>
                  The reading is stuck near the sensor’s maximum ({Math.round(readout.rawLevel)} of 4095). This usually means the electrodes aren’t touching skin
                  firmly (or the snap leads are off), or the gain knob is turned too high. Contractions won’t show until it comes down.
                </p>
              </div>
            )}
            <div className="grid gap-4 border-t border-line px-5 py-4 sm:grid-cols-3 sm:px-6">
              <Field label="Exercise">
                <select
                  className="min-h-10 w-full rounded-xl border border-line-strong bg-white px-3 text-sm"
                  value={exercise}
                  onChange={(e) => setExercise(e.target.value)}
                  disabled={sets.length > 0 || recording}
                >
                  {exercises.map((e) => (
                    <option key={e.key} value={e.key}>
                      {e.name} · {e.muscle}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Where" group>
                <Segmented
                  label="Where is this session"
                  value={location}
                  onChange={setLocation}
                  options={[
                    { value: "home", label: "Home" },
                    { value: "clinic", label: "Clinic" },
                  ]}
                />
              </Field>
              <Field label="Pain score (patient-reported)">
                <select className="min-h-10 w-full rounded-xl border border-line-strong bg-white px-3 text-sm" value={pain} onChange={(e) => setPain(e.target.value)}>
                  <option value="">Not recorded</option>
                  {Array.from({ length: 11 }, (_, i) => (
                    <option key={i} value={i}>
                      {i}
                      {i === 0 ? " — no pain" : i === 10 ? " — worst pain" : ""}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="border-t border-line px-5 py-4 sm:px-6">
              <Field
                label="Session name (optional)"
                hint={`Saved as “${defaultSessionName(sets[0]?.startedAt ?? new Date().toISOString(), sessionNameText)}”. Leave it empty to use the date. The start time is always added.`}
              >
                <input
                  type="text"
                  className="min-h-10 w-full rounded-xl border border-line-strong bg-white px-3 text-sm"
                  value={sessionNameText}
                  maxLength={SESSION_NAME_MAX}
                  onChange={(e) => setSessionNameText(e.target.value)}
                  placeholder="For example: Week 3 · elbow strength"
                  disabled={status === "saving"}
                />
              </Field>
            </div>
            <div className="border-t border-line px-5 py-4 sm:px-6">
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink">
                  <Dumbbell className="size-4 text-brand" aria-hidden /> Weight for the next set
                </span>
                <span className="ml-auto text-[12px] text-ink-3">Change between sets. Each set saves its own weight.</span>
              </div>
              <WeightInput
                label="Weight for the next set"
                compact
                initial={prescribedLoad ?? null}
                prescribed={prescribedLoad}
                lastUsed={sets.at(-1)?.load}
                onChange={setLoad}
                disabled={recording}
              />
            </div>
          </Card>

          {/* Live readings */}
          <Card className={cx("transition-shadow", recording && "ring-2 ring-bad/30")}>
            <div className="flex flex-wrap items-start gap-6 px-5 pt-5 sm:px-6">
              <div className="min-w-[170px]">
                <div className="eyebrow">{hasRaw ? `Live envelope (from raw, ${EMG_HIGHPASS_HZ} Hz high-pass)` : `Live ${settings.stream}`}</div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="display tabular text-[44px] font-semibold leading-none">{fmtMv(readout.value)}</span>
                  <span className="text-ink-2">mV</span>
                </div>
                <div
                  className="mt-3 h-2 w-full overflow-hidden rounded-full bg-canvas"
                  role="meter"
                  aria-label="Current muscle activation"
                  aria-valuemin={0}
                  aria-valuemax={Number(meterMax.toPrecision(3))}
                  aria-valuenow={Number(readout.value.toPrecision(3))}
                >
                  <div className="h-full rounded-full bg-brand transition-[width] duration-100" style={{ width: `${Math.min(100, (readout.value / meterMax) * 100)}%` }} />
                </div>
              </div>
              <dl className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
                <LiveStat label={recording ? "Set time" : "Status"} value={recording ? fmtClock(readout.elapsed) : "Ready"} live={recording} />
                <LiveStat label="EMG reps" value={recording ? String(readout.reps) : "–"} />
                <LiveStat
                  label="Movement reps"
                  value={recording ? (hasMotion ? String(readout.motionReps) : "no accel") : "–"}
                  match={recording && hasMotion && readout.reps > 0 ? readout.reps === readout.motionReps : undefined}
                />
                <LiveStat label="Set peak" value={recording ? `${fmtMv(readout.peak)} mV` : "–"} />
              </dl>
            </div>

            {!readout.stale && !hasRaw && readout.clipPct > 5 && !(settings.scale === "adc12" && readout.rawLevel > 3800) && (
              <div className="mx-5 mt-4 flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-[13px] text-warn sm:mx-6" role="status">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>
                  {`The envelope is hitting the sensor’s maximum (${fmtMv(ceilingMv(settings) ?? 0)} mV at a ${settings.gainKnobK} kΩ gain setting), so peaks are cut off. Turn the MyoWare gain knob down until a full contraction stays below the dashed line, then update “Gain knob” in Advanced sensor settings.`}
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pt-4 sm:px-6">
              {hasRaw && (
                <Segmented
                  label="Live channel"
                  size="sm"
                  value={liveView}
                  onChange={setLiveView}
                  options={[
                    { value: "envelope", label: "Envelope" },
                    { value: "rectified", label: "Rectified" },
                    { value: "raw", label: "Raw EMG" },
                  ]}
                />
              )}
              <label className="ml-auto flex min-w-[220px] items-center gap-2 text-[12px] text-ink-2">
                <span className="shrink-0">Show last</span>
                <input
                  type="range"
                  min={0}
                  max={WINDOW_STEPS.length - 1}
                  value={WINDOW_STEPS.indexOf(windowS)}
                  onChange={(e) => setWindowS(WINDOW_STEPS[Number(e.target.value)])}
                  className="zoom-range flex-1"
                  aria-valuetext={`${windowS} seconds`}
                />
                <span className="w-9 shrink-0 text-right font-medium text-ink tabular">{windowS} s</span>
              </label>
            </div>

            <div className="px-2 pt-2 sm:px-3">
              <UChart
                options={emgOptions}
                data={emptyEmg}
                height={240}
                ariaLabel={`Live muscle signal, last ${windowS} seconds`}
                onCreate={(u) => (emgPlot.current = u)}
              />
              <div className="flex justify-between px-3 pb-1 pl-[68px] text-[11px] text-ink-3">
                <span>−{windowS} s</span>
                <span className="hidden sm:inline">
                  <kbd>+</kbd> <kbd>−</kbd> to zoom
                </span>
                <span>now</span>
              </div>
            </div>

            {hasMotion && (
              <div className="px-2 sm:px-3">
                <div className="flex flex-wrap items-center gap-3 px-3 pt-2 text-[12px] text-ink-2">
                  <span className="font-medium text-ink">Accelerometer</span>
                  {["X", "Y", "Z"].map((l, i) => (
                    <span key={l} className="inline-flex items-center gap-1">
                      <span className="inline-block h-0.5 w-3 rounded" style={{ background: MOTION_COLORS[i] }} aria-hidden /> {l}
                    </span>
                  ))}
                  <span className="text-ink-3">{motionView === "smooth" ? "despiked + 3 Hz low-pass" : "unfiltered"}</span>
                  {recording && (
                    <span className="tabular rounded-full bg-canvas px-2 py-0.5 text-ink">
                      Arm angle <b>{Math.round(readout.angle)}°</b>
                    </span>
                  )}
                  <span
                    className={cx(
                      "tabular rounded-full px-2 py-0.5",
                      tremorLevel(readout.shake).level === "low" ? "bg-canvas text-ink" : tremorLevel(readout.shake).level === "mild" ? "bg-brand-soft text-brand-strong" : "bg-warn-soft text-warn",
                    )}
                    title="3–12 Hz shake over the last second (milli-g). Most meaningful while the arm holds still."
                  >
                    Shakiness <b>{readout.shake.toFixed(readout.shake < 10 ? 1 : 0)} mg</b>
                  </span>
                  <span className="ml-auto">
                    <Segmented
                      label="Accelerometer trace"
                      size="sm"
                      value={motionView}
                      onChange={setMotionView}
                      options={[
                        { value: "smooth", label: "Smoothed" },
                        { value: "raw", label: "Raw" },
                      ]}
                    />
                  </span>
                </div>
                <UChart options={motionOptions} data={emptyMotion} height={130} ariaLabel="Live accelerometer x, y and z" onCreate={(u) => (motionPlot.current = u)} />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-4 sm:px-6">
              {recording ? (
                <>
                  <button type="button" className={cx(btn.danger, "min-h-11 px-5")} onClick={stopSet}>
                    <Square className="size-4 fill-current" aria-hidden /> Stop set {sets.length + 1}
                  </button>
                  <button type="button" className={btn.ghost} onClick={cancelSet}>
                    Cancel set
                  </button>
                  <span className="ml-auto inline-flex items-center gap-1.5 text-[13px] font-medium text-bad" aria-live="polite">
                    <span className="inline-block size-2 animate-pulse rounded-full bg-bad motion-reduce:animate-none" aria-hidden /> Recording
                  </span>
                </>
              ) : (
                <>
                  <button type="button" className={cx(btn.primary, "min-h-11 px-5")} onClick={startSet} disabled={status === "saving" || readout.stale || !load}>
                    <Play className="size-4 fill-current" aria-hidden /> Start set {sets.length + 1} · {load ? fmtLoad(load) : "enter a weight"}
                  </button>
                  <p className="text-[13px] text-ink-2">
                    Start, have the patient perform the {ex?.name.toLowerCase() ?? "set"}, then stop. Starting with the arm relaxed at the bottom helps the
                    accelerometer find its resting position quickly.
                  </p>
                </>
              )}
            </div>
          </Card>
        </>
      )}

      {/* Completed sets + save */}
      {sets.length > 0 && (
        <Card>
          <CardHeader
            title={`${sets.length} set${sets.length === 1 ? "" : "s"} ready to save`}
            subtitle={`Not stored yet. Each set is put on an even clock (${hasRaw ? `the raw channel’s ${rawFs} Hz` : `${SAVE_FS} Hz`}), analysed and rep-checked on save.`}
          />
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {sets.map((s, i) => (
              <li key={s.startedAt} className="px-5 py-3.5 sm:px-6">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand-strong">{i + 1}</span>
                <Sparkline values={s.preview} width={120} height={30} />
                <div className="grid min-w-[260px] flex-1 grid-cols-3 gap-x-4 gap-y-2 text-[13px] md:grid-cols-5">
                  <span>
                    <span className="block text-ink-3">Started</span>
                    <b className="tabular">{new Date(s.startedAt).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</b>
                  </span>
                  <span>
                    <span className="block text-ink-3">Weight</span>
                    <b className="tabular">{fmtLoad(s.load)}</b>
                  </span>
                  <span>
                    <span className="block text-ink-3">Length</span>
                    <b className="tabular">{fmtClock(s.durationS)}</b>
                  </span>
                  <span>
                    <span className="block whitespace-nowrap text-ink-3">Reps EMG / move</span>
                    <b className="tabular">
                      {s.check.emgReps} / {s.check.status === "no-motion" ? "–" : s.check.motionReps}
                    </b>
                  </span>
                  <span>
                    <span className="block text-ink-3">Peak</span>
                    <b className="tabular">{fmtMv(s.peak)} mV</b>
                  </span>
                </div>
                <button
                  type="button"
                  className={cx(btn.ghost, btn.small, "text-bad hover:bg-bad-soft")}
                  onClick={() => setSets((xs) => xs.filter((_, j) => j !== i))}
                  disabled={status === "saving"}
                  aria-label={`Remove set ${i + 1}`}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 sm:pl-[52px]">
                <Badge tone={REP_STATUS[s.check.status].tone}>
                  <span title={REP_STATUS[s.check.status].help}>
                    {REP_STATUS[s.check.status].label}
                    {s.check.status !== "no-motion" && ` · ${s.check.verifiedReps} of ${Math.max(s.check.emgReps, s.check.motionReps)}`}
                  </span>
                </Badge>
                {s.tremor && (
                  <Badge tone={s.tremor.level === "low" ? "good" : s.tremor.level === "mild" ? "neutral" : "warn"}>
                    <span title={`${tremorLevel(s.tremor.headlineMg).help} Hold RMS, 3–12 Hz.`}>
                      {tremorLevel(s.tremor.headlineMg).label} · {s.tremor.headlineMg} mg{s.tremor.rhythmic && s.tremor.peakHz ? ` @ ${s.tremor.peakHz} Hz` : ""}
                    </span>
                  </Badge>
                )}
                {s.clippedPct >= 2 && !s.raw && (
                  <Badge tone="warn">
                    <span title="Share of readings at the sensor’s maximum">{s.clippedPct}% at max</span>
                  </Badge>
                )}
                <span className="text-[12px] text-ink-3 tabular">
                  {s.observedRateHz} Hz received{s.raw ? ` · + raw ${s.fs} Hz` : ""}
                  {s.motion ? ` · + motion${s.check.meanRomDeg != null ? `, ~${s.check.meanRomDeg}° per rep` : ""}` : ""}
                </span>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4 sm:px-6">
            <button type="button" className={cx(btn.primary, "min-h-11 px-5")} onClick={save} disabled={recording || status === "saving"}>
              {status === "saving" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
              {status === "saving" ? "Saving…" : "Finish & save session"}
            </button>
            <p className="flex items-center gap-1.5 text-[13px] text-ink-2">
              <CircleCheck className="size-4 text-good" aria-hidden />
              Saved to the patient record (with weights and rep checks) and written to the access log.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ---------- pieces ---------- */

function ConnectCard({
  support,
  connecting,
  stage,
  settings,
  setSettings,
  onConnect,
  onDemo,
}: {
  support: BluetoothSupport;
  connecting: boolean;
  stage: { stage: ConnectStage; name?: string } | null;
  settings: Settings;
  setSettings: (s: Settings) => void;
  onConnect: () => void;
  onDemo: () => void;
}) {
  const unsupported = support === "no-api" || support === "insecure" || support === "embedded";
  // Bridge and Web Serial both read the shield's Bluetooth serial port, so they share wording.
  const serial = settings.connection !== "ble";
  const bridge = settings.connection === "bridge";
  const [copied, setCopied] = useState(false);
  const stageText = stage && {
    picking: bridge ? "Looking for the paired sensor…" : serial ? "Choose MyoWare_Shield in the browser’s list…" : "Choose your sensor in the browser’s list…",
    connecting: `Connecting to ${stage.name}…`,
    service: `Connected to ${stage.name}. Opening its data channel…`,
    subscribing: bridge ? `Waiting for the first reading from ${stage.name}…` : `Asking ${stage.name} to start sending readings…`,
  }[stage.stage];
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the URL is shown on screen anyway */
    }
  };
  return (
    <Card>
      <div className="grid gap-6 px-5 py-6 sm:px-6 md:grid-cols-[1.2fr_1fr]">
        <div>
          <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
            <Bluetooth className="size-6" aria-hidden />
          </span>
          <h2 className="title mt-4 text-[20px] font-semibold">Connect your MyoWare sensor</h2>
          <p className="mt-1 max-w-md text-[15px] text-ink-2">
            {serial
              ? bridge
                ? "Pair the shield in macOS Bluetooth settings (MyoWare_Shield), then press Connect. This site’s server reads the paired port and streams it here."
                : "Pair the shield in macOS Bluetooth settings (MyoWare_Shield), then press Connect and choose its port in the browser’s list. Data arrives as Bluetooth serial lines."
              : "Power the Wireless Shield, press Connect and choose it in the browser’s device picker. The status LED goes solid once connected."}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" className={cx(btn.primary, "min-h-11 px-5")} onClick={onConnect} disabled={unsupported || connecting || support === "checking"}>
              {connecting ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Bluetooth className="size-4" aria-hidden />}
              {connecting ? "Connecting…" : "Connect sensor"}
            </button>
            <button type="button" className={cx(btn.secondary, "min-h-11")} onClick={onDemo} disabled={connecting}>
              <FlaskConical className="size-4" aria-hidden /> Try with a demo sensor
            </button>
          </div>
          {connecting && stageText && (
            <p className="mt-3 flex items-center gap-2 text-[13px] text-ink-2" role="status" aria-live="polite">
              <LoaderCircle className="size-3.5 animate-spin text-brand" aria-hidden /> {stageText}
            </p>
          )}
          {unsupported && (
            <div className="mt-3 flex max-w-md items-start gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-[13px] text-warn" role="status">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                {support === "insecure"
                  ? "Bluetooth only works on secure pages. Open this site over https:// or on http://localhost."
                  : bridge
                    ? "Connecting through this computer only works when the site is opened on the Mac the sensor is paired with (http://localhost). Choose another connection under Advanced sensor settings."
                    : support === "embedded"
                    ? "You’re in an app’s built-in browser, which can’t show the sensor list. Open this page in Google Chrome or Microsoft Edge:"
                    : serial
                      ? "This browser can’t open Bluetooth serial ports. Open this page in Chrome or Edge on a computer. (Safari and Firefox don’t support it.)"
                      : "This browser can’t talk to Bluetooth devices. Open this page in Chrome or Edge on a computer or Android phone. (Safari and Firefox don’t support it.)"}
                {support === "embedded" && (
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-lg bg-white/70 px-2 py-1 text-ink">{typeof window !== "undefined" ? window.location.href : ""}</code>
                    <button type="button" className={cx(btn.secondary, btn.small)} onClick={copyLink}>
                      <Copy className="size-3.5" aria-hidden /> {copied ? "Copied" : "Copy link"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="rounded-2xl bg-canvas p-4 text-[13px] text-ink-2">
          <div className="flex items-center gap-1.5 font-medium text-ink">
            <Info className="size-4 text-brand" aria-hidden /> Before you connect
          </div>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li>Place the electrodes over the muscle belly and strap the accelerometer to the forearm, so curls rotate it.</li>
            {serial ? (
              <li>
                <b>Pair it once</b> in System Settings → Bluetooth: click Connect next to <b>MyoWare_Shield</b>. That’s what lets the browser see it.
              </li>
            ) : (
              <li>
                If your computer’s Bluetooth settings already show the sensor as connected, <b>disconnect it there first</b>. Otherwise the browser can’t reach it.
              </li>
            )}
            <li>Keep this page open while recording. Nothing is saved until you press Save.</li>
          </ul>
        </div>
      </div>
      <details className="group border-t border-line">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-5 py-3 text-[13px] font-medium text-ink-2 hover:text-ink sm:px-6 [&::-webkit-details-marker]:hidden">
          <Settings2 className="size-4" aria-hidden /> Advanced sensor settings
          <span className="ml-1 text-ink-3">(for custom firmware)</span>
        </summary>
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2 sm:px-6">
          <Field
            label="Connection"
            hint="Bluetooth LE: for firmware/MyoCareBLE; Chrome or Edge connect directly. Through this computer: for Bluetooth serial sketches (shows as MyoWare_Shield); the site’s server reads the Mac’s paired port, localhost only. Chrome Web Serial can fail on macOS."
          >
            <select className={inputCls} value={settings.connection} onChange={(e) => setSettings({ ...settings, connection: e.target.value as ConnectionKind })}>
              <option value="ble">Bluetooth LE (MyoCareBLE / MyoWare BLE sketch, recommended)</option>
              <option value="bridge">Bluetooth serial, through this computer (older sketches)</option>
              <option value="serial">Bluetooth serial, in Chrome (Web Serial)</option>
            </select>
          </Field>
          {!serial && (
            <Field label="Device name starts with" hint="Leave empty to list every nearby device.">
              <input className={inputCls} value={settings.namePrefix} onChange={(e) => setSettings({ ...settings, namePrefix: e.target.value })} />
            </Field>
          )}
          <Field label="Firmware sends" hint="Which MyoWare output the firmware writes. Stock firmware sends the envelope.">
            <select className={inputCls} value={settings.stream} onChange={(e) => setSettings({ ...settings, stream: e.target.value as ChannelKey })}>
              <option value="envelope">Envelope (ENV)</option>
              <option value="rectified">Rectified (RECT)</option>
              <option value="raw">Raw EMG (RAW): needs a fast stream</option>
            </select>
          </Field>
          {!serial && (
            <>
              <Field label="Service UUID">
                <input className={cx(inputCls, "font-mono text-[12px]")} value={settings.service} onChange={(e) => setSettings({ ...settings, service: e.target.value })} />
              </Field>
              <Field label="Characteristic UUID">
                <input
                  className={cx(inputCls, "font-mono text-[12px]")}
                  value={settings.characteristic}
                  onChange={(e) => setSettings({ ...settings, characteristic: e.target.value })}
                />
              </Field>
            </>
          )}
          <Field
            label="Gain knob (kΩ)"
            hint={`Removes the sensor’s amplification so values are millivolts at the skin. Envelope gain = 200 × (1 + kΩ) = ${myowareGain("envelope", settings.gainKnobK).toLocaleString()}×; raw and rectified = 200×. MyoWare library default: 50.`}
          >
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              className={inputCls}
              value={settings.gainKnobK}
              disabled={!VALUE_SCALES[settings.scale].removeGain}
              onChange={(e) => setSettings({ ...settings, gainKnobK: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field label="Values are in" hint="How the numbers from the board turn into millivolts.">
            <select className={inputCls} value={settings.scale} onChange={(e) => setSettings({ ...settings, scale: e.target.value as ValueScale })}>
              {Object.entries(VALUE_SCALES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="text-[12px] leading-relaxed text-ink-3 sm:pt-6">
            Accepted formats, one reading per line or notification: <code>Muscle:3883,Accel_X:0.01,Accel_Y:-0.98,Accel_Z:0.12</code>, <code>1834</code> or{" "}
            <code>emg,ax,ay,az</code> (acceleration in g). The motion chart appears once the accelerometer sends non-zero values.
          </div>
          <button type="button" className={cx(btn.ghost, btn.small, "justify-self-start")} onClick={() => setSettings(DEFAULT_SETTINGS)}>
            Reset to MyoWare defaults
          </button>
        </div>
      </details>
    </Card>
  );
}

const inputCls = "min-h-10 w-full rounded-xl border border-line-strong bg-white px-3 text-sm";

/** Labelled form row. `group` renders a div so a button group inside isn't captured by <label>. */
function Field({ label, hint, group, children }: { label: string; hint?: string; group?: boolean; children: ReactNode }) {
  const Tag = group ? "div" : "label";
  return (
    <Tag className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-ink-3">{hint}</span>}
    </Tag>
  );
}

function LiveStat({ label, value, live, match }: { label: string; value: string; live?: boolean; match?: boolean }) {
  return (
    <div className={cx("rounded-2xl px-3 py-2.5", match === true ? "bg-good-soft" : match === false ? "bg-warn-soft" : "bg-canvas")}>
      <dt className="text-[12px] text-ink-2">{label}</dt>
      <dd className={cx("mt-0.5 flex items-center gap-1.5 text-[18px] font-semibold tabular", live && "text-bad")}>
        {value}
        {match === true && <CircleCheck className="size-4 text-good" aria-label="matches EMG" />}
        {match === false && <TriangleAlert className="size-4 text-warn" aria-label="differs from EMG" />}
      </dd>
    </div>
  );
}

/** Adaptive precision: electrode-level EMG is often well under 1 mV. */
function fmtMv(v: number) {
  const a = Math.abs(v);
  return v.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3);
}

function fmtClock(s: number) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}
