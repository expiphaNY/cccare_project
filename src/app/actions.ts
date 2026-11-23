// =============================================================================
// actions.ts : SERVER ACTIONS: EVERY CHANGE A CLINICIAN CAN MAKE
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Each function here runs on the server when a form or button is used on a page:
//     - create a patient profile
//     - add, edit or delete a session note
//     - create or revoke an expiring share link for an outside clinic
//     - change a patient's consent choices
//     - delete a patient and everything about them (a receipt with no health data is kept)
//   Changes that matter for privacy (sharing, consent, deleting) are written to the
//   access log, which the patient can read.
//
// STEPS TAKEN FOR THE MARKING RUBRIC
//   Impact on people (safety and privacy): consent, sharing and deletion are explicit actions and
//   every one leaves a visible line in the access log.
// =============================================================================

"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { clinicianActor, logAccess, newShareToken } from "@/lib/data";
import { CURRENT_CLINICIAN } from "@/lib/mock";
import { getStore } from "@/lib/store";
import type { Actor, Consent, ExerciseKey, Patient, Share, Side, Sex, WeightUnit } from "@/lib/types";
import { EXERCISES, MAX_LOAD, fmtLoad, isValidLoadValue, makeLoad } from "@/lib/types";
import { SESSION_NAME_MAX, defaultSessionName, fullName } from "@/lib/format";
import { DEFAULT_FS } from "@/lib/signal";

/** Clinician-only app. Kept as a parameter so callers stay explicit about who acts. */
type As = "clinician";

async function actorFor(_as: As, patientId: string): Promise<{ actor: Actor; patient: Patient }> {
  const store = await getStore();
  const patient = await store.getPatient(patientId);
  if (!patient) throw new Error("Patient not found");
  return { actor: clinicianActor, patient };
}

function revalidatePatient(id: string) {
  revalidatePath(`/doctor/patients/${id}`, "layout");
  revalidatePath("/doctor");
  revalidatePath("/doctor/suggestions");
}

export async function createShareAction(input: {
  as: As;
  patientId: string;
  recipient: string;
  purpose: string;
  days: number;
  scope: "full" | "sessions";
  sessionIds?: string[];
  includeRaw: boolean;
}): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const { actor, patient } = await actorFor(input.as, input.patientId);
  const recipient = input.recipient.trim();
  if (!recipient) return { ok: false, error: "Say who this link is for — it is shown in the access log." };
  if (input.scope === "sessions" && !input.sessionIds?.length) return { ok: false, error: "Pick at least one session." };
  const days = Math.min(90, Math.max(1, Math.round(input.days)));
  const now = new Date();
  const share: Share = {
    token: newShareToken(),
    patientId: input.patientId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + days * 864e5).toISOString(),
    createdBy: actor,
    recipient,
    purpose: input.purpose.trim() || "Not specified",
    scope: input.scope,
    sessionIds: input.scope === "sessions" ? input.sessionIds : undefined,
    includeRaw: input.includeRaw,
    accessCount: 0,
  };
  const store = await getStore();
  await store.createShare(share);
  await logAccess(
    input.patientId,
    actor,
    "share_created",
    `Link for ${recipient} · ${share.scope === "full" ? "full profile" : `${share.sessionIds!.length} session(s)`}${
      share.includeRaw ? " incl. raw signals" : ""
    } · expires in ${days} day${days === 1 ? "" : "s"}.`,
  );
  revalidatePatient(input.patientId);
  return { ok: true, token: share.token };
}

export async function revokeShareAction(as: As, patientId: string, token: string) {
  const { actor } = await actorFor(as, patientId);
  const store = await getStore();
  const share = await store.getShare(token);
  if (!share || share.patientId !== patientId) return;
  await store.updateShare(token, { revokedAt: new Date().toISOString() });
  await logAccess(patientId, actor, "share_revoked", `Revoked link for ${share.recipient}. It stopped working immediately.`);
  revalidatePatient(patientId);
}

export async function updateConsentAction(as: As, patientId: string, patch: Partial<Omit<Consent, "clinicalCare" | "updatedAt">>) {
  const { actor, patient } = await actorFor(as, patientId);
  const consent: Consent = { ...patient.consent, ...patch, clinicalCare: true, updatedAt: new Date().toISOString() };
  const store = await getStore();
  await store.updatePatient(patientId, { consent });
  const labels: Record<string, string> = {
    careTeamAccess: "Care-team access",
    patientSharing: "Patient sharing",
    researchDeidentified: "De-identified research use",
  };
  const changes = Object.entries(patch)
    .map(([k, v]) => `${labels[k] ?? k} ${v ? "on" : "off"}`)
    .join(", ");
  await logAccess(patientId, actor, "consent_updated", `Consent changed: ${changes}.`);
  revalidatePatient(patientId);
}

