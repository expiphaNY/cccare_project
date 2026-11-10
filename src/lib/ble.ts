"use client";

// Browser-side connection to a MyoWare 2.0 Wireless Shield (ESP32). Two ways:
//
// 1. Bluetooth serial (Bluetooth Classic SPP) via the Web Serial API.
//    Shields that show up in macOS Bluetooth settings (e.g. "MyoWare_Shield",
//    type "PDA") run a BluetoothSerial sketch. Once paired, macOS exposes them
//    as /dev/cu.MyoWare_Shield and Chrome/Edge can open that port. Observed
//    format, ~45 lines/s:  "Muscle:3883,Accel_X:0.00,Accel_Y:0.00,Accel_Z:0.00\r\n"
//
// 2. Bluetooth LE via Web Bluetooth. Needs Chrome/Edge over HTTPS or
//    http://localhost. Safari and Firefox support neither API.
//
// Stock BLE firmware (MyoWare Arduino Library, MyoWareBLEPeripheral.ino):
//  - advertises as "MyoWareSensor1" with the MyoWare service below
//  - one BLEStringCharacteristic (read | notify) carrying ONE number as ASCII
//    text, e.g. "1834.00": the ENVELOPE output as 12-bit ADC counts
//  - writes as fast as loop() runs; macOS delivers roughly 30–90 notifications/s
//
// Accelerometer / extra channels: the stock firmware doesn't send them. If you
// change the sketch to write "emg,ax,ay,az" (comma-separated, accel in g) into
// the same characteristic, the recorder picks the motion values up as well.

export const MYOWARE_SERVICE = "ec3af789-2154-49f4-a9fc-bc6c88e9e930";
export const MYOWARE_CHARACTERISTIC = "f3a56edf-8f1e-4533-93bf-5601b2e91308";
export const MYOWARE_NAME_PREFIX = "MyoWare";

/** One reading as it arrives from the board, before unit conversion. */
export interface LiveSample {
  /** performance.now() in ms when the notification arrived. */
  t: number;
  /** EMG value in device units (see ValueScale). */
  v: number;
  /** Accelerometer in g, when the firmware sends it. */
  ax?: number;
  ay?: number;
  az?: number;
}

export interface SensorConnection {
  name: string;
  transport: "web-bluetooth" | "web-serial" | "bridge" | "demo";
  disconnect: () => void;
}

/**
 * "bridge" = this site's Node server reads the Mac's Bluetooth serial port
 * (/api/sensor/stream; any browser, localhost only). "serial" = Chrome Web
 * Serial. "ble" = Chrome Web Bluetooth.
 */
export type ConnectionKind = "bridge" | "serial" | "ble";

export type ConnectStage = "picking" | "connecting" | "service" | "subscribing";

export interface ConnectOptions {
  service: string;
  characteristic: string;
  /** Empty = list every nearby Bluetooth device. */
  namePrefix: string;
  onSample: (s: LiveSample) => void;
  onDisconnect: () => void;
  /** Progress, so the UI can say where a connection stalls. */
  onStage?: (stage: ConnectStage, deviceName?: string) => void;
}

/* ---------- minimal Web Bluetooth typings (not in lib.dom yet) ---------- */

interface BTCharacteristic extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<BTCharacteristic>;
  stopNotifications(): Promise<BTCharacteristic>;
}
interface BTService {
  getCharacteristic(uuid: string): Promise<BTCharacteristic>;
}
interface BTServer {
  connected: boolean;
  connect(): Promise<BTServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BTService>;
}
interface BTDevice extends EventTarget {
  name?: string;
  gatt?: BTServer;
}
interface BTRequestOptions {
  filters?: ({ namePrefix?: string; services?: string[] })[];
  optionalServices?: string[];
  acceptAllDevices?: boolean;
}
interface BTNavigator {
  bluetooth?: { requestDevice(o: BTRequestOptions): Promise<BTDevice>; getAvailability?(): Promise<boolean> };
}

export type BluetoothSupport = "supported" | "no-api" | "insecure" | "embedded" | "checking";

