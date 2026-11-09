import "server-only";
import { clinicianActor, patientActor, resolveShare } from "./data";
import { getStore } from "./store";
import type { Actor, Share } from "./types";

export interface AccessGrant {
  actor: Actor;
  share?: Share;
  /** Session ids visible to this actor; undefined = all. */
  sessionIds?: Set<string>;
  includeRaw: boolean;
}

/**
 * DEMO AUTHORISATION. The `as` query param stands in for a signed-in user.
 * Replace with real auth (e.g. OIDC + role claims) before handling real data:
 * clinicians must belong to the patient's care team, patients may only read
 * their own record. Share tokens are already real capability URLs.
 */
export async function authorize(params: URLSearchParams, patientId: string): Promise<AccessGrant | null> {
  const token = params.get("token");
  if (token) {
    const { share, bundle } = await resolveShare(token);
    if (!share || !bundle || share.patientId !== patientId) return null;
    return {
      actor: { role: "recipient", name: share.recipient },
      share,
      sessionIds: share.scope === "sessions" ? new Set(share.sessionIds) : undefined,
      includeRaw: share.includeRaw,
    };
  }
  const store = await getStore();
  const patient = await store.getPatient(patientId);
  if (!patient) return null;
  const as = params.get("as");
  if (as === "clinician") return { actor: clinicianActor, includeRaw: true };
  if (as === "patient") return { actor: patientActor(patient), includeRaw: true };
  return null;
}

const recent = new Map<string, number>();

/** Avoids flooding the audit log when a chart fetches several signals at once. */
export function shouldLog(key: string, windowMs = 60_000) {
  const now = Date.now();
  const last = recent.get(key);
  if (last && now - last < windowMs) return false;
  recent.set(key, now);
  if (recent.size > 5000) recent.clear();
  return true;
}
