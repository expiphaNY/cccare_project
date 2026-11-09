// Mock data. Replaced by real device uploads (POST /api/ingest) in production.
// Everything is deterministic so the demo looks the same on every machine.

import { analyzeSignal, generateSignal, hashString, mulberry32, synthDuration, DEFAULT_FS } from "./signal";
import type {
  AuditEvent,
  Clinician,
  ExerciseKey,
  Patient,
  Recording,
  Session,
  Share,
  Side,
} from "./types";
import { EXERCISES } from "./types";

export const CLINICIANS: Clinician[] = [
  { id: "c-01", name: "Dr. Amelia Hart", title: "PT, DPT", clinic: "Northside Rehabilitation Clinic" },
  { id: "c-02", name: "Dr. Ravi Menon", title: "MD, PM&R", clinic: "Northside Rehabilitation Clinic" },
];

export const CURRENT_CLINICIAN = CLINICIANS[0];

interface Profile {
  id: string;
  firstName: string;
  lastName: string;
  dob: string;
  sex: Patient["sex"];
  condition: string;
  side: Side;
  exercises: ExerciseKey[];
  goal: string;
  sessions: number;
  base: number; // mV at baseline
  gain: number; // mV gained at asymptote
  tau: number; // sessions to ~63% of gain
  dipLast?: number; // fraction drop on the final sessions
  painStart: number;
}

const PROFILES: Profile[] = [
  {
    id: "p-001",
    firstName: "Maya",
    lastName: "Chen",
    dob: "1992-04-17",
    sex: "female",
    condition: "Distal biceps tendon repair",
    side: "right",
    exercises: ["bicep-curl"],
    goal: "Return to recreational rock climbing by February",
    sessions: 16,
    base: 0.32,
    gain: 0.62,
    tau: 6,
    painStart: 5,
  },
  {
    id: "p-002",
    firstName: "Daniel",
    lastName: "Okafor",
    dob: "1965-09-02",
    sex: "male",
    condition: "Post-stroke hemiparesis",
    side: "left",
    exercises: ["bicep-curl"],
    goal: "Lift a cup to drink using the left hand",
    sessions: 18,
    base: 0.09,
    gain: 0.16,
    tau: 12,
    painStart: 2,
  },
  {
    id: "p-003",
    firstName: "Sofia",
    lastName: "Martínez",
    dob: "1979-01-23",
    sex: "female",
    condition: "Radial head fracture (surgically fixed)",
    side: "right",
    exercises: ["bicep-curl"],
    goal: "Carry grocery bags without elbow pain",
    sessions: 13,
    base: 0.21,
    gain: 0.34,
    tau: 5,
    painStart: 6,
  },
  {
    id: "p-004",
    firstName: "James",
    lastName: "Whitfield",
    dob: "1954-11-30",
    sex: "male",
    condition: "Upper arm (humerus) fracture, healed without surgery",
    side: "left",
    exercises: ["bicep-curl"],
    goal: "Lift a full kettle with the left hand",
    sessions: 14,
    base: 0.24,
    gain: 0.18,
    tau: 3,
    painStart: 4,
  },
  {
    id: "p-005",
    firstName: "Aiko",
    lastName: "Tanaka",
    dob: "1997-06-08",
    sex: "female",
    condition: "Golfer’s elbow (medial epicondylitis)",
    side: "right",
    exercises: ["bicep-curl"],
    goal: "Carry a laptop bag on the daily commute without pain",
    sessions: 10,
    base: 0.28,
    gain: 0.3,
    tau: 4,
    painStart: 3,
  },
  {
    id: "p-006",
    firstName: "Liam",
    lastName: "O'Brien",
    dob: "2007-03-12",
    sex: "male",
    condition: "Biceps muscle strain (grade II)",
    side: "left",
    exercises: ["bicep-curl"],
    goal: "Return to competitive rowing",
    sessions: 12,
    base: 0.4,
    gain: 0.5,
    tau: 3,
    dipLast: 0.22,
    painStart: 4,
  },
];

const TODAY = "2026-11-08T00:00:00Z";
// The demo "now" is Nov 8 2026; keep the newest visit in the past for everyone.
const LAST_DAYS_AGO: Record<string, number> = { "p-001": 2, "p-002": 4, "p-003": 1, "p-004": 9, "p-005": 3, "p-006": 1 };

const DEVICE_MODEL = "MyoSense EMG board v2 (3-channel output)";