interface SerialPortLike {
  open(o: { baudRate: number; bufferSize?: number }): Promise<void>;
  /** Chrome: bluetoothServiceClassId is set when Chrome opens the port over its own Bluetooth (RFCOMM) link. */
  getInfo?(): { usbVendorId?: number; usbProductId?: number; bluetoothServiceClassId?: string | number };
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
}
interface SerialNavigator {
  serial?: {
    requestPort(o?: object): Promise<SerialPortLike>;
    addEventListener(t: "disconnect", f: (e: Event) => void): void;
    removeEventListener(t: "disconnect", f: (e: Event) => void): void;
  };
}

/**
 * Electron-based in-app browsers (e.g. the Claude desktop app's browser pane)
 * expose navigator.bluetooth but have no device picker, so requestDevice()
 * fails immediately as if the user had cancelled.
 */
function isEmbeddedBrowser() {
  return /\bElectron\/|\bClaude\//.test(navigator.userAgent);
}

/** Whether this browser can use the given connection kind. */
export function sensorSupport(kind: ConnectionKind): BluetoothSupport {
  if (typeof window === "undefined") return "checking";
  // The bridge is plain fetch, so it works in any browser, but the server must be this computer.
  if (kind === "bridge") return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ? "supported" : "no-api";
  if (!window.isSecureContext) return "insecure";
  if (isEmbeddedBrowser()) return "embedded";
  const api = kind === "ble" ? (navigator as unknown as BTNavigator).bluetooth : (navigator as unknown as SerialNavigator).serial;
  return api ? "supported" : "no-api";
}

