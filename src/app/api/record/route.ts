import { randomUUID } from "node:crypto";
import { authorize } from "@/lib/access";
import { logAccess } from "@/lib/data";
import { analyzeSignal, deriveChannels } from "@/lib/signal";
import { getStore } from "@/lib/store";
import type { ChannelKey, ExerciseKey, LiveCapture, MotionData, Recording, Session, SignalData, ValueScale } from "@/lib/types";
import { EXERCISES, VALUE_SCALES } from "@/lib/types";

/**
 * Saves a live measurement recorded in the browser (Web Bluetooth or the demo
 * sensor) as one session with one recording per set.
 *
 * POST /api/record?patient=<id>&as=clinician|patient
 * {
 *   "exercise": "bicep-curl",
 *   "location": "home" | "clinic",
 *   "painScore": 3,                       // optional, 0–10
 *   "deviceName": "MyoWareSensor1",
 *   "transport": "web-bluetooth" | "web-serial" | "bridge" | "demo",
 *   "stream": "envelope" | "raw" | "rectified",   // which MyoWare output the firmware sends
 *   "scale": "adc12" | "volts" | "electrode-mv",
 *   "gain": 10200,                        // amplifier gain the browser divided out
 *   "sets": [{
 *     "startedAt": "2026-11-09T15:04:00Z",
 *     "sampleRateHz": 100,                // after resampling in the browser
 *     "observedRateHz": 62.4,
 *     "samplesReceived": 1870,
 *     "values": [ ..mV at the electrodes, uniform.. ],
 *     "raw": [ ..raw EMG mV, same grid.. ],        // optional (firmware v2 batches)
 *     "clippedPct": 4.2,                            // optional, envelope readings at max
 *     "motion": { "x": [..g..], "y": [..], "z": [..] }   // optional, same length
 *   }]
 * }
 */
const MAX_SETS = 20;
const MAX_SAMPLES = 300_000; // 10 min at 500 Hz (raw) or 50 min at 100 Hz