function addDays(iso: string, days: number, hour: number, minute: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

function iso(d: Date) {
  return d.toISOString();
}

export interface SeedData {
  patients: Patient[];
  sessions: Session[];
  recordings: Recording[];
  shares: Share[];
  audit: AuditEvent[];
}

export function buildSeed(): SeedData {
  const patients: Patient[] = [];
  const sessions: Session[] = [];
  const recordings: Recording[] = [];
  const shares: Share[] = [];
  const audit: AuditEvent[] = [];
  let auditSeq = 0;
  const log = (e: Omit<AuditEvent, "id">) => audit.push({ id: `a-${String(++auditSeq).padStart(5, "0")}`, ...e });

  for (const pr of PROFILES) {
    const rand = mulberry32(hashString(pr.id));
    // Build the visit schedule first, then anchor it so the last visit is in the past.
    const offsets: number[] = [];
    {
      const r2 = mulberry32(hashString(pr.id + "sched"));
      let d = 0;
      for (let s = 0; s < pr.sessions; s++) {
        offsets.push(d);
        d += 5 + Math.floor(r2() * 3) - (s % 3 === 0 ? 1 : 0);
      }
    }
    const lastDaysAgo = LAST_DAYS_AGO[pr.id] ?? 2;
    const today = new Date(TODAY);
    today.setUTCDate(today.getUTCDate() - lastDaysAgo - offsets[offsets.length - 1]);
    const firstDay = today.toISOString().slice(0, 10);
    const deviceId = `MS-${pr.id.slice(2)}-${(hashString(pr.id) % 9000) + 1000}`;
    const createdAt = addDays(firstDay, -3, 15, 10);
    const patient: Patient = {
      id: pr.id,
      mrn: `NRC-${(hashString(pr.lastName) % 900000) + 100000}`,
      firstName: pr.firstName,
      lastName: pr.lastName,
      dob: pr.dob,
      sex: pr.sex,
      condition: pr.condition,
      affectedSide: pr.side,
      exercises: pr.exercises,
      clinicianId: CURRENT_CLINICIAN.id,
      goal: pr.goal,
      createdAt,
      consent: {
        clinicalCare: true,
        careTeamAccess: true,
        patientSharing: true,
        researchDeidentified: pr.id === "p-001" || pr.id === "p-004",
        updatedAt: createdAt,
      },
      device: {
        id: deviceId,
        model: DEVICE_MODEL,
        firmware: "2.4.1",
        sampleRateHz: DEFAULT_FS,
        channels: ["raw", "rectified", "envelope"],
      },
      storageRegion: "Encrypted MongoDB cluster · Canada (Central) region",
      retentionPolicy: "Kept while you are in care, then 10 years (provincial record-keeping rule), unless you delete it sooner where the law allows.",
    };
    patients.push(patient);
    log({
      patientId: pr.id,
      at: createdAt,
      actor: { role: "clinician", name: CURRENT_CLINICIAN.name, id: CURRENT_CLINICIAN.id },
      action: "profile_created",
      detail: "Profile created at intake. Consent recorded on paper and in app.",
    });

    // Sessions roughly every 5–6 days, alternating clinic / home.
    for (let s = 0; s < pr.sessions; s++) {
      const isClinic = s % 2 === 0;
      const hour = isClinic ? 9 + Math.floor(rand() * 7) : 17 + Math.floor(rand() * 3);
      const startedAt = addDays(firstDay, offsets[s], hour, Math.floor(rand() * 4) * 15);
      const sessionId = `${pr.id}-s${String(s + 1).padStart(2, "0")}`;

      let level = pr.base + pr.gain * (1 - Math.exp(-s / pr.tau));
      if (pr.dipLast && s >= pr.sessions - 2) level *= 1 - pr.dipLast * (s === pr.sessions - 1 ? 1 : 0.5);
      level *= 1 + (rand() - 0.5) * 0.12;
      const pain = Math.max(0, Math.round(pr.painStart * (1 - s / (pr.sessions * 1.2)) + (rand() - 0.5) * 1.5));

      sessions.push({
        id: sessionId,
        patientId: pr.id,
        startedAt,
        location: isClinic ? "clinic" : "home",
        clinicianId: isClinic ? CURRENT_CLINICIAN.id : undefined,
        painScore: pain,
        notes: isClinic
          ? s === 0
            ? "Baseline assessment. Electrode placement marked on skin for repeatability."
            : pr.dipLast && s >= pr.sessions - 2
              ? "Reports tightness after weekend race. Monitor; consider deload."
              : s % 4 === 0
                ? "Good form. Progressed hold time."
                : undefined
          : undefined,
      });

      let minute = 0;
      for (const ex of pr.exercises) {
        const exFactor = ex === pr.exercises[0] ? 1 : 0.78;
        const setCount = s === 0 ? 2 : 3;
        for (let set = 1; set <= setCount; set++) {
          const reps = 6 + Math.floor(rand() * 3);
          const id = `${sessionId}-${ex}-${set}`;
          const synth = {
            seed: hashString(id),
            amplitude: Math.round(level * exFactor * (1 - 0.06 * (set - 1)) * 1000) / 1000,
            reps,
            fatigue: 0.12 + rand() * 0.1 - Math.min(0.08, s * 0.006),
            spectralFatigue: 0.18 + rand() * 0.06 - Math.min(0.08, s * 0.005),
          };
          const sig = generateSignal(synth);
          const metrics = analyzeSignal(sig.raw, sig.rectified, sig.envelope, sig.fs);
          const recordedAt = new Date(new Date(startedAt).getTime() + minute * 60000);
          minute += 2 + Math.floor(rand() * 2);
          recordings.push({
            id,
            patientId: pr.id,
            sessionId,
            exercise: ex,
            muscle: EXERCISES[ex].muscle,
            side: pr.side,
            setNumber: set,
            targetReps: reps,
            recordedAt: iso(recordedAt),
            durationS: Math.round(synthDuration(reps) * 10) / 10,
            sampleRateHz: DEFAULT_FS,
            units: "mV",
            deviceId,
            metrics,
            source: "synthetic",
            synth,
          });
        }
      }
      log({
        patientId: pr.id,
        at: new Date(new Date(startedAt).getTime() + (minute + 1) * 60000).toISOString(),
        actor: { role: "device", name: deviceId },
        action: "data_recorded",
        detail: `${pr.exercises.length * (s === 0 ? 2 : 3)} sets uploaded over TLS from ${isClinic ? "clinic" : "home"} session.`,
      });
      if (isClinic) {
        log({
          patientId: pr.id,
          at: new Date(new Date(startedAt).getTime() + (minute + 15) * 60000).toISOString(),
          actor: { role: "clinician", name: CURRENT_CLINICIAN.name, id: CURRENT_CLINICIAN.id },
          action: "session_viewed",
          detail: `Reviewed session ${s + 1}.`,
        });
      }
    }
  }

  // A couple of pre-existing shares so the transparency views have content.
  const now = new Date("2026-11-08T12:00:00Z");
  shares.push({
    token: "demo-surgeon-maya",
    patientId: "p-001",
    createdAt: iso(new Date(now.getTime() - 5 * 864e5)),
    expiresAt: iso(new Date(now.getTime() + 25 * 864e5)),
    createdBy: { role: "clinician", name: CURRENT_CLINICIAN.name, id: CURRENT_CLINICIAN.id },
    recipient: "Dr. K. Ilunga — Orthopaedic surgeon, Lakeview Sports Medicine",
    purpose: "12-week post-op review",
    scope: "full",
    includeRaw: false,
    accessCount: 2,
    lastAccessedAt: iso(new Date(now.getTime() - 2 * 864e5)),
  });
  log({
    patientId: "p-001",
    at: shares[0].createdAt,
    actor: shares[0].createdBy,
    action: "share_created",
    detail: `Link for ${shares[0].recipient} · full profile · expires in 30 days.`,
  });
  log({
    patientId: "p-001",
    at: iso(new Date(now.getTime() - 3 * 864e5)),
    actor: { role: "recipient", name: shares[0].recipient },
    action: "share_opened",
    detail: "Opened shared link.",
  });
  log({
    patientId: "p-001",
    at: shares[0].lastAccessedAt!,
    actor: { role: "recipient", name: shares[0].recipient },
    action: "share_opened",
    detail: "Opened shared link and downloaded PDF.",
  });
  shares.push({
    token: "demo-expired-daniel",
    patientId: "p-002",
    createdAt: iso(new Date(now.getTime() - 40 * 864e5)),
    expiresAt: iso(new Date(now.getTime() - 33 * 864e5)),
    createdBy: { role: "patient", name: "Daniel Okafor", id: "p-002" },
    recipient: "Family (daughter)",
    purpose: "Keep family updated",
    scope: "full",
    includeRaw: false,
    accessCount: 4,
    lastAccessedAt: iso(new Date(now.getTime() - 35 * 864e5)),
  });
  log({
    patientId: "p-002",
    at: shares[1].createdAt,
    actor: shares[1].createdBy,
    action: "share_created",
    detail: "Link for Family (daughter) · full profile · expires in 7 days.",
  });

  audit.sort((a, b) => a.at.localeCompare(b.at));
  return { patients, sessions, recordings, shares, audit };
}