/** Error with a plain-language message and a machine-readable kind. */
export class ConnectError extends Error {
  constructor(
    public kind: "cancelled" | "bluetooth-off" | "timeout" | "no-service" | "gatt" | "other",
    message: string,
    /** Optional numbered steps shown under the message. */
    public tips?: string[],
  ) {
    super(message);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new ConnectError("timeout", message)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

const NUM = "-?\\d+(?:\\.\\d+)?(?:e-?\\d+)?";

/**
 * Parses one line / notification. Accepts labelled lines such as
 * "Muscle:3883,Accel_X:0.00,Accel_Y:0.00,Accel_Z:0.00" or "emg=1834 ax=0.01",
 * and unlabelled ones: "1834.00" or "1834,0.01,-0.98,0.12" (emg, ax, ay, az).
 * Returns null for blank or garbled lines.
 */
export function parsePacket(text: string): Omit<LiveSample, "t"> | null {
  const labelled = [...text.matchAll(new RegExp(`([A-Za-z][\\w ]*?)\\s*[:=]\\s*(${NUM})`, "gi"))];
  if (labelled.length) {
    const out: Partial<Omit<LiveSample, "t">> = {};
    for (const [, rawKey, val] of labelled) {
      const k = rawKey.trim().toLowerCase();
      const n = Number(val);
      if (!Number.isFinite(n)) continue;
      if (/(^|_)(accel_?)?x$|^ax$/.test(k)) out.ax = n;
      else if (/(^|_)(accel_?)?y$|^ay$/.test(k)) out.ay = n;
      else if (/(^|_)(accel_?)?z$|^az$/.test(k)) out.az = n;
      else if (out.v == null && /muscle|emg|env|raw|rect|value|sensor/.test(k)) out.v = n;
    }
    if (out.v == null) return null;
    return out.ax != null && out.ay != null && out.az != null ? { v: out.v, ax: out.ax, ay: out.ay, az: out.az } : { v: out.v };
  }
  const nums = (text.match(new RegExp(NUM, "gi")) ?? []).map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  const [v, ax, ay, az] = nums;
  return nums.length >= 4 ? { v, ax, ay, az } : { v };
}

const decoder = new TextDecoder();

/**
 * Opens the browser's device picker (must run inside a click handler),
 * connects and subscribes. Every failure becomes a ConnectError with a message
 * that says what to do next.
 */
export async function connectBluetooth(o: ConnectOptions): Promise<SensorConnection> {
  const bt = (navigator as unknown as BTNavigator).bluetooth;
  if (!bt) throw new ConnectError("other", "This browser can't use Bluetooth. Open the page in Chrome or Edge.");
  const service = o.service.trim().toLowerCase();
  const characteristic = o.characteristic.trim().toLowerCase();

  // Note: no await before requestDevice, or the browser loses the user gesture.
  o.onStage?.("picking");
  let device: BTDevice;
  try {
    device = await bt.requestDevice(
      o.namePrefix.trim()
        ? { filters: [{ namePrefix: o.namePrefix.trim() }, { services: [service] }], optionalServices: [service] }
        : { acceptAllDevices: true, optionalServices: [service] },
    );
  } catch (e) {
    const err = e as DOMException;
    console.warn("[ble] requestDevice failed:", err?.name, err?.message);
    if (err?.name === "NotFoundError" && /cancel/i.test(err.message)) throw new ConnectError("cancelled", "No sensor was chosen.");
    if (err?.name === "NotFoundError" && /adapter|bluetooth.*(off|unavailable|not available)/i.test(err.message))
      throw new ConnectError("bluetooth-off", "Bluetooth looks turned off or unavailable on this computer. Turn it on and try again.");
    if (err?.name === "NotFoundError") throw new ConnectError("cancelled", err.message || "No sensor was chosen.");
    if (err?.name === "SecurityError") throw new ConnectError("other", `The browser blocked Bluetooth: ${err.message}`);
    throw new ConnectError("other", `${err?.name ?? "Error"}: ${err?.message ?? String(e)}`);
  }
  if (!device.gatt) throw new ConnectError("gatt", "This device doesn't accept Bluetooth LE connections.");
  const name = device.name ?? "the sensor";

  o.onStage?.("connecting", name);
  let server: BTServer;
  try {
    server = await withTimeout(
      device.gatt.connect(),
      15_000,
      `${name} didn’t answer within 15 s. Make sure it’s on and close by, and that your Mac’s Bluetooth settings aren’t already connected to it.`,
    );
  } catch (e) {
    console.warn("[ble] gatt.connect failed:", e);
    if (e instanceof ConnectError) throw e;
    throw new ConnectError(
      "gatt",
      `Couldn’t connect to ${name}. If your Mac’s Bluetooth settings show it as connected, disconnect it there, then press the shield’s reset button and try again.`,
    );
  }

  o.onStage?.("service", name);
  let ch: BTCharacteristic;
  try {
    ch = await withTimeout(
      server.getPrimaryService(service).then((svc) => svc.getCharacteristic(characteristic)),
      10_000,
      `Connected to ${name}, but it didn’t list its data channel in time.`,
    );
  } catch (e) {
    console.warn("[ble] service lookup failed:", e);
    server.disconnect();
    if (e instanceof ConnectError) throw e;
    throw new ConnectError(
      "no-service",
      `Connected to ${name}, but it doesn’t have the MyoWare data channel. Is it running the MyoWare BLE sketch? Otherwise check the service and characteristic IDs under Advanced.`,
    );
  }

  const onValue = (e: Event) => {
    const dv = (e.target as BTCharacteristic).value;
    if (!dv) return;
    const parsed = parsePacket(decoder.decode(dv));
    if (parsed) o.onSample({ t: performance.now(), ...parsed });
  };
  let closed = false;
  const onGone = () => {
    if (closed) return;
    closed = true;
    ch.removeEventListener("characteristicvaluechanged", onValue);
    o.onDisconnect();
  };
  ch.addEventListener("characteristicvaluechanged", onValue);
  device.addEventListener("gattserverdisconnected", onGone);
  o.onStage?.("subscribing", name);
  try {
    await withTimeout(ch.startNotifications(), 10_000, `${name} didn’t start sending readings.`);
  } catch (e) {
    console.warn("[ble] startNotifications failed:", e);
    closed = true;
    server.disconnect();
    if (e instanceof ConnectError) throw e;
    throw new ConnectError("gatt", `${name} refused live readings (notifications). Check the firmware’s characteristic has BLENotify.`);
  }

  return {
    name: device.name ?? "MyoWare sensor",
    transport: "web-bluetooth",
    disconnect: () => {
      ch.stopNotifications().catch(() => {});
      if (server.connected) server.disconnect();
      onGone();
    },
  };
}

/**
 * Turns a stream of text chunks into timestamped samples. Lines often arrive
 * in bursts, so each burst is spread over the measured line interval to keep
 * timestamps smooth for the chart and the resampler. Lines starting with "#"
 * are passed to onControl (bridge status) instead of being parsed.
 */
function lineFeeder(onSample: (s: LiveSample) => void, onControl?: (line: string) => void) {
  let buf = "";
  let dt = 20;
  let lastT = 0;
  let lastChunk = 0;
  return (text: string) => {
    buf += text;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    if (buf.length > 4096) buf = "";
    const parsed: Omit<LiveSample, "t">[] = [];
    for (const raw of lines) {
      const l = raw.trim();
      if (l.startsWith("#")) onControl?.(l);
      else {
        const p = parsePacket(l);
        if (p) parsed.push(p);
      }
    }
    if (!parsed.length) return;
    const now = performance.now();
    if (lastChunk) dt = 0.8 * dt + 0.2 * Math.min(200, Math.max(1, (now - lastChunk) / parsed.length));
    lastChunk = now;
    parsed.forEach((p, i) => {
      const t = Math.max(lastT + 0.5, now - (parsed.length - 1 - i) * dt);
      lastT = t;
      onSample({ t, ...p });
    });
  };
}

/**
 * Connects through this site's server, which reads the Mac's Bluetooth serial
 * port (created when the sensor is paired in System Settings → Bluetooth).
 * Resolves once the first reading arrives, so "Connected" means data flows.
 */
export async function connectBridge(o: Pick<ConnectOptions, "onSample" | "onDisconnect" | "onStage">): Promise<SensorConnection> {
  const pairTips = [
    "Turn the sensor on, then open System Settings → Bluetooth and click Connect next to MyoWare_Shield. Pairing creates the port this page reads.",
    "Then press Connect here again.",
  ];
  o.onStage?.("picking");
  let ports: { path: string; name: string }[] = [];
  try {
    const r = await fetch("/api/sensor/ports", { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) throw new ConnectError("other", j.error ?? `HTTP ${r.status}`);
    ports = j.ports ?? [];
  } catch (e) {
    if (e instanceof ConnectError) throw e;
    throw new ConnectError("other", `Couldn’t ask the server for sensor ports: ${(e as Error).message}`);
  }
  const port = ports[0];
  if (!port) throw new ConnectError("no-service", "No paired Bluetooth serial sensor was found on this computer.", pairTips);

  o.onStage?.("connecting", port.name);
  const ac = new AbortController();
  let res: Response;
  try {
    res = await fetch(`/api/sensor/stream?port=${encodeURIComponent(port.path)}`, { signal: ac.signal, cache: "no-store" });
  } catch (e) {
    throw new ConnectError("other", `Couldn’t reach the sensor bridge: ${(e as Error).message}`);
  }
  if (!res.ok || !res.body) throw new ConnectError("other", (await res.text().catch(() => "")).replace(/^#ERROR\s*/, "").trim() || `HTTP ${res.status}`);

  o.onStage?.("subscribing", port.name);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let closed = false;
  let gotData = false;
  let failure = "";
  let settle!: (err?: ConnectError) => void;
  const firstData = new Promise<void>((resolve, reject) => {
    settle = (err) => (err ? reject(err) : resolve());
  });
  const feed = lineFeeder(
    (s) => {
      if (!gotData) {
        gotData = true;
        settle();
      }
      o.onSample(s);
    },
    (ctl) => {
      if (ctl.startsWith("#ERROR")) failure = ctl.replace(/^#ERROR\s*/, "");
    },
  );

  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        feed(dec.decode(value, { stream: true }));
        if (failure) break;
      }
    } catch {
      /* aborted */
    } finally {
      reader.releaseLock();
      if (!gotData)
        settle(
          new ConnectError(
            "gatt",
            failure ? `The sensor’s port closed: ${failure}` : "The connection to the sensor closed before any readings arrived.",
            ["Turn the sensor off and on, wait 5 seconds, then press Connect again.", ...pairTips.slice(0, 1)],
          ),
        );
      else if (!closed) {
        closed = true;
        o.onDisconnect();
      }
    }
  })();

  const timeout = setTimeout(
    () =>
      settle(
        new ConnectError("timeout", `${port.name} is connected but hasn’t sent any readings for 15 seconds.`, [
          "Turn the sensor off and on (it can stall after a failed connection), wait 5 seconds, then press Connect again.",
          "Check the battery is charged and the sensor’s light is on.",
          "If it still stays silent, in System Settings → Bluetooth remove (Forget) MyoWare_Shield, pair it again, and retry.",
        ]),
      ),
    15_000,
  );
  try {
    await firstData;
  } catch (e) {
    closed = true;
    ac.abort();
    throw e;
  } finally {
    clearTimeout(timeout);
  }

  return {
    name: port.name,
    transport: "bridge",
    disconnect: () => {
      if (closed) return;
      closed = true;
      ac.abort();
      o.onDisconnect();
    },
  };
}

/**
 * Opens a serial port (Bluetooth serial / SPP, or USB) chosen in the browser's
 * port picker and reads newline-separated lines. Must run inside a click.
 * For a Bluetooth shield the Mac must have paired with it first (System
 * Settings → Bluetooth), which creates the port.
 */
export async function connectSerial(o: Pick<ConnectOptions, "onSample" | "onDisconnect" | "onStage">): Promise<SensorConnection> {
  const serial = (navigator as unknown as SerialNavigator).serial;
  if (!serial) throw new ConnectError("other", "This browser can't open serial ports. Use Chrome or Edge on a computer.");

  o.onStage?.("picking");
  let port: SerialPortLike;
  try {
    port = await serial.requestPort();
  } catch (e) {
    const err = e as DOMException;
    console.warn("[serial] requestPort failed:", err?.name, err?.message);
    if (err?.name === "NotFoundError") throw new ConnectError("cancelled", "No sensor was chosen.");
    throw new ConnectError("other", `${err?.name ?? "Error"}: ${err?.message ?? String(e)}`);
  }

  const info = port.getInfo?.() ?? {};
  const viaChromeBluetooth = info.bluetoothServiceClassId != null;
  console.info("[serial] chosen port:", info, viaChromeBluetooth ? "(Chrome Bluetooth RFCOMM link)" : "(system serial port)");

  // ESP32 Bluetooth serial often refuses the first connection right after a
  // previous one closed, so retry a few times before giving up.
  const ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    o.onStage?.("connecting", attempt === 1 ? "the sensor" : `the sensor (attempt ${attempt} of ${ATTEMPTS})`);
    try {
      // Bluetooth serial ports ignore the baud rate; 115200 also suits USB.
      await withTimeout(
        port.open({ baudRate: 115200, bufferSize: 16384 }),
        15_000,
        "The sensor didn’t answer within 15 s. Check it’s switched on and close by, then try again.",
      );
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e;
      console.warn(`[serial] open attempt ${attempt} failed:`, e);
      if (e instanceof ConnectError || (e as DOMException)?.name === "InvalidStateError") break;
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (lastErr) {
    if (lastErr instanceof ConnectError) throw lastErr;
    if ((lastErr as DOMException)?.name === "InvalidStateError")
      throw new ConnectError("gatt", "That port is already open in this browser. Reload the page (or close other tabs using the sensor) and try again.");
    throw new ConnectError(
      "gatt",
      `Chrome found the sensor but couldn’t open its port (tried ${ATTEMPTS} times).`,
      viaChromeBluetooth
        ? [
            "Allow Chrome to use Bluetooth: System Settings → Privacy & Security → Bluetooth → turn on Google Chrome. Then quit Chrome completely (⌘Q) and reopen it.",
            "In System Settings → Bluetooth, click ⓘ next to MyoWare_Shield and choose Disconnect (keep it paired). Chrome needs to make its own connection.",
            "If the list shows a cu.MyoWare_Shield entry as well, pick that one instead.",
            "Turn the sensor off and on, wait 5 seconds, then press Connect again.",
          ]
        : [
            "Turn the sensor off and on, wait 5 seconds, then press Connect again.",
            "Close anything else that might be using the port: Arduino IDE Serial Monitor, screen, Python scripts, or another browser tab.",
            "Allow Chrome to use Bluetooth: System Settings → Privacy & Security → Bluetooth → turn on Google Chrome. Then quit Chrome (⌘Q) and reopen it.",
            "Still failing? In System Settings → Bluetooth, remove (Forget) MyoWare_Shield, pair it again, then retry.",
          ],
    );
  }
  if (!port.readable) throw new ConnectError("gatt", "The port opened but can’t be read.");

  o.onStage?.("subscribing", "the sensor");
  const reader = port.readable.getReader();
  const dec = new TextDecoder();
  let closed = false;
  const feed = lineFeeder(o.onSample);

  const finish = () => {
    if (closed) return;
    closed = true;
    serial.removeEventListener("disconnect", onUnplug);
    o.onDisconnect();
  };
  const onUnplug = (e: Event) => {
    if ((e.target as unknown) === port) reader.cancel().catch(() => {});
  };
  serial.addEventListener("disconnect", onUnplug);

  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        feed(dec.decode(value, { stream: true }));
      }
    } catch (e) {
      console.warn("[serial] read ended:", e);
    } finally {
      try {
        reader.releaseLock();
        await port.close();
      } catch {
        /* already closed */
      }
      finish();
    }
  })();

  return {
    name: "MyoWare (Bluetooth serial)",
    transport: "web-serial",
    disconnect: () => {
      reader.cancel().catch(() => {});
    },
  };
}

