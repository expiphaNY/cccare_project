// Stand-in for src/app/actions.ts in the static demo build (see next.config.ts).
// Server actions can't exist in a static export, and the demo is read-only anyway.
/* eslint-disable @typescript-eslint/no-unused-vars -- signatures mirror the real actions */
import { DEMO_MSG } from "@/lib/demo";

type As = "clinician" | "patient";

export async function createShareAction(_input: unknown): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  return { ok: false, error: DEMO_MSG };
}

export async function revokeShareAction(_as: As, _patientId: string, _token: string): Promise<void> {}

export async function updateConsentAction(_as: As, _patientId: string, _patch: Record<string, boolean>): Promise<void> {}

export async function deletePatientAction(
  _as: As,
  _patientId: string,
  _confirmation: string,
): Promise<{ ok: true; receiptId: string; counts: Record<string, number> } | { ok: false; error: string }> {
  return { ok: false, error: DEMO_MSG };
}

export async function addNoteAction(_patientId: string, _sessionId: string, _text: string): Promise<void> {}

export async function createPatientAction(
  _prev: { error?: string; id?: string } | null,
  _form: FormData,
): Promise<{ error?: string; id?: string }> {
  return { error: DEMO_MSG };
}