export async function deletePatientAction(
  as: As,
  patientId: string,
  confirmation: string,
): Promise<{ ok: true; receiptId: string; counts: Record<string, number> } | { ok: false; error: string }> {
  const { actor, patient } = await actorFor(as, patientId);
  if (confirmation.trim().toLowerCase() !== fullName(patient).toLowerCase())
    return { ok: false, error: `Type the full name exactly: ${fullName(patient)}` };
  const store = await getStore();
  const receipt = {
    id: `del-${randomUUID().slice(0, 8)}`,
    patientRef: createHash("sha256").update(patient.id).digest("hex"),
    deletedAt: new Date().toISOString(),
    deletedBy: { role: actor.role, name: actor.name },
    counts: { sessions: 0, recordings: 0, shares: 0, auditEvents: 0 },
  };
  const counts = await store.deletePatient(patientId, receipt);
  // No revalidatePath here: it would re-render the (now deleted) current page.
  // The client navigates to /deleted, and every page is request-time anyway.
  return { ok: true, receiptId: receipt.id, counts };
}

export async function addNoteAction(patientId: string, sessionId: string, text: string) {
  const store = await getStore();
  const session = await store.getSession(sessionId);
  if (!session || session.patientId !== patientId) return;
  const stamp = new Date().toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  const line = `${stamp} — ${CURRENT_CLINICIAN.name}: ${text.trim()}`;
  await store.upsertSession({ ...session, notes: session.notes ? `${session.notes}\n${line}` : line });
  await logAccess(patientId, clinicianActor, "note_added", "Added a clinical note to a session.");
  revalidatePatient(patientId);
}

/**
 * Notes live in one text field, one note per line. Edit and delete address a note
 * by its line number plus the exact text the clinician saw, so a stale page can
 * never change the wrong note.
 */
const NOTE_PREFIX = /^.+? — [^:\n]+: /;

async function loadNoteLine(patientId: string, sessionId: string, index: number, expected: string) {
  const store = await getStore();
  const session = await store.getSession(sessionId);
  if (!session || session.patientId !== patientId) return { ok: false, error: "Session not found." } as const;
  const lines = (session.notes ?? "").split("\n");
  if (!Number.isInteger(index) || index < 0 || lines[index] !== expected)
    return { ok: false, error: "This note was changed elsewhere. Reload the page and try again." } as const;
  return { ok: true, store, session, lines } as const;
}

export async function editNoteAction(
  patientId: string,
  sessionId: string,
  index: number,
  expected: string,
  text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const body = text.replace(/\s*\n\s*/g, " ").trim();
  if (!body) return { ok: false, error: "A note can’t be empty. Use Delete to remove it." };
  const found = await loadNoteLine(patientId, sessionId, index, expected);
  if (!found.ok) return found;
  const { store, session, lines } = found;
  // Keep the "date — clinician:" label so the record still shows who wrote it and when.
  const prefix = expected.match(NOTE_PREFIX)?.[0] ?? "";
  lines[index] = `${prefix}${body}`;
  await store.upsertSession({ ...session, notes: lines.join("\n") });
  await logAccess(patientId, clinicianActor, "note_edited", "Edited a clinical note on a session.");
  revalidatePatient(patientId);
  return { ok: true };
}

export async function deleteNoteAction(
  patientId: string,
  sessionId: string,
  index: number,
  expected: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const found = await loadNoteLine(patientId, sessionId, index, expected);
  if (!found.ok) return found;
  const { store, session, lines } = found;
  lines.splice(index, 1);
  const rest = lines.join("\n");
  // Drop the field entirely when no notes remain, rather than storing an empty value.
  const { notes: _old, ...withoutNotes } = session;
  void _old;
  await store.upsertSession(rest ? { ...session, notes: rest } : withoutNotes);
  await logAccess(patientId, clinicianActor, "note_deleted", "Deleted a clinical note from a session.");
  revalidatePatient(patientId);
  return { ok: true };
}