/**
 * A simulated MyoWare that streams ENVELOPE ADC counts and accelerometer
 * values at ~60 Hz. Lets you try the recorder without hardware (and works in
 * browsers without Web Bluetooth). Contractions follow a 4.5 s cycle.
 */
export function connectDemo(o: Pick<ConnectOptions, "onSample" | "onDisconnect">): SensorConnection {
  const t0 = performance.now();
  let level = 0;
  const id = window.setInterval(() => {
    const t = performance.now();
    const s = (t - t0) / 1000;
    const phase = s % 4.5;
    const cycle = Math.floor(s / 4.5);
    const effort = phase > 1 && phase < 3 ? 1 - 0.04 * (cycle % 8) : 0;
    // First-order lag like a real envelope detector.
    level += (effort - level) * 0.12;
    const counts = 180 + level * 1900 + (Math.random() - 0.5) * 60 * (0.3 + level);
    // Forearm swings up during a curl: gravity rotates from -z towards +y.
    const angle = level * 1.25;
    o.onSample({
      t,
      v: Math.max(0, Math.min(4095, Math.round(counts))),
      ax: (Math.random() - 0.5) * 0.04,
      ay: Math.sin(angle) + (Math.random() - 0.5) * 0.04,
      az: -Math.cos(angle) + (Math.random() - 0.5) * 0.04,
    });
  }, 16);
  let closed = false;
  return {
    name: "Demo sensor (simulated)",
    transport: "demo",
    disconnect: () => {
      if (closed) return;
      closed = true;
      window.clearInterval(id);
      o.onDisconnect();
    },
  };
}

/**
 * Resamples irregular BLE samples onto a uniform grid (linear interpolation),
 * so the server's analysis and the charts can treat them like any other set.
 */
export function resampleUniform(t: number[], v: number[], fs: number): Float32Array {
  if (t.length < 2) return Float32Array.from(v);
  const dur = (t[t.length - 1] - t[0]) / 1000;
  const n = Math.max(2, Math.floor(dur * fs) + 1);
  const out = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const ti = t[0] + (i * 1000) / fs;
    while (j < t.length - 2 && t[j + 1] < ti) j++;
    const span = t[j + 1] - t[j];
    const a = span > 0 ? Math.min(1, Math.max(0, (ti - t[j]) / span)) : 0;
    out[i] = v[j] + (v[j + 1] - v[j]) * a;
  }
  return out;
}