export async function POST(req: Request) {
  const params = new URL(req.url).searchParams;
  const patientId = params.get("patient") ?? "";
  const grant = await authorize(params, patientId);
  if (!grant || grant.actor.role === "recipient") return Response.json({ error: "Not authorised" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const store = await getStore();
  const patient = await store.getPatient(patientId);
  if (!patient) return Response.json({ error: "Unknown patient" }, { status: 404 });

  const exercise = String(body.exercise) as ExerciseKey;
  if (!(exercise in EXERCISES)) return Response.json({ error: "Unknown exercise" }, { status: 400 });
  const stream = (["envelope", "raw", "rectified"].includes(String(body.stream)) ? body.stream : "envelope") as ChannelKey;
  const scale = (String(body.scale) in VALUE_SCALES ? body.scale : "adc12") as ValueScale;
  const transport = (["demo", "web-serial", "bridge"] as const).find((t) => t === body.transport) ?? "web-bluetooth";
  const deviceName = String(body.deviceName ?? "MyoWare sensor").slice(0, 60);
  const sets = Array.isArray(body.sets) ? (body.sets as Record<string, unknown>[]) : [];
  if (!sets.length) return Response.json({ error: "No sets to save" }, { status: 400 });
  if (sets.length > MAX_SETS) return Response.json({ error: `At most ${MAX_SETS} sets per session` }, { status: 413 });

  const num = (a: unknown) => (Array.isArray(a) && a.every((x) => typeof x === "number" && Number.isFinite(x)) ? (a as number[]) : null);
  const parsed: { rec: Omit<Recording, "id" | "sessionId" | "setNumber">; signal: Omit<SignalData, "recordingId"> }[] = [];
  for (const [i, s] of sets.entries()) {
    const values = num(s.values);
    const fs = Number(s.sampleRateHz);
    if (!values || !(fs >= 10 && fs <= 2000)) return Response.json({ error: `Set ${i + 1}: values or sample rate missing` }, { status: 400 });
    if (values.length < fs * 2) return Response.json({ error: `Set ${i + 1} is shorter than 2 seconds` }, { status: 400 });
    if (values.length > MAX_SAMPLES) return Response.json({ error: `Set ${i + 1} is too long` }, { status: 413 });

    const v = Float32Array.from(values);
    const empty = new Float32Array(0);
    // Keep only what the sensor measured. An envelope stream stays envelope-only;
    // a raw stream gets rectified + envelope derived like /api/ingest does.
    let raw = empty;
    let rectified = empty;
    let envelope = v;
    let channels: ChannelKey[] = ["envelope"];
    const rawBatch = num(s.raw);
    if (rawBatch && rawBatch.length === values.length) {
      // Raw EMG streamed next to the envelope (fixed 200× gain, so it isn't cut
      // off when the envelope clips). Derive rectified + envelope from it, the
      // same way /api/ingest and the seed data do, so metrics stay comparable.
      const r = Float32Array.from(rawBatch);
      const mean = r.reduce((a, b) => a + b, 0) / r.length;
      raw = r.map((x) => x - mean);
      ({ rectified, envelope } = deriveChannels(raw, fs));
      channels = ["raw", "rectified", "envelope"];
    } else if (stream === "raw") {
      // Raw output is centred on mid-supply; remove the DC offset.
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      raw = v.map((x) => x - mean);
      ({ rectified, envelope } = deriveChannels(raw, fs));
      channels = ["raw", "rectified", "envelope"];
    } else if (stream === "rectified") {
      rectified = v;
      envelope = deriveChannels(v, fs).envelope;
      channels = ["rectified", "envelope"];
    }

    const mx = num((s.motion as Record<string, unknown> | undefined)?.x);
    const my = num((s.motion as Record<string, unknown> | undefined)?.y);
    const mz = num((s.motion as Record<string, unknown> | undefined)?.z);
    const motion: MotionData | undefined =
      mx && my && mz && mx.length === v.length && my.length === v.length && mz.length === v.length
        ? { x: Float32Array.from(mx), y: Float32Array.from(my), z: Float32Array.from(mz) }
        : undefined;

    const startedAt = typeof s.startedAt === "string" && !Number.isNaN(Date.parse(s.startedAt)) ? new Date(s.startedAt).toISOString() : new Date().toISOString();
    const metrics = analyzeSignal(raw, rectified, envelope, fs);
    const capture: LiveCapture = {
      transport,
      deviceName,
      observedRateHz: Math.round((Number(s.observedRateHz) || 0) * 10) / 10,
      samplesReceived: Math.round(Number(s.samplesReceived) || values.length),
      scale,
      gain: Math.max(1, Number(body.gain) || 1),
      ...(Number.isFinite(Number(s.clippedPct)) && { clippedPct: Math.min(100, Math.max(0, Math.round(Number(s.clippedPct) * 10) / 10)) }),
      ...(channels.includes("raw") && rawBatch && { rawStreamed: true }),
    };
    parsed.push({
      rec: {
        patientId,
        exercise,
        muscle: EXERCISES[exercise].muscle,
        side: patient.affectedSide,
        targetReps: metrics.repsDetected,
        recordedAt: startedAt,
        durationS: Math.round((v.length / fs) * 10) / 10,
        sampleRateHz: fs,
        units: "mV",
        deviceId: deviceName,
        metrics,
        source: "ble",
        channels,
        hasMotion: !!motion,
        capture,
      },
      signal: { sampleRateHz: fs, raw, rectified, envelope, motion },
    });
  }

  const startedAt = parsed[0].rec.recordedAt;
  const pain = Number(body.painScore);
  const session: Session = {
    id: `${patientId}-live-${startedAt.slice(0, 10)}-${randomUUID().slice(0, 6)}`,
    patientId,
    startedAt,
    location: body.location === "clinic" ? "clinic" : "home",
    ...(grant.actor.role === "clinician" && { clinicianId: patient.clinicianId }),
    ...(body.painScore != null && Number.isFinite(pain) && { painScore: Math.min(10, Math.max(0, Math.round(pain))) }),
  };
  await store.upsertSession(session);
  for (const [i, p] of parsed.entries()) {
    const id = `${session.id}-${exercise}-${i + 1}`;
    await store.addRecording({ ...p.rec, id, sessionId: session.id, setNumber: i + 1 }, { ...p.signal, recordingId: id });
  }
  await logAccess(
    patientId,
    grant.actor,
    "data_recorded",
    `Recorded ${parsed.length} set${parsed.length === 1 ? "" : "s"} live (${EXERCISES[exercise].name}) ${
      transport === "demo" ? "from the simulated demo sensor" : `from ${deviceName} over Bluetooth${transport === "web-bluetooth" ? "" : " serial"}`
    }.`,
  );
  return Response.json({ ok: true, sessionId: session.id, recordings: parsed.length }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