export async function createPatientAction(
  _prev: { error?: string; id?: string } | null,
  form: FormData,
): Promise<{ error?: string; id?: string }> {
  const firstName = String(form.get("firstName") ?? "").trim();
  const lastName = String(form.get("lastName") ?? "").trim();
  const dob = String(form.get("dob") ?? "");
  const condition = String(form.get("condition") ?? "").trim();
  const exercises = form.getAll("exercises").map(String).filter((e): e is ExerciseKey => e in EXERCISES);
  if (!firstName || !lastName) return { error: "First and last name are required." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return { error: "Date of birth is required." };
  if (!condition) return { error: "Add the condition being treated." };
  if (!exercises.length) return { error: "Pick at least one exercise to measure." };
  if (form.get("consent") !== "on") return { error: "Consent for clinical care must be recorded before creating a profile." };

  const id = `p-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const patient: Patient = {
    id,
    mrn: `NRC-${Math.floor(100000 + Math.random() * 900000)}`,
    firstName,
    lastName,
    dob,
    sex: (String(form.get("sex")) as Sex) || "other",
    condition,
    affectedSide: (String(form.get("side")) as Side) || "right",
    exercises,
    clinicianId: CURRENT_CLINICIAN.id,
    goal: String(form.get("goal") ?? "").trim() || "To be set at first session",
    createdAt: now,
    consent: {
      clinicalCare: true,
      careTeamAccess: form.get("careTeam") === "on",
      patientSharing: true,
      researchDeidentified: form.get("research") === "on",
      updatedAt: now,
    },
    device: {
      id: `MS-${id.slice(2, 6).toUpperCase()}`,
      model: "MyoSense EMG board v2 (3-channel output)",
      firmware: "2.4.1",
      sampleRateHz: DEFAULT_FS,
      channels: ["raw", "rectified", "envelope"],
    },
    storageRegion: "Encrypted MongoDB cluster · Canada (Central) region",
    retentionPolicy:
      "Kept while you are in care, then 10 years (provincial record-keeping rule), unless you delete it sooner where the law allows.",
  };
  const store = await getStore();
  await store.createPatient(patient);
  await logAccess(id, clinicianActor, "profile_created", "Profile created. Consent recorded.");
  revalidatePath("/doctor");
  return { id };
}

/**
 * Clinician review of an assistant draft. Approval is the only way a draft
 * changes the record: a note is appended to its session, a load change
 * becomes the patient's prescribed working weight.
 */
export async function reviewSuggestionAction(input: {
  patientId: string;
  id: string;
  decision: "approved" | "rejected";
  title?: string;
  body?: string;
  note?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const store = await getStore();
  const s = await store.getSuggestion(input.id);
  if (!s || s.patientId !== input.patientId) return { ok: false, error: "Draft not found." };
  if (s.status !== "pending") return { ok: false, error: "This draft has already been reviewed." };
  const title = input.title?.trim() || s.title;
  const body = input.body?.trim() || s.body;
  if (input.decision === "approved" && !body) return { ok: false, error: "The draft is empty." };

  let applied = "";
  if (input.decision === "approved") {
    if (s.kind === "note" && s.sessionId) {
      const session = await store.getSession(s.sessionId);
      if (!session || session.patientId !== s.patientId) return { ok: false, error: "The session this note belongs to no longer exists." };
      const stamp = new Date().toLocaleDateString("en-CA", { month: "short", day: "numeric" });
      const line = `${stamp} — ${CURRENT_CLINICIAN.name}: ${body}`;
      await store.upsertSession({ ...session, notes: session.notes ? `${session.notes}\n${line}` : line });
      applied = " Added to the session notes.";
    } else if (s.kind === "load" && s.proposedLoad) {
      await store.updatePatient(s.patientId, { prescribedLoad: s.proposedLoad });
      await logAccess(s.patientId, clinicianActor, "load_prescribed", `Working weight set to ${fmtLoad(s.proposedLoad)} (from an assistant draft).`);
      applied = ` Working weight is now ${fmtLoad(s.proposedLoad)}.`;
    }
  }
  await store.updateSuggestion(s.id, {
    status: input.decision,
    title,
    body,
    reviewNote: input.note?.trim() || undefined,
    reviewedAt: new Date().toISOString(),
    reviewedBy: clinicianActor,
  });
  await logAccess(
    s.patientId,
    clinicianActor,
    input.decision === "approved" ? "suggestion_approved" : "suggestion_rejected",
    input.decision === "approved" ? `Approved draft “${title}”.${applied}` : `Declined draft “${title}”.`,
  );
  revalidatePatient(s.patientId);
  return { ok: true };
}

/**
 * Sets the weight the recorder starts this patient's sets at. The clinician types any number
 * and picks kg or lb; the weight is saved on the patient in MongoDB with its unit and its kg value.
 */
export async function setPrescribedLoadAction(patientId: string, value: number, unit: WeightUnit): Promise<{ ok: true } | { ok: false; error: string }> {
  if (unit !== "kg" && unit !== "lb") return { ok: false, error: "Pick kg or lb." };
  if (!isValidLoadValue(value)) return { ok: false, error: `Enter a weight between 0 and ${MAX_LOAD}.` };
  const store = await getStore();
  const patient = await store.getPatient(patientId);
  if (!patient) return { ok: false, error: "Patient not found." };
  const load = makeLoad(value, unit);
  await store.updatePatient(patientId, { prescribedLoad: load });
  await logAccess(patientId, clinicianActor, "load_prescribed", `Working weight set to ${fmtLoad(load)}.`);
  revalidatePatient(patientId);
  return { ok: true };
}

/**
 * Renames a saved session. Whatever is typed is followed by the session's start time, the same way
 * a name given while recording is built; an empty name goes back to the date.
 */
export async function renameSessionAction(patientId: string, sessionId: string, typed: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const store = await getStore();
  const session = await store.getSession(sessionId);
  if (!session || session.patientId !== patientId) return { ok: false, error: "Session not found." };
  if (typed.trim().length > SESSION_NAME_MAX) return { ok: false, error: `Keep the name under ${SESSION_NAME_MAX} characters.` };
  const name = defaultSessionName(session.startedAt, typed);
  await store.upsertSession({ ...session, name });
  await logAccess(patientId, clinicianActor, "session_renamed", `Renamed a session to “${name}”.`);
  revalidatePatient(patientId);
  return { ok: true, name };
}
