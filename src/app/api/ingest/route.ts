import { randomUUID, timingSafeEqual } from "node:crypto";
import { logAccess } from "@/lib/data";
import { analyzeSignal, deriveChannels } from "@/lib/signal";
import { getStore } from "@/lib/store";
import type { ExerciseKey, Recording } from "@/lib/types";
import { EXERCISES } from "@/lib/types";

/**
 * Device upload endpoint for the microcontroller.
 *
 * POST /api/ingest
 * Authorization: Bearer <DEVICE_INGEST_KEY>
 * {
 *   "deviceId": "MS-001-3189",
 *   "patientId": "p-001",
 *   "sessionId": "optional — groups sets; created if new",
 *   "exercise": "bicep-curl",          // one of EXERCISES keys
 *   "setNumber": 1,
 *   "recordedAt": "2026-11-08T15:04:00Z",
 *   "sampleRateHz": 1000,
 *   "raw": [..mV..],                 // required
 *   "rectified": [..],               // optional — derived if missing
 *   "envelope": [..]                 // optional — derived if missing
 * }
 *
 * Write-only by design: a device key can add data but never read it back.
 */
export async function POST(req: Request) {
  const key = process.env.DEVICE_INGEST_KEY ?? "dev-device-key";
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(auth);
  const b = Buffer.from(key);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: "Unauthorised device" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const store = await getStore();
  const patient = await store.getPatient(String(body.patientId ?? ""));
  if (!patient) return Response.json({ error: "Unknown patient" }, { status: 404 });
  if (body.deviceId !== patient.device.id) return Response.json({ error: "Device is not paired with this patient" }, { status: 403 });
  const exercise = String(body.exercise) as ExerciseKey;
  if (!(exercise in EXERCISES)) return Response.json({ error: `exercise must be one of ${Object.keys(EXERCISES).join(", ")}` }, { status: 400 });
  if (!Array.isArray(body.raw) || body.raw.length < 100) return Response.json({ error: "raw must be an array of at least 100 samples (mV)" }, { status: 400 });
  if (body.raw.length > 600_000) return Response.json({ error: "Set too long (max 600k samples)" }, { status: 413 });

  const fs = Number(body.sampleRateHz) || patient.device.sampleRateHz;
  const raw = Float32Array.from(body.raw as number[]);
  const derived = deriveChannels(raw, fs);
  const rectified = Array.isArray(body.rectified) && body.rectified.length === raw.length ? Float32Array.from(body.rectified as number[]) : derived.rectified;
  const envelope = Array.isArray(body.envelope) && body.envelope.length === raw.length ? Float32Array.from(body.envelope as number[]) : derived.envelope;
  const recordedAt = typeof body.recordedAt === "string" && !Number.isNaN(Date.parse(body.recordedAt)) ? new Date(body.recordedAt).toISOString() : new Date().toISOString();

  const sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : `${patient.id}-${recordedAt.slice(0, 10)}`;
  if (!(await store.getSession(sessionId)))
    await store.upsertSession({ id: sessionId, patientId: patient.id, startedAt: recordedAt, location: "home" });

  const metrics = analyzeSignal(raw, rectified, envelope, fs);
  const rec: Recording = {
    id: `${sessionId}-${exercise}-${Number(body.setNumber) || 1}-${randomUUID().slice(0, 6)}`,
    patientId: patient.id,
    sessionId,
    exercise,
    muscle: EXERCISES[exercise].muscle,
    side: patient.affectedSide,
    setNumber: Number(body.setNumber) || 1,
    targetReps: metrics.repsDetected,
    recordedAt,
    durationS: Math.round((raw.length / fs) * 10) / 10,
    sampleRateHz: fs,
    units: "mV",
    deviceId: patient.device.id,
    metrics,
    source: "device",
  };
  await store.addRecording(rec, { recordingId: rec.id, sampleRateHz: fs, raw, rectified, envelope });
  await logAccess(patient.id, { role: "device", name: patient.device.id }, "data_recorded", `1 set uploaded (${EXERCISES[exercise].name}, set ${rec.setNumber}).`);
  return Response.json({ ok: true, recordingId: rec.id, metrics }, { status: 201 });
}
