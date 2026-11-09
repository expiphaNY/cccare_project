"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { clinicianActor, logAccess, newShareToken, patientActor } from "@/lib/data";
import { CURRENT_CLINICIAN } from "@/lib/mock";
import { getStore } from "@/lib/store";
import type { Actor, Consent, ExerciseKey, Patient, Share, Side, Sex } from "@/lib/types";
import { EXERCISES } from "@/lib/types";
import { fullName } from "@/lib/format";
import { DEFAULT_FS } from "@/lib/signal";

type As = "clinician" | "patient";

async function actorFor(as: As, patientId: string): Promise<{ actor: Actor; patient: Patient }> {
  const store = await getStore();
  const patient = await store.getPatient(patientId);
  if (!patient) throw new Error("Patient not found");
  return { actor: as === "clinician" ? clinicianActor : patientActor(patient), patient };
}

function revalidatePatient(id: string) {
  revalidatePath(`/doctor/patients/${id}`, "layout");
  revalidatePath(`/patient/${id}`, "layout");
  revalidatePath("/doctor");
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
  if (input.as === "patient" && !patient.consent.patientSharing)
    return { ok: false, error: "Sharing by patient is turned off in consent settings." };
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
    deletedBy: { role: actor.role, name: actor.role === "patient" ? "The patient" : actor.name },
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
