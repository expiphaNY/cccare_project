import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { CLINICIANS, CURRENT_CLINICIAN } from "./mock";
import { getStore } from "./store";
import type { Actor, AuditAction, Patient, Recording, Session, Share } from "./types";
import { fullName } from "./format";

export async function logAccess(patientId: string, actor: Actor, action: AuditAction, detail: string) {
  const store = await getStore();
  await store.addAudit({ id: `a-${randomUUID()}`, patientId, at: new Date().toISOString(), actor, action, detail });
}

export const clinicianActor: Actor = {
  role: "clinician",
  name: CURRENT_CLINICIAN.name,
  id: CURRENT_CLINICIAN.id,
};

export function patientActor(p: Patient): Actor {
  return { role: "patient", name: fullName(p), id: p.id };
}

export function clinicianById(id?: string) {
  return CLINICIANS.find((c) => c.id === id);
}

export interface PatientBundle {
  patient: Patient;
  sessions: Session[];
  recordings: Recording[];
}

export async function getPatientBundle(id: string): Promise<PatientBundle | null> {
  const store = await getStore();
  const patient = await store.getPatient(id);
  if (!patient) return null;
  const [sessions, recordings] = await Promise.all([store.listSessions(id), store.listRecordings(id)]);
  return { patient, sessions, recordings };
}

export function newShareToken() {
  return randomBytes(18).toString("base64url");
}

export type ShareState = "active" | "expired" | "revoked";

export function shareState(s: Share, now = Date.now()): ShareState {
  if (s.revokedAt) return "revoked";
  if (new Date(s.expiresAt).getTime() < now) return "expired";
  return "active";
}

/**
 * Resolves a share token to the subset of data it grants. Returns null for
 * unknown / expired / revoked links — callers must treat that as "no access".
 */
export async function resolveShare(token: string) {
  const store = await getStore();
  const share = await store.getShare(token);
  if (!share || shareState(share) !== "active") return { share, bundle: null };
  const bundle = await getPatientBundle(share.patientId);
  if (!bundle) return { share, bundle: null };
  if (share.scope === "sessions" && share.sessionIds) {
    const allowed = new Set(share.sessionIds);
    bundle.sessions = bundle.sessions.filter((s) => allowed.has(s.id));
    bundle.recordings = bundle.recordings.filter((r) => allowed.has(r.sessionId));
  }
  return { share, bundle };
}

/** Who may currently see this patient's data, in plain words. */
export async function accessSummary(p: Patient) {
  const store = await getStore();
  const shares = await store.listShares(p.id);
  const active = shares.filter((s) => shareState(s) === "active");
  const assigned = clinicianById(p.clinicianId);
  const people: { who: string; why: string; kind: "care" | "share" | "you" }[] = [
    { who: "You", why: "Full access, always.", kind: "you" },
  ];
  if (assigned) people.push({ who: `${assigned.name}, ${assigned.title}`, why: "Your assigned clinician.", kind: "care" });
  if (p.consent.careTeamAccess)
    for (const c of CLINICIANS.filter((c) => c.id !== p.clinicianId))
      people.push({ who: `${c.name}, ${c.title}`, why: `Care team at ${c.clinic}.`, kind: "care" });
  for (const s of active)
    people.push({
      who: s.recipient,
      why: `Share link until ${new Date(s.expiresAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}.`,
      kind: "share",
    });
  return { people, activeShares: active.length };
}
