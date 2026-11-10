"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type uPlot from "uplot";
import {
  Bluetooth,
  BluetoothConnected,
  CircleCheck,
  Copy,
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
import { DEMO, DEMO_MSG } from "@/lib/demo";
import { VALUE_SCALES, myowareGain, type ChannelKey, type ValueScale } from "@/lib/types";
import { Sparkline } from "./charts/Sparkline";
import { AXIS, UChart } from "./charts/UChart";
import { Segmented } from "./Segmented";
import { Badge, Card, CardHeader, btn, cx } from "./ui";

const noSubscribe = () => () => {};

type Nullable = number | null;

/** Fills readings that carried no motion with the nearest real value. */
function fillGaps(a: Nullable[]): number[] {
  const first = a.find((x): x is number => x != null) ?? 0;
  let last = first;
  return a.map((x) => (x == null ? last : (last = x)));
}

/** Uniform rate every live set is resampled to before saving. */
const SAVE_FS = 100;
const MAX_WINDOW_S = 60;
const WINDOW_STEPS = [5, 10, 15, 20, 30, 45, 60];
const MIN_SET_S = 2;
const MOTION_COLORS = ["#2a78d6", "#eb6834", "#1baf7a"];

type Status = "idle" | "connecting" | "ready" | "recording" | "saving";
type LiveView = "envelope" | "rectified" | "raw";

/** Board reading at (or within ~1 % of) the ADC's top: the signal is being cut off. */
function isClipped(scale: ValueScale, v: number) {
  return scale === "adc12" ? v >= 4050 : scale === "volts" ? v >= 3.26 : false;
}
/** Largest value the sensor can report, in electrode mV (null if unknown). */
function ceilingMv(st: Settings) {
  if (st.scale === "electrode-mv") return null;
  return VALUE_SCALES[st.scale].toBoardMv(st.scale === "adc12" ? 4095 : 3.3) / gainFor(st);
}
/** Raw output always has the fixed 200× gain (no knob). */
function rawGainFor(st: Settings) {
  return VALUE_SCALES[st.scale].removeGain ? myowareGain("raw", st.gainKnobK) : 1;
}

interface CompletedSet {
  startedAt: string;
  durationS: number;
  values: Float32Array; // mV at fs
  /** Raw EMG in electrode mV at fs, when the firmware streamed it. */
  raw?: Float32Array;
  fs: number;
  motion?: { x: Float32Array; y: Float32Array; z: Float32Array };
  /** Share of envelope readings at the sensor's ceiling (0–100). */
  clippedPct: number;
  observedRateHz: number;
  samplesReceived: number;
  peak: number;
  reps: number;
  preview: number[];
}

interface Settings {
  /** "bridge" = server reads the Mac's paired serial port; "serial" = Chrome Web Serial; "ble" = Chrome Web Bluetooth. */
  connection: ConnectionKind;
  namePrefix: string;
  service: string;
  characteristic: string;
  scale: ValueScale;
  stream: ChannelKey;
  /** MyoWare gain knob setting in kΩ (library default 50). */
  gainKnobK: number;
}

/** Gain divided out of board readings to get electrode-level mV. */
function gainFor(st: Settings) {
  return VALUE_SCALES[st.scale].removeGain ? myowareGain(st.stream, st.gainKnobK) : 1;
}

const DEFAULT_SETTINGS: Settings = {
  // Matches firmware/MyoCareBLE. Older Bluetooth-serial firmware: use "bridge".
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
}: {
  patientId: string;
  as: "clinician" | "patient";
  exercises: { key: string; name: string; muscle: string }[];
  defaultLocation: "clinic" | "home";
  sessionHrefBase: string;
}) {
  const router = useRouter();
  const plain = as === "patient";
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
  const [readout, setReadout] = useState({ value: 0, max: 0, rate: 0, elapsed: 0, peak: 0, reps: 0, stale: false, sinceConnect: 0, rawLevel: 0, clipPct: 0, setClipPct: 0 });

  const conn = useRef<SensorConnection | null>(null);
  const statusRef = useRef<Status>("idle");
  const settingsRef = useRef(settings);
  const viewRef = useRef<LiveView>("envelope");
  const windowRef = useRef(10);
  useEffect(() => {
    statusRef.current = status;
    settingsRef.current = settings;
    viewRef.current = hasRaw ? liveView : "envelope";
    windowRef.current = windowS;
  });
  // Rolling display buffer (seconds since connect, mV, accel g).
  const t0 = useRef(0);
  // Motion arrays stay aligned with t: null where a reading carried no motion
  // (e.g. the first packets before Bluetooth negotiates a larger packet size).
  const emptyBuf = () => ({
    t: [] as number[],
    v: [] as number[],
    ax: [] as Nullable[],
    ay: [] as Nullable[],
    az: [] as Nullable[],
    // Raw EMG: seconds since connect, mV (drift removed), |mV|.
    rt: [] as number[],
    rv: [] as number[],
    rr: [] as number[],
    clip: [] as number[], // 1 where the envelope reading was at the ceiling
    last: 0,
    rawEma: 0,
    rawClock: 0, // performance.now() ms of the newest raw sample
    rawDc: NaN, // slow running mean of the raw channel
    rawFs: 0,
  });
  const buf = useRef(emptyBuf());
  // Current set accumulator (performance.now() ms, mV, g).
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
  });
  const rec = useRef(emptyRec());
  const emgPlot = useRef<uPlot | null>(null);
  const motionPlot = useRef<uPlot | null>(null);

  /* ---------- incoming samples ---------- */

  const onSample = useCallback((s: LiveSample) => {
    const st = settingsRef.current;
    const mv = VALUE_SCALES[st.scale].toBoardMv(s.v) / gainFor(st);
    const b = buf.current;
    const ts = (s.t - t0.current) / 1000;
    const clipped = isClipped(st.scale, s.v);
    b.t.push(ts);
    b.v.push(mv);
    b.clip.push(clipped ? 1 : 0);
    const motion = s.ax != null && s.ay != null && s.az != null;
    b.ax.push(motion ? s.ax! : null);
    b.ay.push(motion ? s.ay! : null);
    b.az.push(motion ? s.az! : null);
    b.last = s.t;
    b.rawEma = b.rawEma ? 0.95 * b.rawEma + 0.05 * s.v : s.v;
    // Trim to the longest display window (+2 s margin) in batches.
    if (b.t.length > 64 && b.t[0] < ts - MAX_WINDOW_S - 2) {
      const cut = b.t.findIndex((x) => x >= ts - MAX_WINDOW_S);
      for (const k of ["t", "v", "ax", "ay", "az", "clip"] as const) b[k].splice(0, cut);
    }

    // Batched raw EMG: give each sample its own time. Packets can arrive in
    // bursts, so continue the previous batch rather than trusting arrival times,
    // but never run more than 250 ms ahead of (or behind) the clock.
    const rawT: number[] = [];
    const rawV: number[] = [];
    if (s.raw?.length && s.rawFs) {
      const dt = 1000 / s.rawFs;
      const n = s.raw.length;
      let start = Math.max(b.rawClock + dt, s.t - (n - 1) * dt);
      if (start > s.t + 250 || start < s.t - (n - 1) * dt - 250) start = s.t - (n - 1) * dt;
      const g = rawGainFor(st);
      const toMv = VALUE_SCALES[st.scale].toBoardMv;
      // Drift removal: running mean with a ~2 s time constant.
      const alpha = 1 / (2 * s.rawFs);
      for (let i = 0; i < n; i++) {
        const m = toMv(s.raw[i]) / g;
        b.rawDc = Number.isNaN(b.rawDc) ? m : b.rawDc + alpha * (m - b.rawDc);
        const x = m - b.rawDc;
        const t = start + i * dt;
        rawT.push(t);
        rawV.push(x);
        b.rt.push((t - t0.current) / 1000);
        b.rv.push(x);
        b.rr.push(Math.abs(x));
      }
      b.rawClock = start + (n - 1) * dt;
      b.rawFs = s.rawFs;
      if (b.rt.length > 2048 && b.rt[0] < ts - MAX_WINDOW_S - 2) {
        const cut = b.rt.findIndex((x) => x >= ts - MAX_WINDOW_S);
        for (const k of ["rt", "rv", "rr"] as const) b[k].splice(0, cut);
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
      // Live rep counter: hysteresis between the resting floor and the set peak.
      r.peak = Math.max(r.peak, mv);
      r.floor = Math.min(r.floor, mv);
      const span = r.peak - r.floor;
      if (r.peak > 0 && span > r.peak * 0.25) {
        const on = r.floor + span * 0.35;
        const off = r.floor + span * 0.2;
        if (!r.inRep && mv > on) {
          r.inRep = true;
          r.repStart = s.t;
        } else if (r.inRep && mv < off) {
          r.inRep = false;
          if (s.t - r.repStart > 300) r.reps++;
        }
      }
    }
  }, []);

  const onSampleMotionFlag = useCallback(
    (s: LiveSample) => {
      // Firmware without a working accelerometer sends 0.00 for x/y/z: ignore that.
      if (s.ax != null && (s.ax !== 0 || s.ay !== 0 || s.az !== 0)) setHasMotion(true);
      if (s.raw?.length && s.rawFs) setRawFs(s.rawFs);
      onSample(s);
    },
    [onSample],
  );

  /* ---------- render loop: charts at display rate, numbers at ~8 Hz ---------- */

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
        const d = view === "raw" ? [b.rt, b.rv] : view === "rectified" ? [b.rt, b.rr] : [b.t, b.v];
        emgPlot.current!.setData(d as uPlot.AlignedData, false);
        emgPlot.current!.setScale("x", { min, max: tNow });
      });
      if (motionPlot.current) {
        motionPlot.current.batch(() => {
          motionPlot.current!.setData([b.t, b.ax, b.ay, b.az] as uPlot.AlignedData, false);
          motionPlot.current!.setScale("x", { min, max: tNow });
        });
      }
      if (now - lastReadout > 125) {
        lastReadout = now;
        const n = b.t.length;
        let k = n - 1;
        while (k > 0 && b.t[k - 1] > tNow - 1) k--;
        const recent = n ? b.v.slice(Math.max(0, n - 6)) : [];
        const r = rec.current;
        let max = 0;
        let clips = 0;
        let lastSec = 0;
        for (let i = 0; i < n; i++) {
          if (b.t[i] < tNow - windowRef.current) continue;
          if (b.v[i] > max) max = b.v[i];
        }
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

  const finishSet = useCallback((reason?: string) => {
    const r = rec.current;
    const dur = r.t.length > 1 ? (r.t[r.t.length - 1] - r.t[0]) / 1000 : 0;
    if (dur < MIN_SET_S || r.t.length < 10) {
      setNotice({ tone: "warn", text: `${reason ? reason + " " : ""}That set was under ${MIN_SET_S} seconds, so it wasn't kept.` });
      return;
    }
    // With raw EMG, everything goes onto the raw channel's (faster) grid so
    // all channels share one time axis; otherwise SAVE_FS.
    const rawFs = buf.current.rawFs;
    const withRaw = rawFs > 0 && r.rt.length > rawFs * MIN_SET_S * 0.5;
    const fs = withRaw ? rawFs : SAVE_FS;
    const grid = { start: r.t[0], n: Math.max(2, Math.floor(dur * fs) + 1) };
    const values = resampleUniform(r.t, r.v, fs, grid);
    const raw = withRaw ? resampleUniform(r.rt, r.rv, fs, grid) : undefined;
    // Keep motion only if the accelerometer sent real (non-zero) values.
    const hasRealMotion = r.ax.some((x, i) => x != null && (x !== 0 || r.ay[i] !== 0 || r.az[i] !== 0));
    const motion = hasRealMotion
        ? { x: resampleUniform(r.t, fillGaps(r.ax), fs, grid), y: resampleUniform(r.t, fillGaps(r.ay), fs, grid), z: resampleUniform(r.t, fillGaps(r.az), fs, grid) }
        : undefined;
    let peak = 0;
    for (const v of values) peak = Math.max(peak, v);
    const reps = settingsRef.current.stream === "envelope" ? detectReps(values, fs).length : r.reps;
    const step = Math.max(1, Math.floor(values.length / 60));
    const preview: number[] = [];
    for (let i = 0; i < values.length; i += step) preview.push(values[i]);
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
        observedRateHz: Math.round(((r.t.length - 1) / dur) * 10) / 10,
        samplesReceived: r.t.length,
        peak,
        reps,
        preview,
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
            raw: s.raw && round(s.raw),
            observedRateHz: s.observedRateHz,
            samplesReceived: s.samplesReceived,
            values: round(s.values),
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
            // The sensor's ceiling: readings can't go above this line.
            if (viewRef.current !== "envelope") return;
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
          plain={plain}
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
              <Field label={plain ? "Pain before starting (0–10)" : "Pain score (patient-reported)"}>
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
          </Card>

          {/* Live readings */}
          <Card className={cx("transition-shadow", recording && "ring-2 ring-bad/30")}>
            <div className="flex flex-wrap items-start gap-6 px-5 pt-5 sm:px-6">
              <div className="min-w-[170px]">
                <div className="eyebrow">{plain ? "Muscle effort now" : `Live ${settings.stream}`}</div>
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
              <dl className="grid flex-1 grid-cols-3 gap-3">
                <LiveStat label={recording ? "Set time" : "Status"} value={recording ? fmtClock(readout.elapsed) : "Ready"} live={recording} />
                <LiveStat label={plain ? "Reps counted" : "Reps (live)"} value={recording ? String(readout.reps) : "–"} />
                <LiveStat label={plain ? "Strongest so far" : "Set peak"} value={recording ? `${fmtMv(readout.peak)} mV` : "–"} />
              </dl>
            </div>

            {!readout.stale && readout.clipPct > 5 && !(settings.scale === "adc12" && readout.rawLevel > 3800) && (
              <div className="mx-5 mt-4 flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-[13px] text-warn sm:mx-6" role="status">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>
                  {plain
                    ? "Your muscle signal is going off the top of the sensor’s scale, so the strongest part is being cut off. Ask your clinician to turn the sensor’s gain knob down a little."
                    : `The envelope is hitting the sensor’s maximum (${fmtMv(ceilingMv(settings) ?? 0)} mV at a ${settings.gainKnobK} kΩ gain setting), so peaks are cut off. Turn the MyoWare gain knob down until a full contraction stays below the dashed line, then update “Gain knob” in Advanced sensor settings.${hasRaw ? " The raw and rectified channels have a fixed 200× gain and are not affected." : ""}`}
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
                    { value: "envelope", label: plain ? "Effort" : "Envelope" },
                    { value: "rectified", label: "Rectified" },
                    { value: "raw", label: plain ? "Raw signal" : "Raw EMG" },
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
                <div className="flex items-center gap-3 px-3 pt-2 text-[12px] text-ink-2">
                  <span className="font-medium text-ink">{plain ? "Arm movement" : "Accelerometer"}</span>
                  {["X", "Y", "Z"].map((l, i) => (
                    <span key={l} className="inline-flex items-center gap-1">
                      <span className="inline-block h-0.5 w-3 rounded" style={{ background: MOTION_COLORS[i] }} aria-hidden /> {l}
                    </span>
                  ))}
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
                  <button type="button" className={cx(btn.primary, "min-h-11 px-5")} onClick={startSet} disabled={status === "saving" || readout.stale}>
                    <Play className="size-4 fill-current" aria-hidden /> Start set {sets.length + 1}
                  </button>
                  <p className="text-[13px] text-ink-2">
                    {plain
                      ? `Press start, then do your ${ex?.name.toLowerCase() ?? "exercise"}. Press stop when you finish the set.`
                      : `Start, have the patient perform the set, then stop. Each set is saved as its own recording.`}
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
            subtitle={
              plain
                ? "Nothing is stored until you press Save. Remove a set if something went wrong."
                : `Not stored yet. Each set is resampled to ${hasRaw ? `the raw channel’s rate (${rawFs} Hz)` : `${SAVE_FS} Hz`} and analysed on save.`
            }
          />
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {sets.map((s, i) => (
              <li key={s.startedAt} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3 sm:px-6">
                <span className="inline-flex size-8 items-center justify-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand-strong">{i + 1}</span>
                <Sparkline values={s.preview} width={120} height={30} />
                <div className="grid flex-1 grid-cols-4 gap-3 text-[13px]">
                  <span>
                    <span className="block text-ink-3">Started</span>
                    <b className="tabular">{new Date(s.startedAt).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</b>
                  </span>
                  <span>
                    <span className="block text-ink-3">Length</span>
                    <b className="tabular">{fmtClock(s.durationS)}</b>
                  </span>
                  <span>
                    <span className="block text-ink-3">Reps</span>
                    <b className="tabular">{s.reps}</b>
                  </span>
                  <span>
                    <span className="block text-ink-3">Peak</span>
                    <b className="tabular">{fmtMv(s.peak)} mV</b>
                  </span>
                </div>
                {s.clippedPct >= 2 && (
                  <Badge tone="warn">
                    <span title="Share of readings at the sensor’s maximum">{s.clippedPct}% at max</span>
                  </Badge>
                )}
                {!plain && (
                  <span className="text-[12px] text-ink-3 tabular">
                    {s.observedRateHz} Hz received{s.raw ? ` · + raw ${s.fs} Hz` : ""}
                    {s.motion ? " · + motion" : ""}
                  </span>
                )}
                <button
                  type="button"
                  className={cx(btn.ghost, btn.small, "text-bad hover:bg-bad-soft")}
                  onClick={() => setSets((xs) => xs.filter((_, j) => j !== i))}
                  disabled={status === "saving"}
                  aria-label={`Remove set ${i + 1}`}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
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
              {plain ? "It will appear in your sessions and your clinician can see it." : "Saved to the patient record and written to the access log."}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ---------- pieces ---------- */

function ConnectCard({
  plain,
  support,
  connecting,
  stage,
  settings,
  setSettings,
  onConnect,
  onDemo,
}: {
  plain: boolean;
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
              ? plain
                ? `Turn the sensor on and connect it once in your Mac’s Bluetooth settings (it’s called MyoWare_Shield). Then press Connect${bridge ? "." : " and pick MyoWare_Shield from the list."}`
                : bridge
                  ? "Pair the shield in macOS Bluetooth settings (MyoWare_Shield), then press Connect. This site’s server reads the paired port and streams it here."
                  : "Pair the shield in macOS Bluetooth settings (MyoWare_Shield), then press Connect and choose its port in the browser’s list. Data arrives as Bluetooth serial lines."
              : plain
                ? "Turn the sensor on, then press Connect and pick it from the list. Its light stops blinking once it’s connected."
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
            <li>Place the electrodes and snap the sensor on as your clinician showed you.</li>
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
          <Field label="Firmware sends" hint="MyoWare output written to the characteristic. Stock firmware sends the envelope.">
            <select className={inputCls} value={settings.stream} onChange={(e) => setSettings({ ...settings, stream: e.target.value as ChannelKey })}>
              <option value="envelope">Envelope (ENV)</option>
              <option value="rectified">Rectified (RECT)</option>
              <option value="raw">Raw EMG (RAW) — needs a fast stream</option>
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
            hint={`Removes the sensor’s amplification so values are millivolts at the skin. Envelope gain = 200 × (1 + kΩ) = ${myowareGain("envelope", settings.gainKnobK).toLocaleString()}×; raw/rectified = 200×. MyoWare library default: 50.`}
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

function LiveStat({ label, value, live }: { label: string; value: string; live?: boolean }) {
  return (
    <div className="rounded-2xl bg-canvas px-3 py-2.5">
      <dt className="text-[12px] text-ink-2">{label}</dt>
      <dd className={cx("mt-0.5 text-[18px] font-semibold tabular", live && "text-bad")}>{value}</dd>
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
