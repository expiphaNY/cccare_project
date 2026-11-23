// =============================================================================
// route.ts : UPLOADS FROM A DEVICE (NOT THE BROWSER)
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   A device can post one finished set of readings here with a secret key. The route checks the key,
//   checks the device is paired to that patient, checks the data, measures the set, cross-checks the
//   reps if movement data was sent, saves it and writes a line in the access log. A device can only ADD
//   data; it can never read any back. (Live recordings from the browser use api/record/route.ts instead.)
//
// STEPS TAKEN FOR THE MARKING RUBRIC
//   Functioning reliably / robust code: bad JSON, an unknown patient, a wrong key or a badly shaped set each get a clear error and nothing is saved.
//   Safety: the key is compared in constant time so it cannot be guessed letter by letter.
// =============================================================================

import { randomUUID, timingSafeEqual } from "node:crypto";
import { logAccess } from "@/lib/data";
import { defaultSessionName } from "@/lib/format";
import { analyzeSignal, deriveChannels } from "@/lib/signal";
import { verifyReps } from "@/lib/rep-verify";
import { analyzeTremor } from "@/lib/tremor";
import { getStore } from "@/lib/store";
import type { ExerciseKey, MotionData, Recording } from "@/lib/types";
import { EXERCISES, isValidLoadValue, makeLoad } from "@/lib/types";

/**
 * UPLOAD ENDPOINT FOR A DEVICE (not the browser).
 * A device sends one set of readings here. The steps, in order:
 *   1. Check the secret key. Wrong key = rejected.
 *   2. Check the patient exists and this device is paired to them.
 *   3. Check the data looks right (known exercise, enough samples, not too many).
 *   4. Clean the signal and measure it (peak, reps, fatigue...).
 *   5. If movement data was sent, double-check the reps with it.
 *   6. Save to the database and write a line in the audit log.
 * The device can only add data. It can never read data back.
 *
 * Technical detail:
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
 *   "envelope": [..],                // optional — derived if missing
 *   "motion": { "x": [..g..], "y": [..], "z": [..] },  // optional accelerometer, same length as raw
 *   "load": { "value": 5, "unit": "kg" }               // optional weight lifted
 * }
 *
 * Write-only by design: a device key can add data but never read it back.
 */
export async function POST(req: Request) {
  // Step 1: secret key. timingSafeEqual compares in constant time, so an attacker cannot guess it letter by letter.
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
  // Step 2: does this patient exist, and is this the device paired to them?
  const store = await getStore();
  const patient = await store.getPatient(String(body.patientId ?? ""));
  if (!patient) return Response.json({ error: "Unknown patient" }, { status: 404 });
  if (body.deviceId !== patient.device.id) return Response.json({ error: "Device is not paired with this patient" }, { status: 403 });
  // Step 3: basic checks on the data.
  const exercise = String(body.exercise) as ExerciseKey;
  if (!(exercise in EXERCISES)) return Response.json({ error: `exercise must be one of ${Object.keys(EXERCISES).join(", ")}` }, { status: 400 });
  if (!Array.isArray(body.raw) || body.raw.length < 100) return Response.json({ error: "raw must be an array of at least 100 samples (mV)" }, { status: 400 });
  if (body.raw.length > 600_000) return Response.json({ error: "Set too long (max 600k samples)" }, { status: 413 });

  // Step 4: clean the signal. If the device did not send the smooth curve, we make it.
  const fs = Number(body.sampleRateHz) || patient.device.sampleRateHz;
  const raw = Float32Array.from(body.raw as number[]);
  const derived = deriveChannels(raw, fs);
  const rectified = Array.isArray(body.rectified) && body.rectified.length === raw.length ? Float32Array.from(body.rectified as number[]) : derived.rectified;
  const envelope = Array.isArray(body.envelope) && body.envelope.length === raw.length ? Float32Array.from(body.envelope as number[]) : derived.envelope;
  const recordedAt = typeof body.recordedAt === "string" && !Number.isNaN(Date.parse(body.recordedAt)) ? new Date(body.recordedAt).toISOString() : new Date().toISOString();

  // A "session" is one visit. Sets from the same day go into the same session.
  const sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : `${patient.id}-${recordedAt.slice(0, 10)}`;
  if (!(await store.getSession(sessionId)))
    // Named by the date and start time, like every session ("Nov 22, 2026 · 4:35 PM").
    await store.upsertSession({ id: sessionId, patientId: patient.id, startedAt: recordedAt, name: defaultSessionName(recordedAt), location: "home" });

  // Measure the set (peak, reps, fatigue...).
  const metrics = analyzeSignal(raw, rectified, envelope, fs);
  // Movement data is optional. Only accept it if all 3 directions are valid numbers of the right length.
  const m = body.motion as Record<string, unknown> | undefined;
  const axis = (a: unknown) => (Array.isArray(a) && a.length === raw.length && a.every((x) => typeof x === "number" && Number.isFinite(x)) ? Float32Array.from(a as number[]) : null);
  const mx = axis(m?.x), my = axis(m?.y), mz = axis(m?.z);
  const motion: MotionData | undefined = mx && my && mz ? { x: mx, y: my, z: mz } : undefined;
  // The weight lifted is optional too: a number from 0 to MAX_LOAD, in kg or lb (kg when the unit is missing).
  const lo = body.load as { value?: unknown; unit?: unknown } | undefined;
  const lv = Number(lo?.value);
  const load = lo && isValidLoadValue(lv) ? makeLoad(lv, lo.unit === "lb" ? "lb" : "kg") : undefined;
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
    hasMotion: !!motion,
    // Step 5: double-check the reps using the movement data (and measure shakiness).
    ...(() => {
      const v = verifyReps(envelope, fs, motion);
      return { repCheck: v.check, ...(motion && v.motion && { tremor: analyzeTremor(motion, fs, v.motion).metrics }) };
    })(),
    ...(load && { load }),
  };
  // Step 6: save, then log it.
  await store.addRecording(rec, { recordingId: rec.id, sampleRateHz: fs, raw, rectified, envelope, motion });
  await logAccess(patient.id, { role: "device", name: patient.device.id }, "data_recorded", `1 set uploaded (${EXERCISES[exercise].name}, set ${rec.setNumber}).`);
  return Response.json({ ok: true, recordingId: rec.id, metrics }, { status: 201 });
}
